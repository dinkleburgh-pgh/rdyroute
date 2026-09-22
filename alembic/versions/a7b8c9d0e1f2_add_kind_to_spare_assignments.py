"""add kind to spare_assignments

Distinguishes classic OOS spare coverage from crossloads (freight moved off a
same-day truck) so the report can label them differently. Existing rows are
all classic coverage — server_default backfills them as "oos".

Revision ID: a7b8c9d0e1f2
Revises: d4a7c1e9b620
Create Date: 2026-09-22
"""
import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "d4a7c1e9b620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "spare_assignments",
        sa.Column("kind", sa.String(16), nullable=False, server_default="oos"),
    )


def downgrade() -> None:
    op.drop_column("spare_assignments", "kind")
