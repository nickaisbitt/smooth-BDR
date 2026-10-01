#!/bin/bash
# Self-healing patch: openoutsend (<=0.1.32) imports `OpenAIModel` from
# pydantic_ai inside `_build_openai_compatible`, which pydantic_ai 2.x renamed
# to `OpenAIChatModel` (same constructor args). The rename lives in the
# uv-tool venv, so `uv tool upgrade` / reinstall wipes it. run.sh calls this
# before every `outsend` invocation, so the fix re-applies itself.
# Idempotent: no-ops when already patched, and no-ops if upstream ever fixes
# the import (nothing matches to replace). Scoped to `_build_openai_compatible`
# only — the `_build_openai` builder above it is untouched by design.
set -u

OUTSEND_BIN="$(command -v outsend 2>/dev/null)" || exit 0
PYBIN="$(sed -n '1s/^#!//p' "$OUTSEND_BIN" | awk '{print $1}')"
[ -n "$PYBIN" ] && [ -x "$PYBIN" ] || exit 0
LLM_PY="$("$PYBIN" -c "import cold_outreach.core.llm as m; print(m.__file__)" 2>/dev/null)" \
  || exit 0

RANGE='/def _build_openai_compatible/,/^_PROVIDER_BUILDERS/'
if sed -n "$RANGE"'p' "$LLM_PY" 2>/dev/null | grep -q "OpenAIModel"; then
  # "OpenAIModel" is not a substring of "OpenAIChatModel", so this is a
  # strict no-op on an already-patched file.
  sed -i.bak "$RANGE"'s/OpenAIModel/OpenAIChatModel/g' "$LLM_PY"
  echo "ensure_outsend_patch: re-applied OpenAIChatModel rename in $LLM_PY" >&2
fi

# Meta-via-OpenRouter only honours tool_choice "auto": forced and
# named-function choices 400 ("only `"auto"` is supported"). Pin the two
# forcing flags off so structured output falls back to unforced "auto".
# Idempotent: no-ops when the flags are already present.
if sed -n "$RANGE"'p' "$LLM_PY" 2>/dev/null | grep -q "base_url=api_base, api_key=api_key,"; then
  if ! sed -n "$RANGE"'p' "$LLM_PY" 2>/dev/null | grep -q "openai_supports_tool_choice_required"; then
    python3 - "$LLM_PY" <<'PY'
import re
import sys
path = sys.argv[1]
text = open(path).read()
old = """    return OpenAIChatModel(model, provider=OpenAIProvider(
        base_url=api_base, api_key=api_key,
    ))"""
    new = """    return OpenAIChatModel(model, provider=OpenAIProvider(
        base_url=api_base, api_key=api_key,
    ), profile={
        "openai_supports_tool_choice_required": False,
        "openai_supports_forced_tool_choice_with_thinking": False,
    })"""
    assert old in text, "builder shape changed, patch needs review"
    open(path, "w").write(text.replace(old, new, 1))
    print(f"ensure_outsend_patch: applied tool_choice auto-only profile in {path}")
PY
    echo "ensure_outsend_patch: applied tool_choice auto-only profile in $LLM_PY" >&2
  fi
fi
exit 0
