"""add_sheet_template_id_to_shortage_imports

Revision ID: c4b8a2f91d11
Revises: 9b3c1d6a7e22
Create Date: 2026-06-11 22:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4b8a2f91d11"
down_revision: Union[str, Sequence[str], None] = "9b3c1d6a7e22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shortage_sheet_imports",
        sa.Column("sheet_template_id", sa.String(length=32), nullable=False, server_default="shortage_v1a"),
    )


def downgrade() -> None:
    op.drop_column("shortage_sheet_imports", "sheet_template_id")
