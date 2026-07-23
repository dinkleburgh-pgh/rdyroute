"""Add is_split to route_swaps and route_swap_log

A SPLIT load: the route truck ALSO runs — load_on_truck carries the
overflow as an EXTRA load slot, not a takeover. Very rare (oversized
routes, e.g. route 60 needing two trucks).

Revision ID: e8d4a1c7b3f2
Revises: c3a7d9f21e08
Create Date: 2026-07-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e8d4a1c7b3f2"
down_revision: Union[str, Sequence[str], None] = "c3a7d9f21e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "route_swaps",
        sa.Column("is_split", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "route_swap_log",
        sa.Column("is_split", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("route_swap_log", "is_split")
    op.drop_column("route_swaps", "is_split")
