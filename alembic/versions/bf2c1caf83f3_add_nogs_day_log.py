"""add_nogs_day_log

Revision ID: bf2c1caf83f3
Revises: 4134688fe5a2
Create Date: 2026-09-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "bf2c1caf83f3"
down_revision: Union[str, Sequence[str], None] = "4134688fe5a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "nogs_day_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("truck_number", sa.Integer(), nullable=False),
        sa.Column("has_nogs", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("actor_username", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_nogs_day_log_run_date"), "nogs_day_log", ["run_date"], unique=False)
    op.create_index(op.f("ix_nogs_day_log_truck_number"), "nogs_day_log", ["truck_number"], unique=False)
    # Backfill. truck_states keeps one row per (run_date, truck), so every day a
    # truck was flagged since has_nogs existed is still recoverable — seed the
    # log from it, dated to that day, so the history does not start empty.
    op.execute(sa.text(
        "INSERT INTO nogs_day_log (run_date, truck_number, has_nogs, source, actor_username, created_at) "
        "SELECT run_date, truck_number, true, 'backfill', NULL, updated_at "
        "FROM truck_states WHERE has_nogs = true"
    ))


def downgrade() -> None:
    op.drop_index(op.f("ix_nogs_day_log_truck_number"), table_name="nogs_day_log")
    op.drop_index(op.f("ix_nogs_day_log_run_date"), table_name="nogs_day_log")
    op.drop_table("nogs_day_log")
