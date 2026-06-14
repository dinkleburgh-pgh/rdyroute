"""add_shortage_header_columns

Revision ID: e2a7f8c9b541
Revises: c4b8a2f91d11
Create Date: 2026-06-12 01:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2a7f8c9b541"
down_revision: Union[str, Sequence[str], None] = "c4b8a2f91d11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shortage_sheet_imports",
        sa.Column("header_columns", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "shortage_sheet_row_drafts",
        sa.Column("source_column_index", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_shortage_sheet_row_drafts_source_column_index"),
        "shortage_sheet_row_drafts",
        ["source_column_index"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_shortage_sheet_row_drafts_source_column_index"),
        table_name="shortage_sheet_row_drafts",
    )
    op.drop_column("shortage_sheet_row_drafts", "source_column_index")
    op.drop_column("shortage_sheet_imports", "header_columns")
