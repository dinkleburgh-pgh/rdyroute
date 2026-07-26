"""add_garment_day_log

Revision ID: d5e9a1c73b28
Revises: e8d4a1c7b3f2
Create Date: 2026-07-26 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5e9a1c73b28"
down_revision: Union[str, Sequence[str], None] = "e8d4a1c7b3f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "garment_day_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("truck_number", sa.Integer(), nullable=False),
        sa.Column("has_garment", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("actor_username", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_garment_day_log_run_date"), "garment_day_log", ["run_date"], unique=False)
    op.create_index(op.f("ix_garment_day_log_truck_number"), "garment_day_log", ["truck_number"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_garment_day_log_truck_number"), table_name="garment_day_log")
    op.drop_index(op.f("ix_garment_day_log_run_date"), table_name="garment_day_log")
    op.drop_table("garment_day_log")
