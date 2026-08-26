"""add needs_crossload to truck states

"This truck's freight has to move onto another truck" is knowable well before
anyone knows WHICH truck. crossload_to_truck can't say that on its own — NULL
there already means "no crossload" — so the need and the destination become two
fields: needs_crossload is the flag, crossload_to_truck is the answer once
somebody has one.

Set by hand, and automatically when a LOADED truck goes out of service: its
freight is already aboard and has to come off, so the flag is raised for the
crew rather than waiting to be noticed.

Revision ID: d4a7c1e9b620
Revises: c7e2b9d4f8a1
Create Date: 2026-08-25 04:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4a7c1e9b620"
down_revision = "c7e2b9d4f8a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("needs_crossload", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # Existing rows that already name a destination obviously need one.
    op.execute("update truck_states set needs_crossload = true where crossload_to_truck is not null")


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("needs_crossload")
