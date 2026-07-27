"""add_documents

Revision ID: c1d2e3f4a5b6
Revises: d5e9a1c73b28
Create Date: 2026-07-26 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "d5e9a1c73b28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False, server_default="application/octet-stream"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_by", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_documents_category"), "documents", ["category"], unique=False)

    op.create_table(
        "document_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_key", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "target_type", "target_key", name="uq_document_link"),
    )
    op.create_index(op.f("ix_document_links_document_id"), "document_links", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_links_target_type"), "document_links", ["target_type"], unique=False)
    op.create_index(op.f("ix_document_links_target_key"), "document_links", ["target_key"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_links_target_key"), table_name="document_links")
    op.drop_index(op.f("ix_document_links_target_type"), table_name="document_links")
    op.drop_index(op.f("ix_document_links_document_id"), table_name="document_links")
    op.drop_table("document_links")
    op.drop_index(op.f("ix_documents_category"), table_name="documents")
    op.drop_table("documents")
