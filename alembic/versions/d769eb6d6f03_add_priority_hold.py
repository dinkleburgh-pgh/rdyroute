"""add_priority_hold

Revision ID: d769eb6d6f03
Revises: a1b2c3d4e5f6
Create Date: 2026-06-09 04:17:29.347691

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd769eb6d6f03'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('truck_states', schema=None) as batch_op:
        batch_op.add_column(sa.Column('priority_hold', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('truck_states', schema=None) as batch_op:
        batch_op.drop_column('priority_hold')
