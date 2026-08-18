"""add unloading_started_at to truck states

Transient "the unload crew is emptying this truck right now" marker, so the
Load board can see which truck is coming. A timestamp rather than a status on
purpose: `in_progress` already means LOADING and three counters treat it as
already-unloaded, and a new enum value would touch ~30 status switches. Status
stays `dirty` while unloading, so no counter changes.

Revision ID: a9c4e1f7b3d2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-17 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a9c4e1f7b3d2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("unloading_started_at", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("unloading_started_at")
