import json
import re
import time

import httpx

from . import config

BASE = "https://openrouter.ai/api/v1"
MODEL = config.env("SAB_MODEL", "meta/muse-spark-1.3-contributor")
MAX_TOKENS = int(config.env("SAB_MAX_TOKENS", "3000"))


def chat(system: str, user: str, max_tokens: int = MAX_TOKENS) -> str:
    key = config.env("OUTSEND_LLM_API_KEY") or config.env("SAB_LLM_KEY")
    if not key:
        raise SystemExit("no LLM key: set OUTSEND_LLM_API_KEY in .env")
    body = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    last = None
    for attempt in range(3):
        try:
            r = httpx.post(
                f"{BASE}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=body,
                timeout=120,
            )
            data = r.json()
            if "choices" in data:
                content = data["choices"][0]["message"].get("content")
                if content:
                    return content
                last = RuntimeError("empty content (reasoning exceeded budget?)")
            else:
                last = RuntimeError(str(data)[:300])
        except Exception as exc:
            last = exc
        time.sleep(2 * (attempt + 1))
    raise last


def _repair(text: str) -> str:
    text = text.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    text = re.sub(r",\s*([}\]])", r"\1", text)
    open_curly, close_curly = text.count("{"), text.count("}")
    open_square, close_square = text.count("["), text.count("]")
    text += "}" * max(0, open_curly - close_curly) + "]" * max(0, open_square - close_square)
    if text.count('"') % 2 == 1:
        text += '"'
    return text


def llm_json(system: str, user: str, max_tokens: int = MAX_TOKENS) -> dict:
    text = chat(system + "\nRespond with JSON only. No prose, no markdown fences. Compact JSON.", user, max_tokens)
    candidate = re.search(r"\{.*\}", text, re.DOTALL)
    if not candidate:
        candidate = re.search(r"\{.*", text, re.DOTALL)
    if not candidate:
        raise ValueError(f"no JSON in reply: {text[:200]}")
    raw = candidate.group(0).strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    for attempt in (raw, _repair(raw), _repair(raw[: int(len(raw) * 0.75)])):
        try:
            return json.loads(attempt)
        except json.JSONDecodeError:
            continue
    raise ValueError(f"unparseable JSON: {raw[:300]}")
