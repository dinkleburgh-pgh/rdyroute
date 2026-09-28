"""add section rotation tables

Three tables: the sections people rotate through (the main four plus the
floater), the people themselves, and one assignment row per (week, section).

The people list is deliberately separate from `users`: the floor includes
people with no login, and hanging the rotation off accounts would silently drop
exactly those people.

A skipped floater is the ABSENCE of an assignment row for that week, not a NULL
person — "nobody floated" and "not decided" are the same thing here.

Seeds five sections so the board is usable immediately. The names are
placeholders on purpose; they are editable in the app, because section names are
floor vocabulary and should never have needed a migration to change.

Revision ID: 4134688fe5a2
Revises: d4e5f6a7b8c9
Create Date: 2026-09-28 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "4134688fe5a2"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rotation_sections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_floater", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "rotation_people",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "rotation_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["rotation_sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["person_id"], ["rotation_people.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("week_start", "section_id", name="uq_rotation_week_section"),
    )
    op.create_index("ix_rotation_assignments_week_start", "rotation_assignments", ["week_start"])
    op.create_index("ix_rotation_assignments_section_id", "rotation_assignments", ["section_id"])
    op.create_index("ix_rotation_assignments_person_id", "rotation_assignments", ["person_id"])

    sections = sa.table(
        "rotation_sections",
        sa.column("name", sa.String),
        sa.column("sort_order", sa.Integer),
        sa.column("is_floater", sa.Boolean),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        sections,
        [
            {"name": "Section 1", "sort_order": 1, "is_floater": False, "is_active": True},
            {"name": "Section 2", "sort_order": 2, "is_floater": False, "is_active": True},
            {"name": "Section 3", "sort_order": 3, "is_floater": False, "is_active": True},
            {"name": "Section 4", "sort_order": 4, "is_floater": False, "is_active": True},
            {"name": "Floater", "sort_order": 5, "is_floater": True, "is_active": True},
        ],
    )


def downgrade() -> None:
    op.drop_table("rotation_assignments")
    op.drop_table("rotation_people")
    op.drop_table("rotation_sections")
