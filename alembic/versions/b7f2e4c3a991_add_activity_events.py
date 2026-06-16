"""add_activity_events

Revision ID: b7f2e4c3a991
Revises: 6c2d9f7c1b2a
Create Date: 2026-06-14 13:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7f2e4c3a991"
down_revision: Union[str, Sequence[str], None] = "6c2d9f7c1b2a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_type", sa.String(length=16), nullable=False),
        sa.Column("actor_username", sa.String(length=80), nullable=True),
        sa.Column("actor_display_name", sa.String(length=120), nullable=True),
        sa.Column("actor_role", sa.String(length=40), nullable=True),
        sa.Column("event_family", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("run_date", sa.Date(), nullable=True),
        sa.Column("truck_number", sa.Integer(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("status_before", sa.String(length=32), nullable=True),
        sa.Column("status_after", sa.String(length=32), nullable=True),
        sa.Column("diff_json", sa.JSON(), nullable=False),
        sa.Column("context_json", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_activity_events_occurred_at"), "activity_events", ["occurred_at"], unique=False)
    op.create_index(op.f("ix_activity_events_actor_username"), "activity_events", ["actor_username"], unique=False)
    op.create_index(op.f("ix_activity_events_event_family"), "activity_events", ["event_family"], unique=False)
    op.create_index(op.f("ix_activity_events_event_type"), "activity_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_activity_events_run_date"), "activity_events", ["run_date"], unique=False)
    op.create_index(op.f("ix_activity_events_truck_number"), "activity_events", ["truck_number"], unique=False)
    op.create_index(op.f("ix_activity_events_status_before"), "activity_events", ["status_before"], unique=False)
    op.create_index(op.f("ix_activity_events_status_after"), "activity_events", ["status_after"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_activity_events_status_after"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_status_before"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_truck_number"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_run_date"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_event_type"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_event_family"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_actor_username"), table_name="activity_events")
    op.drop_index(op.f("ix_activity_events_occurred_at"), table_name="activity_events")
    op.drop_table("activity_events")
