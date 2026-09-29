"""rotation_people.active_since — the first week each person was on the rotation

The fair planner (rotation_planner.py) needs to know who was on the roster in
each past week: someone on the roster with no row in a planned week sat it
out. Without it, a newcomer was credited with sit-outs for every week before
they joined, and the planner benched the long-standing people ahead of them.

NULL means "no record" and is treated as on the roster throughout, which is
exactly how everyone was treated before this column existed. Backfilled from
each person's earliest assignment week (a correlated subquery, so it runs on
the SQLite dev database as well as Postgres).

Revision ID: 6d2b8e4f0a53
Revises: 5e1a7c3d9b42
Create Date: 2026-09-29 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "6d2b8e4f0a53"
down_revision = "5e1a7c3d9b42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rotation_people", sa.Column("active_since", sa.Date(), nullable=True))
    op.execute(sa.text(
        "UPDATE rotation_people SET active_since = ("
        "SELECT MIN(a.week_start) FROM rotation_assignments a "
        "WHERE a.person_id = rotation_people.id)"
    ))


def downgrade() -> None:
    op.drop_column("rotation_people", "active_since")
