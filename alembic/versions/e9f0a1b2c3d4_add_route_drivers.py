"""add_route_drivers

Revision ID: e9f0a1b2c3d4
Revises: d7e8f9a0b1c2
Create Date: 2026-07-27 03:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "route_drivers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("route_number", sa.Integer(), nullable=True),
        sa.Column("route_label", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("driver_name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        # UNIQUE on the nullable route_number also provides its index; Postgres
        # permits multiple NULLs (the shuttle row) under a unique constraint.
        sa.UniqueConstraint("route_number", name="uq_route_drivers_route_number"),
    )


def downgrade() -> None:
    op.drop_table("route_drivers")
