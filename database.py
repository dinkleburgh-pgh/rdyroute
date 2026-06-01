from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://coxnas:secure_truck_pass@ix-postgres-postgres-1:5432/coxnas"
    )
    secret_key: str = "change-me-to-a-long-random-string"
    algorithm: str = "HS256"
    # 60 minutes — short-lived JWTs limit exposure if a token is leaked.
    # The axios interceptor transparently refreshes via the long-lived session
    # cookie, so users on tablets/phones never see a forced logout.
    access_token_expire_minutes: int = 60
    session_expiry_days: int = 30
    cors_origins: str = "*"
    timezone: str = "America/New_York"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()

if settings.secret_key == "change-me-to-a-long-random-string":
    import warnings
    warnings.warn(
        "SECRET_KEY is using the insecure default value. "
        "Set a strong random secret in your .env file before deploying to production.",
        stacklevel=1,
    )

_is_sqlite = settings.database_url.startswith("sqlite")

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
