"""add_report_snapshots

One row per archived run day: the exact inputs the Run Report page reads for
that date, captured at the end of 3rd shift (report_archive.py), so a past
day's report renders from what it was rather than from whatever the database
holds today. No backfill: a day that was never captured has no honest
snapshot to reconstruct — it keeps rendering live, as before.

Revision ID: 5e1a7c3d9b42
Revises: bf2c1caf83f3
Create Date: 2026-09-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "5e1a7c3d9b42"
down_revision: Union[str, Sequence[str], None] = "bf2c1caf83f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# JSONB on Postgres; plain JSON on the SQLite dev database.
_JSON_DOCUMENT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "report_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("app_version", sa.String(length=64), nullable=True),
        sa.Column("inputs", _JSON_DOCUMENT, nullable=False),
        sa.Column("summary", _JSON_DOCUMENT, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_date", name="uq_report_snapshots_run_date"),
    )


def downgrade() -> None:
    op.drop_table("report_snapshots")
