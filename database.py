from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:////app/.data/truckv2_prod.db"
    secret_key: str = "change-me-to-a-long-random-string"
    algorithm: str = "HS256"
    # 60 minutes — short-lived JWTs limit exposure if a token is leaked.
    # The axios interceptor transparently refreshes via the long-lived session
    # cookie, so users on tablets/phones never see a forced logout.
    access_token_expire_minutes: int = 60
    session_expiry_days: int = 30
    cors_origins: str = "*"
    timezone: str = "America/New_York"
    # Optional backup / replica database URLs (comma-separated for multiple).
    # Leave empty to skip. Example: postgresql+psycopg://user:pass@backup-host:5432/dbname
    backup_database_url: str = ""
    web_push_vapid_public_key: str = ""
    web_push_vapid_private_key: str = ""
    web_push_vapid_subject: str = "mailto:admin@readyroute.local"
    shortage_sheet_photos_dir: str = ""
    ollama_base_url: str = "http://192.168.1.132:30068"
    shortage_sheet_ollama_model: str = "minicpm-v:latest"
    shortage_sheet_ollama_timeout_seconds: int = 60
    shortage_sheet_llm_low_confidence_threshold: float = 0.82
    shortage_sheet_preprocess_max_image_side: int = 2400
    production_sync_source_url: str = "https://rdyroute.app/api/exports"
    production_sync_timeout_seconds: int = 180

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()

# Determine DB type before it's used anywhere else
_is_sqlite = settings.database_url.startswith("sqlite")

if settings.secret_key == "change-me-to-a-long-random-string":
    _msg = (
        "SECRET_KEY is using the insecure default value. "
        "Set SECRET_KEY to a strong random string in your .env file.\n"
        "Generate one with:  python -c \"import secrets; print(secrets.token_hex(32))\""
    )
    if not _is_sqlite:
        # Hard-fail in production (Postgres) — never run with the default key.
        raise RuntimeError(_msg)
    else:
        # Warn in development (SQLite) — still usable locally.
        import warnings as _warn
        _warn.warn(_msg, stacklevel=1)

if _is_sqlite:
    # SQLite needs check_same_thread=False under FastAPI's threadpool,
    # and pool_size/max_overflow don't apply to its default pool.
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    # Enable WAL mode + sane sync for crash safety and concurrent reads.
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - infra
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=5000")
        finally:
            cur.close()
else:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a DB session and ensures it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
