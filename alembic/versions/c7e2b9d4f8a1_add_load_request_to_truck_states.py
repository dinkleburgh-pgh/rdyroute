"""add load_request to truck states

The load crew's answer to the truck the dock is emptying right now: "want" (pull
it forward) or "skip" (back out of it).

ADVISORY ONLY. It never clears the unloading marker, never moves a status and
never blocks a transition — the dock reads it and decides. Transient like
unloading_started_at / driver_claimed_route: it exists only while that marker
does, is cleared at day-init, and no counter reads it.

Revision ID: c7e2b9d4f8a1
Revises: b3d8f2a1c4e5
Create Date: 2026-08-21 02:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c7e2b9d4f8a1"
down_revision = "b3d8f2a1c4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("load_request", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("load_request_at", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("load_request_at")
        batch_op.drop_column("load_request")
