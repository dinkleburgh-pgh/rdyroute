"""
Router: /documents

Shared file/photo library (any MIME) for leads + admins. Bytes are streamed to
disk under /app/.data/documents (persistent backend_data volume); only metadata
lives in the DB. Documents are browsable (title / category / tags) and can be
pinned to other records (truck / run-date) via DocumentLink.

Mirrors the audit-photo storage pattern (routers/audit.py) but is standalone
(no truck/date coupling), accepts any file type, streams to disk instead of
buffering the whole upload in RAM, and derives uploaded_by from the auth'd user.
"""

import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from database import get_db
from routers.auth import require_management_access
from models import Document, DocumentLink, User
from schemas import DocumentLinkCreate, DocumentLinkOut, DocumentOut, DocumentUpdate

router = APIRouter(prefix="/documents", tags=["documents"])

# Files live on the persistent backend data volume (/app/.data) in production,
# ./documents in local dev. Override with DOCUMENTS_DIR.
_DOC_ROOT = Path(
    os.environ.get(
        "DOCUMENTS_DIR",
        "/app/.data/documents" if Path("/app/.data").exists() else "./documents",
    )
).resolve()
_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024  # 25 MB
_CHUNK = 1024 * 1024  # 1 MB streaming chunks


def _parse_tags(raw: str) -> list[str]:
    """Comma-separated tag string -> clean, de-duplicated list."""
    seen: list[str] = []
    for t in (raw or "").split(","):
        t = t.strip()
        if t and t not in seen:
            seen.append(t)
    return seen


@router.get("", response_model=list[DocumentOut])
def list_documents(
    q: str | None = Query(default=None, description="Search title / description / filename"),
    category: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    target_type: str | None = Query(default=None, description="Filter to docs linked to this target"),
    target_key: str | None = Query(default=None),
    _user: User = Depends(require_management_access),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Document)
        .options(selectinload(Document.links))
        .order_by(Document.created_at.desc())
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Document.title.ilike(like), Document.description.ilike(like), Document.file_name.ilike(like))
        )
    if category:
        stmt = stmt.where(Document.category == category)
    if target_type and target_key:
        stmt = stmt.join(DocumentLink, DocumentLink.document_id == Document.id).where(
            DocumentLink.target_type == target_type,
            DocumentLink.target_key == target_key,
        )
    docs = list(db.scalars(stmt).unique().all())
    if tag:
        docs = [d for d in docs if tag in (d.tags or [])]
    return docs


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    title: str = Form(default=""),
    description: str = Form(default=""),
    category: str = Form(default=""),
    tags: str = Form(default=""),  # comma-separated
    file: UploadFile = File(...),
    user: User = Depends(require_management_access),
    db: Session = Depends(get_db),
):
    """Upload any file into the shared library. Streams to disk with a hard size cap."""
    doc_id = uuid.uuid4().hex
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    ext = Path(file.filename or "").suffix.lower() or mimetypes.guess_extension(mime) or ".bin"
    _DOC_ROOT.mkdir(parents=True, exist_ok=True)
    dest = _DOC_ROOT / f"{doc_id}{ext}"  # server-generated name only — never the client filename

    size = 0
    overflow = False
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_DOCUMENT_BYTES:
                    overflow = True
                    break
                out.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    if overflow:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_DOCUMENT_BYTES // (1024 * 1024)} MB limit")
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file upload")

    row = Document(
        id=doc_id,
        title=(title.strip() or (file.filename or f"Document {doc_id[:8]}")),
        description=description.strip(),
        category=category.strip(),
        tags=_parse_tags(tags),
        file_name=file.filename or f"{doc_id}{ext}",
        stored_path=str(dest),
        mime_type=mime,
        size_bytes=size,
        uploaded_by=user.username,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, _user: User = Depends(require_management_access), db: Session = Depends(get_db)):
    row = db.get(Document, document_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return row


@router.get("/{document_id}/file")
def download_document(document_id: str, _user: User = Depends(require_management_access), db: Session = Depends(get_db)):
    row = db.get(Document, document_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    path = Path(row.stored_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored file missing")
    return FileResponse(path, media_type=row.mime_type, filename=row.file_name)


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: str,
    payload: DocumentUpdate,
    _user: User = Depends(require_management_access),
    db: Session = Depends(get_db),
):
    row = db.get(Document, document_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    data = payload.model_dump(exclude_unset=True)
    if "tags" in data and data["tags"] is not None:
        # de-dupe while preserving order
        seen: list[str] = []
        for t in data["tags"]:
            t = str(t).strip()
            if t and t not in seen:
                seen.append(t)
        data["tags"] = seen
    for field, value in data.items():
        if value is not None or field == "tags":
            setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, _user: User = Depends(require_management_access), db: Session = Depends(get_db)):
    row = db.get(Document, document_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    try:
        Path(row.stored_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(row)  # cascade removes DocumentLink rows
    db.commit()


# ---------------------------------------------------------------------------
# Links — pin a document to a truck / run-date (referenced in context)
# ---------------------------------------------------------------------------

@router.post("/{document_id}/links", response_model=DocumentLinkOut, status_code=status.HTTP_201_CREATED)
def add_document_link(
    document_id: str,
    payload: DocumentLinkCreate,
    user: User = Depends(require_management_access),
    db: Session = Depends(get_db),
):
    if db.get(Document, document_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    target_type = payload.target_type.strip()
    target_key = payload.target_key.strip()
    if not target_type or not target_key:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_type and target_key required")
    link = DocumentLink(
        document_id=document_id,
        target_type=target_type,
        target_key=target_key,
        created_by=user.username,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        # Already linked — idempotent: return the existing row.
        db.rollback()
        existing = db.scalars(
            select(DocumentLink).where(
                DocumentLink.document_id == document_id,
                DocumentLink.target_type == target_type,
                DocumentLink.target_key == target_key,
            )
        ).first()
        if existing is not None:
            return existing
        raise
    db.refresh(link)
    return link


@router.delete("/{document_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_link(
    document_id: str,
    link_id: int,
    _user: User = Depends(require_management_access),
    db: Session = Depends(get_db),
):
    link = db.get(DocumentLink, link_id)
    if link is None or link.document_id != document_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    db.delete(link)
    db.commit()
