"""add_crossload_to_truck

Revision ID: f1a2b3c4d5e6
Revises: e9f0a1b2c3d4
Create Date: 2026-07-29 01:30:00.000000

Crossload marker: "this truck's freight needs crossloading onto truck #N".
A nullable truck-number pointer on the per-day state row (same shape as
oos_spare_route) rather than a new TruckStatus value — the truck keeps its own
workflow status while flagged, the marker has to carry a target truck number,
and adding a Postgres enum member would need an ALTER TYPE plus a matching
update to every exhaustive status map on the client.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("crossload_to_truck", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("crossload_to_truck")
