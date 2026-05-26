"""
Router: /communications

Team-chat messages.  Messages are soft-deleted (is_deleted flag) so admins
can review deletion history.  Censorship is enforced server-side using a
configurable word list stored in AppSetting.

V1 mapping:
  communications_chat.json          →  CommunicationMessage rows
  _append_communications_message    →  POST /communications/messages
  _delete_communications_message    →  DELETE /communications/messages/{id}
  _load_communications_messages     →  GET  /communications/messages
"""

import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AppSetting, AuthRole, CommunicationMessage
from schemas import MessageCreate, MessageOut

router = APIRouter(prefix="/communications", tags=["communications"])

_CENSOR_WORDS_KEY = "communications_censor_words"
_MAX_MESSAGES = 500


# ---------------------------------------------------------------------------
# List messages
# ---------------------------------------------------------------------------

@router.get("/messages", response_model=list[MessageOut])
def list_messages(
    channel: str = Query(default="Team"),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=_MAX_MESSAGES, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = (
        select(CommunicationMessage)
        .where(CommunicationMessage.channel == channel)
        .order_by(CommunicationMessage.sent_ts.desc())
        .limit(limit)
    )
    if not include_deleted:
        q = q.where(CommunicationMessage.is_deleted == False)
    rows = db.scalars(q).all()
    # Return chronological order to the client
    return list(reversed(rows))


# ---------------------------------------------------------------------------
# Send a message
# ---------------------------------------------------------------------------

@router.post("/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(payload: MessageCreate, db: Session = Depends(get_db)):
    censored_text = _apply_censor(payload.message, db)
    msg = CommunicationMessage(
        id=uuid.uuid4().hex,
        channel=payload.channel,
        username=payload.username,
        sender_role=payload.sender_role,
        message=censored_text,
        sent_ts=time.time(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


# ---------------------------------------------------------------------------
# Delete a message (soft-delete)
# ---------------------------------------------------------------------------

@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: str,
    actor_username: str = Query(...),
    actor_role: str = Query(...),
    db: Session = Depends(get_db),
):
    msg = db.get(CommunicationMessage, message_id)
    if msg is None or msg.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    # Non-admins can only delete their own messages
    is_admin = actor_role in (AuthRole.admin.value, AuthRole.fleet.value, AuthRole.atl.value, AuthRole.supervisor.value, AuthRole.lead.value)
    if not is_admin and msg.username != actor_username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete another user's message")

    msg.is_deleted = True
    db.commit()


# ---------------------------------------------------------------------------
# Censor-word management (admin)
# ---------------------------------------------------------------------------

@router.get("/censor-words", response_model=list[str])
def get_censor_words(db: Session = Depends(get_db)):
    setting = db.get(AppSetting, _CENSOR_WORDS_KEY)
    if setting is None or not isinstance(setting.value, list):
        return []
    return sorted(setting.value)


@router.put("/censor-words", response_model=list[str])
def update_censor_words(words: list[str], db: Session = Depends(get_db)):
    cleaned = sorted({w.lower().strip() for w in words if w.strip()})
    setting = db.get(AppSetting, _CENSOR_WORDS_KEY)
    if setting is None:
        db.add(AppSetting(key=_CENSOR_WORDS_KEY, value=cleaned))
    else:
        setting.value = cleaned
    db.commit()
    return cleaned


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _apply_censor(text: str, db: Session) -> str:
    setting = db.get(AppSetting, _CENSOR_WORDS_KEY)
    if setting is None or not isinstance(setting.value, list) or not setting.value:
        return text
    words = sorted(setting.value, key=len, reverse=True)
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(w) for w in words) + r")\b",
        flags=re.IGNORECASE,
    )
    return pattern.sub(lambda m: "*" * len(m.group()), text)
