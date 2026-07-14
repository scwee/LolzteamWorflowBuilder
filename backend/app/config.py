from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(ROOT_ENV), str(BACKEND_ENV), ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = "postgresql+asyncpg://lztbuilder:lztbuilder@localhost:5432/lztbuilder"
    database_url_sync: str = "postgresql+psycopg2://lztbuilder:lztbuilder@localhost:5432/lztbuilder"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    secrets_encryption_key: str = ""

    cors_origins: str = "http://localhost:3000"
    webhook_base_url: str = "http://localhost:8000"

    lzt_market_base_url: str = "https://prod-api.lzt.market"

    # Per-instance quotas (single local owner)
    max_active_flows_per_user: int = 50
    max_runs_per_hour: int = 120
    max_concurrent_runs_per_user: int = 3
    max_flow_file_bytes: int = 5_000_000

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        if self.is_production and not self.secrets_encryption_key:
            raise ValueError("SECRETS_ENCRYPTION_KEY is required in production")
        return self


settings = Settings()
