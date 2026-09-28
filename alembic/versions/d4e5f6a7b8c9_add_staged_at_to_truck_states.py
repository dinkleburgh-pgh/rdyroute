"""add staged_at to truck states

The load crew physically pulls a truck up ready to load — "staged". Distinct
from the runday_next_up_<date> app-setting, which names ONE truck for the whole
day: staging is per-truck and several trucks can sit staged at once, so it is a
column here rather than a setting.

A timestamp, not a status, for the same reason as unloading_started_at: the
truck keeps its own unloaded/dirty status while staged, so no counter and no
status switch changes. Cleared when the truck reaches `loaded` (the lane is
empty again), when it leaves the loadable set (off/oos), and at day-init.

Revision ID: d4e5f6a7b8c9
Revises: 9f3b1c7d2e84
Create Date: 2026-09-28 00:05:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "9f3b1c7d2e84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("staged_at", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("staged_at")
