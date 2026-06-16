"""add_needs_checked_and_state_source

Revision ID: 6c2d9f7c1b2a
Revises: f31d7f4f4c10
Create Date: 2026-06-14 08:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6c2d9f7c1b2a"
down_revision: Union[str, Sequence[str], None] = ("f31d7f4f4c10", "e2a7f8c9b541")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("needs_checked", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("state_source", sa.String(length=16), nullable=False, server_default="auto"))


def downgrade() -> None:
    with op.batch_alter_table("truck_states", schema=None) as batch_op:
        batch_op.drop_column("state_source")
        batch_op.drop_column("needs_checked")
