"""add driver_claimed_route to truck states

A spare driver with no recorded coverage can report which route they carried
from the QR page. That report is a CLAIM, not coverage: it sits here until a
lead confirms it on the Fleet board (which writes the real SpareAssignment +
RouteSwapLog through the authenticated path) or dismisses it. Transient like
arrived_at/unloading_started_at — cleared at day-init, read by no counter.

Revision ID: b3d8f2a1c4e5
Revises: a9c4e1f7b3d2
Create Date: 2026-08-19 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b3d8f2a1c4e5"
down_revision = "a9c4e1f7b3d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("driver_claimed_route", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("driver_claimed_route")
