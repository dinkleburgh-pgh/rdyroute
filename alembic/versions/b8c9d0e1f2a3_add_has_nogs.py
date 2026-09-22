"""add has_nogs to truck_states

NOGs — Not Our Garments came back on a route today. Per-day flag on any
route truck, mirroring has_dust_garment.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-22
"""
import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "truck_states",
        sa.Column("has_nogs", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("truck_states", "has_nogs")
