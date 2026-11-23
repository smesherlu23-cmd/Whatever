"""Версия приложения одна во всех местах, где она записана."""

import json
import re
import tomllib
from pathlib import Path

from app import __version__

ROOT = Path(__file__).resolve().parents[2]


def test_version_is_the_same_everywhere() -> None:
    backend = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())["project"]["version"]
    frontend = json.loads((ROOT / "frontend/package.json").read_text())["version"]
    changelog = re.search(r"^## (\S+)", (ROOT / "CHANGELOG.md").read_text(), re.MULTILINE)
    assert changelog is not None
    assert __version__ == backend == frontend == changelog.group(1)
