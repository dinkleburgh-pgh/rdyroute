"""
Router: /auth

Covers user management, account requests, login, and session handling.

V1 roles (fleet > supervisor > lead > atl > loader > unloader > guest) are
preserved verbatim.  Passwords are bcrypt-hashed.  Login issues a JWT that
the React frontend stores as a Bearer token (and as an httpOnly cookie for
XSS-safe browser clients).  A parallel server-side session table mirrors the
V1 .truck_sessions.json for clients that prefer cookie-based auth.
"""

import os
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import get_db, settings
from models import AuthRequest, AuthRequestStatus, AuthRole, LoginAttempt, Session as SessionModel, User
from schemas import (
    AuthRequestCreate,
    AuthRequestOut,
    AuthRequestResolve,
    LoginRequest,
    SessionOut,
    TokenResponse,
    UserCreate,
    UserOut,
    UserPasswordUpdate,
    UserUpdate,
)

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")
# Optional variant — returns None instead of 401 when no Authorization header.
# Used by get_current_user so it can fall back to the httpOnly JWT cookie.
_optional_oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)

SESSION_COOKIE = "readyroutev2_sid"
JWT_COOKIE     = "readyroutev2_jwt"

# ---------------------------------------------------------------------------
# Login rate limiter
# In-memory cache warmed from DB on first use; writes persist across restarts.
# 10 attempts per 5-minute window, keyed by source IP.
# ---------------------------------------------------------------------------

_RATE_LIMIT_WINDOW = 300   # seconds
_RATE_LIMIT_MAX    = 10    # attempts per window

# IPs that are never rate-limited (comma-separated env var)
_bypass_raw = os.getenv("RATE_LIMIT_BYPASS_IPS", "127.0.0.1,::1")
_RATE_LIMIT_BYPASS: set[str] = {ip.strip() for ip in _bypass_raw.split(",") if ip.strip()}

# In-memory cache: ip → list of timestamps (unix float)
_attempt_cache: dict[str, list[float]] = defaultdict(list)
_cache_warmed = False


def _warm_attempt_cache(db: Session) -> None:
    """Load recent attempts from DB into memory (called once per process start)."""
    global _cache_warmed
    if _cache_warmed:
        return
    _cache_warmed = True
    cutoff = time.time() - _RATE_LIMIT_WINDOW
    rows = db.scalars(
        select(LoginAttempt).where(LoginAttempt.attempted_at >= cutoff)
    ).all()
    for row in rows:
        _attempt_cache[row.ip_address].append(row.attempted_at)


def _check_rate_limit(ip: str, db: Session) -> None:
    if ip in _RATE_LIMIT_BYPASS:
        return
    _warm_attempt_cache(db)
    now = time.time()
    cutoff = now - _RATE_LIMIT_WINDOW
    # Prune stale in-memory entries
    _attempt_cache[ip] = [t for t in _attempt_cache[ip] if t >= cutoff]
    if len(_attempt_cache[ip]) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait 5 minutes and try again.",
        )
    # Record this attempt in-memory and in DB
    _attempt_cache[ip].append(now)
    db.add(LoginAttempt(ip_address=ip, attempted_at=now))
    # Don't commit here — let the caller commit (or it commits with login success/failure)


def _prune_login_attempts(db: Session) -> None:
    """Delete login attempt rows older than the rate-limit window. Called hourly."""
    cutoff = time.time() - _RATE_LIMIT_WINDOW
    db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at < cutoff))
    db.commit()
    # Reset in-memory cache so stale IPs are released
    _attempt_cache.clear()

# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _create_access_token(username: str, role: str, session_id: str) -> str:
    now = datetime.now(timezone.utc).timestamp()
    payload = {
        "sub": username,
        "role": role,
        "sid": session_id,   # ties this JWT to a specific server-side session
        "iat": now,
        "exp": now + settings.access_token_expire_minutes * 60,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Dependency: current authenticated user
# ---------------------------------------------------------------------------

def get_current_user(
    bearer_token: str | None = Depends(_optional_oauth2),
    jwt_cookie: str | None = Cookie(default=None, alias=JWT_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    token = bearer_token or jwt_cookie
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    claims = _decode_token(token)
    username = claims.get("sub")
    sid = claims.get("sid")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    # Validate server-side session first (primary-key lookup = single index hit).
    if sid:
        now_ts = datetime.now(timezone.utc).timestamp()
        sess = db.get(SessionModel, sid)
        if sess is None or sess.expires_ts <= now_ts:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session revoked or expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None or not user.is_enabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")
    return user


_ADMIN_ROLES = frozenset({AuthRole.admin, AuthRole.fleet, AuthRole.supervisor})


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return current_user


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip, db)

    user = db.scalars(select(User).where(User.username == payload.username.lower())).first()
    if user is None or not user.is_enabled or not _verify_password(payload.password, user.hashed_password):
        db.commit()  # persist the failed attempt row
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    ua = request.headers.get("user-agent", "")[:256]
    sid = _write_server_session(user.username, user.role.value, db, ip=client_ip, ua=ua)
    token = _create_access_token(user.username, user.role.value, sid)

    # Session cookie — long-lived, used for transparent JWT refresh.
    response.set_cookie(
        SESSION_COOKIE,
        sid,
        httponly=True,
        samesite="lax",
        max_age=settings.session_expiry_days * 86400,
    )
    # JWT cookie — short-lived, allows browser clients to skip localStorage.
    # XSS-safe: httpOnly prevents JS access. Sent automatically by the browser.
    response.set_cookie(
        JWT_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
    )

    return TokenResponse(access_token=token, role=user.role, username=user.username)


# OAuth2 form-compatible endpoint used by the OpenAPI /docs "Authorize" button
@router.post("/token", response_model=TokenResponse, include_in_schema=False)
def token_form(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.username == form.username.lower())).first()
    if user is None or not user.is_enabled or not _verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    sid = _write_server_session(user.username, user.role.value, db)
    token = _create_access_token(user.username, user.role.value, sid)
    return TokenResponse(access_token=token, role=user.role, username=user.username)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    readyroutev2_sid: str | None = Cookie(default=None),
):
    # Best-effort cleanup of the server-side session row so it can't be reused.
    if readyroutev2_sid:
        sess = db.get(SessionModel, readyroutev2_sid)
        if sess is not None:
            db.delete(sess)
            db.commit()
    response.delete_cookie(SESSION_COOKIE)
    response.delete_cookie(JWT_COOKIE)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    readyroutev2_sid: str | None = Cookie(default=None),
):
    """
    Mint a fresh JWT using the long-lived server-side session cookie.

    Rotates the session ID on every call so a stolen cookie can only be used
    once before the legitimate client invalidates it.  The old session row is
    deleted and a new one is created with a fresh UUID.
    """
    if not readyroutev2_sid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No session cookie")

    sess = db.get(SessionModel, readyroutev2_sid)
    now_ts = datetime.now(timezone.utc).timestamp()
    if sess is None or sess.expires_ts <= now_ts:
        response.delete_cookie(SESSION_COOKIE)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = db.scalars(select(User).where(User.username == sess.username)).first()
    if user is None or not user.is_enabled:
        db.delete(sess)
        db.commit()
        response.delete_cookie(SESSION_COOKIE)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User disabled")

    # Rotate: delete old session and issue a fresh one with a new ID.
    db.delete(sess)
    db.flush()  # ensure delete is visible before insert
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")[:256]
    new_sid = _write_server_session(user.username, user.role.value, db, ip=ip, ua=ua)

    response.set_cookie(
        SESSION_COOKIE,
        new_sid,
        httponly=True,
        samesite="lax",
        max_age=settings.session_expiry_days * 86400,
    )

    token = _create_access_token(user.username, user.role.value, new_sid)
    # Also refresh the JWT cookie so the browser client's httpOnly cookie stays valid.
    response.set_cookie(
        JWT_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
    )
    return TokenResponse(access_token=token, role=user.role, username=user.username)


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


# ---------------------------------------------------------------------------
# User management (admin only)
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[UserOut])
def list_users(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.scalars(select(User).where(User.username == payload.username)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        username=payload.username,
        hashed_password=_hash_password(payload.password),
        role=payload.role,
        display_name=payload.display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{username}", response_model=UserOut)
def update_user(
    username: str,
    payload: UserUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(username, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{username}/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    username: str,
    payload: UserPasswordUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Admins can change anyone's password; non-admins only their own
    if current_user.role not in _ADMIN_ROLES and current_user.username != username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's password")
    user = _get_user_or_404(username, db)
    user.hashed_password = _hash_password(payload.new_password)
    db.commit()


@router.delete("/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    username: str,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if username == current_user.username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
    user = _get_user_or_404(username, db)
    db.delete(user)
    db.commit()


# ---------------------------------------------------------------------------
# Account requests
# ---------------------------------------------------------------------------

@router.get("/requests", response_model=list[AuthRequestOut])
def list_requests(
    pending_only: bool = True,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(AuthRequest)
    if pending_only:
        q = q.where(AuthRequest.status == AuthRequestStatus.pending)
    return db.scalars(q.order_by(AuthRequest.requested_at.desc())).all()


@router.post("/requests", response_model=AuthRequestOut, status_code=status.HTTP_201_CREATED)
def submit_request(payload: AuthRequestCreate, db: Session = Depends(get_db)):
    req = AuthRequest(**payload.model_dump())
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@router.patch("/requests/{request_id}", response_model=AuthRequestOut)
def resolve_request(
    request_id: int,
    payload: AuthRequestResolve,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    req = db.get(AuthRequest, request_id)
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    req.status = payload.status
    req.resolved_by = payload.resolved_by
    req.resolved_at = datetime.now(timezone.utc)

    # Auto-create user if approved
    if payload.status == AuthRequestStatus.approved:
        if not db.scalars(select(User).where(User.username == req.username)).first():
            # Create with a disabled-by-default placeholder password so the user
            # must set their own password after being notified.
            temp_pw = _hash_password(str(uuid.uuid4()))
            db.add(User(
                username=req.username,
                hashed_password=temp_pw,
                role=req.requested_role,
                display_name=req.display_name,
                is_enabled=False,  # Admin must explicitly enable after setting password
            ))

    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Server-side sessions
# ---------------------------------------------------------------------------

@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    now_ts = datetime.now(timezone.utc).timestamp()
    return db.scalars(
        select(SessionModel)
        .where(SessionModel.expires_ts > now_ts)
        .order_by(SessionModel.created_ts.desc())
    ).all()


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: str,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Revoke a specific session by ID, forcing that client to re-authenticate."""
    sess = db.get(SessionModel, session_id)
    if sess is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    db.delete(sess)
    db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_or_404(username: str, db: Session) -> User:
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _write_server_session(
    username: str,
    role: str,
    db: Session,
    *,
    ip: str | None = None,
    ua: str | None = None,
) -> str:
    now_ts = datetime.now(timezone.utc).timestamp()
    expires_ts = now_ts + settings.session_expiry_days * 86400
    sid = uuid.uuid4().hex
    db.add(SessionModel(
        id=sid,
        username=username,
        role=role,
        created_ts=now_ts,
        expires_ts=expires_ts,
        ip_address=ip,
        user_agent=ua,
    ))
    db.commit()
    return sid
