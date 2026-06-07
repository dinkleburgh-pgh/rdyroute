from logging.config import fileConfig
import os

from sqlalchemy import engine_from_config, pool
from alembic import context

# ---------------------------------------------------------------------------
# Alembic config
# ---------------------------------------------------------------------------
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# App imports — make models available for autogenerate
# ---------------------------------------------------------------------------
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))  # project root

from database import Base, settings  # noqa: E402
import models  # noqa: E402, F401 — registers all ORM models with Base.metadata

target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# URL resolution
# ---------------------------------------------------------------------------

def _get_url() -> str:
    """Prefer DATABASE_URL env var; fall back to database.py settings."""
    return os.environ.get("DATABASE_URL", settings.database_url)


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (generates SQL script)."""
    url = _get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # SQLite needs batch mode for ALTER TABLE operations.
        render_as_batch=url.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    url = _get_url()
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite requires batch mode for ALTER TABLE operations.
            render_as_batch=url.startswith("sqlite"),
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
