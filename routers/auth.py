"""
Router: /auth

Covers user management, account requests, login, and session handling.

V1 roles (fleet > supervisor > lead > atl > loader > unloader > guest) are
preserved verbatim.  Passwords are bcrypt-hashed.  Login issues a JWT that
the React frontend can store as a Bearer token.  A parallel server-side
session table mirrors the V1 .truck_sessions.json for clients that prefer
cookie-based auth.
"""

import uuid
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db, settings
from models import AuthRequest, AuthRequestStatus, AuthRole, Session as SessionModel, User
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

SESSION_COOKIE = "readyroutev2_sid"

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

def _create_access_token(username: str, role: str) -> str:
    payload = {
        "sub": username,
        "role": role,
        "iat": datetime.now(timezone.utc).timestamp(),
        "exp": datetime.now(timezone.utc).timestamp()
        + settings.access_token_expire_minutes * 60,
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
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    claims = _decode_token(token)
    username = claims.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None or not user.is_enabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    # TODO: remove bypass once role-based access is properly defined
    return current_user


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.username == payload.username.lower())).first()
    if user is None or not user.is_enabled or not _verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = _create_access_token(user.username, user.role.value)

    # Also write a server-side session and set a cookie for cookie-based clients
    sid = _write_server_session(user.username, user.role.value, db)
    response.set_cookie(
        SESSION_COOKIE,
        sid,
        httponly=True,
        samesite="lax",
        max_age=settings.session_expiry_days * 86400,
    )

    return TokenResponse(access_token=token, role=user.role, username=user.username)


# OAuth2 form-compatible endpoint used by the OpenAPI /docs "Authorize" button
@router.post("/token", response_model=TokenResponse, include_in_schema=False)
def token_form(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    return login(LoginRequest(username=form.username, password=form.password), Response(), db)


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


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    readyroutev2_sid: str | None = Cookie(default=None),
):
    """
    Mint a fresh JWT using the long-lived server-side session cookie.

    The frontend stores the JWT in localStorage; when it expires, an axios
    interceptor calls this endpoint to silently re-up the token instead of
    forcing the user back to the login screen.  The cookie itself is
    httponly + lax samesite and lasts `session_expiry_days` (30d default).
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
        # Stale session pointing at a disabled / deleted account — drop it.
        db.delete(sess)
        db.commit()
        response.delete_cookie(SESSION_COOKIE)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User disabled")

    # Slide the cookie expiry forward so active users stay remembered indefinitely.
    sess.expires_ts = now_ts + settings.session_expiry_days * 86400
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        readyroutev2_sid,
        httponly=True,
        samesite="lax",
        max_age=settings.session_expiry_days * 86400,
    )

    token = _create_access_token(user.username, user.role.value)
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
    if current_user.role not in (AuthRole.fleet, AuthRole.atl) and current_user.username != username:
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
        select(SessionModel).where(SessionModel.expires_ts > now_ts)
    ).all()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_or_404(username: str, db: Session) -> User:
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _write_server_session(username: str, role: str, db: Session) -> str:
    now_ts = datetime.now(timezone.utc).timestamp()
    expires_ts = now_ts + settings.session_expiry_days * 86400
    sid = uuid.uuid4().hex
    db.add(SessionModel(id=sid, username=username, role=role, created_ts=now_ts, expires_ts=expires_ts))
    db.commit()
    return sid
