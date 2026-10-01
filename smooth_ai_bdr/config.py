import os
from pathlib import Path

import yaml

HOME = Path(os.environ.get("SAB_HOME", Path(__file__).resolve().parent.parent))


def load():
    path = Path(os.environ.get("SAB_CONFIG", HOME / "config.yaml"))
    if not path.exists():
        raise SystemExit(f"config not found: {path} — copy config.example.yaml to config.yaml")
    with open(path) as f:
        return yaml.safe_load(f)


def env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def dotenv(path: Path | None = None) -> None:
    path = path or HOME / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
