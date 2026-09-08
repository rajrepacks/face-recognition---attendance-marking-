"""Application settings, loaded from environment / .env."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # postgresql+asyncpg://user:password@host:5432/dbname
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/face_attendance"

    # Comma separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173"

    api_prefix: str = "/api"

    # --- face recognition tuning -------------------------------------------------
    # Cosine similarity above which two embeddings are considered the same person.
    face_match_threshold: float = 0.65
    # MTCNN confidence required to accept a detection for enrolment / recognition.
    face_min_detection_prob: float = 0.90
    # A box below this confidence is treated as noise and not counted as a face at all.
    face_detection_floor: float = 0.60
    # Crop size fed to InceptionResnetV1 (the network was trained at 160x160).
    face_image_size: int = 160
    face_crop_margin: int = 14

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
