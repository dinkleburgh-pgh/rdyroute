"""add uniform_size to trucks

Revision ID: a1b2c3d4e5f6
Revises: 8c3167adbb26
Create Date: 2026-06-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "8c3167adbb26"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trucks", sa.Column("uniform_size", sa.String(length=2), nullable=True))


def downgrade() -> None:
    op.drop_column("trucks", "uniform_size")
