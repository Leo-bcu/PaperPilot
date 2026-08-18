"""Central configuration for the PaperReading backend.

Keep all runtime paths in one place so the demo remains easy to reason about
and future refactors do not scatter filesystem assumptions across modules.

API configuration is loaded from the workspace/api_config.json file,
with fallback to environment variables for backward compatibility.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    project_root: Path = Path(__file__).resolve().parents[3]
    data_dir: Path = project_root / "Data"
    workspace_dir: Path = project_root / "workspace"
    db_path: Path = workspace_dir / "paperreading.db"
    schema_path: Path = data_dir / "schema.sql"
    seed_path: Path = data_dir / "seed.sql"

    # Lazy-loaded from API config file or environment
    _api_key: str | None = None
    _base_url: str | None = None
    _model: str | None = None
    _provider: str | None = None
    _mineru_token: str | None = None
    _mineru_model_version: str | None = None
    _mineru_base_url: str | None = None

    def _load_api_config(self) -> None:
        """Load API configuration from the config file."""
        if self._api_key is not None:
            return  # Already loaded

        try:
            from app.services.api_config import load_config
            config = load_config()
            self._provider = config.provider
            self._api_key = config.api_key or os.getenv("DEEPSEEK_API_KEY", "")
            self._base_url = config.base_url or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
            self._model = config.model or os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
            # MinerU config
            self._mineru_token = config.mineru.token or os.getenv("MINERU_API_TOKEN", "")
            self._mineru_model_version = config.mineru.model_version or os.getenv("MINERU_MODEL_VERSION", "vlm")
            self._mineru_base_url = config.mineru.base_url or os.getenv("MINERU_BASE_URL", "https://mineru.net")
        except Exception:
            # Fallback to environment variables
            self._provider = os.getenv("DEEPSEEK_PROVIDER", "deepseek")
            self._api_key = os.getenv("DEEPSEEK_API_KEY", "")
            self._base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
            self._model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
            self._mineru_token = os.getenv("MINERU_API_TOKEN", "")
            self._mineru_model_version = os.getenv("MINERU_MODEL_VERSION", "vlm")
            self._mineru_base_url = os.getenv("MINERU_BASE_URL", "https://mineru.net")

    @property
    def provider(self) -> str:
        self._load_api_config()
        return self._provider or "deepseek"

    @property
    def deepseek_api_key(self) -> str:
        self._load_api_config()
        return self._api_key or ""

    @property
    def deepseek_base_url(self) -> str:
        self._load_api_config()
        return self._base_url or "https://api.deepseek.com"

    @property
    def deepseek_model(self) -> str:
        self._load_api_config()
        return self._model or "deepseek-v4-flash"

    @property
    def mineru_token(self) -> str:
        self._load_api_config()
        return self._mineru_token or ""

    @property
    def mineru_model_version(self) -> str:
        self._load_api_config()
        return self._mineru_model_version or "vlm"

    @property
    def mineru_base_url(self) -> str:
        self._load_api_config()
        return self._mineru_base_url or "https://mineru.net"

    def reset(self) -> None:
        """Reset cached API configuration so it will be reloaded from disk."""
        self._api_key = None
        self._base_url = None
        self._model = None
        self._provider = None
        self._mineru_token = None
        self._mineru_model_version = None
        self._mineru_base_url = None


settings = Settings()