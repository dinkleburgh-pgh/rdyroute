"""add pinned_section_id to rotation_people

A person pinned to a section holds exactly that section every build while
everyone else rotates fairly around them (newcomer on the training section,
a supervisor who only floats).

Revision ID: 7f3a9c1d2e45
Revises: 6d2b8e4f0a53
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "7f3a9c1d2e45"
down_revision = "6d2b8e4f0a53"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rotation_people") as batch:
        batch.add_column(sa.Column("pinned_section_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_rotation_people_pinned_section",
            "rotation_sections",
            ["pinned_section_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("rotation_people") as batch:
        batch.drop_constraint("fk_rotation_people_pinned_section", type_="foreignkey")
        batch.drop_column("pinned_section_id")
