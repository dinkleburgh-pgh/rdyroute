"""merge the two open heads

The history had branched: `e2a7f8c9b541` (shortage header columns) and
`b8c9d0e1f2a3` (has_nogs) were both heads. That is not cosmetic. `main.py`
runs `alembic upgrade "head"` at startup, which RAISES on an ambiguous head,
and the except-branch falls back to `create_all()` + `stamp("head")`.
`create_all()` only creates MISSING TABLES — it never adds a column to a table
that already exists — so from the moment the branch appeared, every new column
on an existing table (truck_states above all) would silently never be created,
and the failure only shows up later as a 500 on the first read of that column.
Prod sat on b8c9d0e1f2a3 with the other branch unapplied.

Merging restores a single head so `upgrade("head")` resolves again.

Revision ID: c1d2e3f4a5b6
Revises: e2a7f8c9b541, b8c9d0e1f2a3
Create Date: 2026-09-28 00:00:00.000000
"""

from typing import Sequence, Union

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = ("e2a7f8c9b541", "b8c9d0e1f2a3")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
