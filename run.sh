#!/bin/bash
# Loads .env then runs a sab command. Cron entry example:
#   17 9 * * 1-5  ~/Projects/smoothai-consultancy/bdr/run.sh run && ~/Projects/smoothai-consultancy/bdr/run.sh ingest
#   */30 * * * *  ~/Projects/smoothai-consultancy/bdr/run.sh outsend send
set -a
source "$(dirname "$0")/.env"
set +a
export OUTSEND_HOME="$(dirname "$0")/outsend"
export SAB_HOME="$(dirname "$0")"
cd "$(dirname "$0")"
SAB="$PWD/.venv/bin/sab"
case "$1" in
  outsend)
    shift
    "$PWD/scripts/ensure_outsend_patch.sh"
    # Source of truth for our prompt lines lives in brand/prompt_lines/
    # (outsend/ is gitignored state). Sync into the live dir every run.
    for f in "$PWD"/brand/prompt_lines/*.toml; do
      [ -e "$f" ] && cp "$f" "$OUTSEND_HOME/prompt_lines/" 2>/dev/null
    done
    exec outsend "$@"
    ;;
  *) exec "$SAB" "$@" ;;
esac
