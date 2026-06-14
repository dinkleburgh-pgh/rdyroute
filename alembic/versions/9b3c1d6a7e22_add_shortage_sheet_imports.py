"""add_shortage_sheet_imports

Revision ID: 9b3c1d6a7e22
Revises: f31d7f4f4c10
Create Date: 2026-06-11 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9b3c1d6a7e22"
down_revision: Union[str, Sequence[str], None] = "f31d7f4f4c10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shortage_sheet_imports",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("extraction_mode", sa.String(length=32), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_username", sa.String(length=80), nullable=False),
        sa.Column("reviewed_by_username", sa.String(length=80), nullable=True),
        sa.Column("applied_by_username", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shortage_sheet_imports_run_date"), "shortage_sheet_imports", ["run_date"], unique=False)
    op.create_index(op.f("ix_shortage_sheet_imports_status"), "shortage_sheet_imports", ["status"], unique=False)
    op.create_index(op.f("ix_shortage_sheet_imports_uploaded_by_user_id"), "shortage_sheet_imports", ["uploaded_by_user_id"], unique=False)

    op.create_table(
        "shortage_sheet_photos",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("import_id", sa.String(length=64), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=80), nullable=False, server_default="application/octet-stream"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["shortage_sheet_imports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shortage_sheet_photos_import_id"), "shortage_sheet_photos", ["import_id"], unique=False)

    op.create_table(
        "shortage_sheet_row_drafts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("import_id", sa.String(length=64), nullable=False),
        sa.Column("source_photo_id", sa.String(length=64), nullable=True),
        sa.Column("row_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("truck_number", sa.Integer(), nullable=True),
        sa.Column("item_category", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("item_detail", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("initials", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("raw_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("issues", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("review_status", sa.String(length=32), nullable=False, server_default="needs_review"),
        sa.Column("reviewer_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["shortage_sheet_imports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_photo_id"], ["shortage_sheet_photos.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shortage_sheet_row_drafts_import_id"), "shortage_sheet_row_drafts", ["import_id"], unique=False)
    op.create_index(op.f("ix_shortage_sheet_row_drafts_review_status"), "shortage_sheet_row_drafts", ["review_status"], unique=False)
    op.create_index(op.f("ix_shortage_sheet_row_drafts_source_photo_id"), "shortage_sheet_row_drafts", ["source_photo_id"], unique=False)
    op.create_index(op.f("ix_shortage_sheet_row_drafts_truck_number"), "shortage_sheet_row_drafts", ["truck_number"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shortage_sheet_row_drafts_truck_number"), table_name="shortage_sheet_row_drafts")
    op.drop_index(op.f("ix_shortage_sheet_row_drafts_source_photo_id"), table_name="shortage_sheet_row_drafts")
    op.drop_index(op.f("ix_shortage_sheet_row_drafts_review_status"), table_name="shortage_sheet_row_drafts")
    op.drop_index(op.f("ix_shortage_sheet_row_drafts_import_id"), table_name="shortage_sheet_row_drafts")
    op.drop_table("shortage_sheet_row_drafts")

    op.drop_index(op.f("ix_shortage_sheet_photos_import_id"), table_name="shortage_sheet_photos")
    op.drop_table("shortage_sheet_photos")

    op.drop_index(op.f("ix_shortage_sheet_imports_uploaded_by_user_id"), table_name="shortage_sheet_imports")
    op.drop_index(op.f("ix_shortage_sheet_imports_status"), table_name="shortage_sheet_imports")
    op.drop_index(op.f("ix_shortage_sheet_imports_run_date"), table_name="shortage_sheet_imports")
    op.drop_table("shortage_sheet_imports")
