from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed runtime configuration. Every value can be overridden with an env var."""

    app_name: str = "Intentra"
    version: str = "2.0.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    log_json: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Language model used to compile intent. "none" keeps the deterministic parser only.
    llm_provider: Literal["gemini", "anthropic", "none"] = "none"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5"
    llm_timeout_seconds: float = Field(default=9.0, ge=1, le=60)

    # Upstream data services.
    overpass_mirrors: str = (
        "https://lz4.overpass-api.de/api/interpreter,"
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.kumi.systems/api/interpreter"
    )
    overpass_timeout_seconds: float = Field(default=14.0, ge=3, le=60)
    overpass_cache_ttl_seconds: int = Field(default=900, ge=0)
    routing_base_url: str = "https://routing.openstreetmap.de"
    routing_timeout_seconds: float = Field(default=7.0, ge=1, le=30)
    routing_enabled: bool = True
    geocode_base_url: str = "https://photon.komoot.io"
    geocode_timeout_seconds: float = Field(default=6.0, ge=1, le=30)
    weather_enabled: bool = True
    weather_base_url: str = "https://api.open-meteo.com"
    weather_timeout_seconds: float = Field(default=6.0, ge=1, le=30)
    user_agent: str = "Intentra/2.0 (+https://github.com/raunit/intentra)"

    # Planner limits.
    max_candidates_per_category: int = Field(default=80, ge=10, le=200)
    max_alternatives: int = Field(default=3, ge=1, le=6)

    # Protection.
    rate_limit_per_minute: int = Field(default=40, ge=1)
    geocode_rate_limit_per_minute: int = Field(default=150, ge=1)
    request_timeout_seconds: float = Field(default=50.0, ge=5, le=180)

    # Storage.
    database_path: str = "data/intentra.db"
    web_dist_dir: str = "../web/dist"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*":
            return ["*"]
        return [item.strip() for item in raw.split(",") if item.strip()]

    @property
    def overpass_mirror_list(self) -> list[str]:
        return [item.strip() for item in self.overpass_mirrors.split(",") if item.strip()]

    @property
    def llm_ready(self) -> bool:
        if self.llm_provider == "gemini":
            return bool(self.gemini_api_key)
        if self.llm_provider == "anthropic":
            return bool(self.anthropic_api_key)
        return False


@lru_cache
def get_settings() -> Settings:
    return Settings()
