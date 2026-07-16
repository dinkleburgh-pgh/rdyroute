"""add unloaded_at to truck states

Revision ID: c3a7d9f21e08
Revises: 1f4e2b7c9d10
Create Date: 2026-07-14 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3a7d9f21e08"
down_revision = "1f4e2b7c9d10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("unloaded_at", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("unloaded_at")
