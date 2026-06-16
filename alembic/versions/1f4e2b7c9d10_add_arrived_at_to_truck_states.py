"""add arrived_at to truck states

Revision ID: 1f4e2b7c9d10
Revises: b7f2e4c3a991
Create Date: 2026-06-15 10:40:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "1f4e2b7c9d10"
down_revision = "b7f2e4c3a991"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("arrived_at", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("arrived_at")
