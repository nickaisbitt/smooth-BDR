#!/usr/bin/env python3
"""Kill-criteria + funnel stats from the two SQLite stores (read-only).

Usage: stats_report.py [--db SAB_DB] [--outsend OUTSEND_DB]
Prints: sab funnel (discovered/audited/ready by status), outsend deals by
state+outcome, messages sent vs replies received, prompt-line mix on sent
openers, and the reply-rate vs the 1.5%-after-60-days kill criterion.

Opens both DBs read-only (mode=ro URI). Never writes, never sends.
"""
import argparse
import sqlite3
import sys
from datetime import date

KILL_RATE = 0.015
KILL_DAYS = 60


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/sab.sqlite3")
    ap.add_argument("--outsend", default="outsend/data/db.sqlite3")
    args = ap.parse_args()

    sab = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    print("== sab funnel ==")
    for status, n in sab.execute(
        "SELECT status, COUNT(*) AS n FROM leads GROUP BY status ORDER BY n DESC"
    ):
        print(f"  {status:<12} {n}")
    first = sab.execute("SELECT MIN(DATE(created_at)) FROM leads").fetchone()[0]
    print(f"  oldest lead: {first}")
    sab.close()

    out = sqlite3.connect(f"file:{args.outsend}?mode=ro", uri=True)
    print("== outsend deals ==")
    for state, outcome, n in out.execute(
        "SELECT state, COALESCE(outcome,''), COUNT(*) AS n "
        "FROM outsend_leads_deal GROUP BY state, outcome ORDER BY n DESC"
    ):
        print(f"  {state:<12} {outcome:<14} {n}")
    sent = out.execute(
        "SELECT COUNT(*) FROM outsend_emails_message WHERE direction='out'"
    ).fetchone()[0]
    # direction='in' includes Mailer-Daemon bounces: count only genuine
    # lead replies (2026-09-04: 5/5 inbound were bounce notices, 0 real).
    recv = out.execute(
        "SELECT COUNT(*) FROM outsend_emails_message WHERE direction='in' "
        "AND from_address NOT LIKE 'mailer-daemon@%'"
    ).fetchone()[0]
    print(f"== messages: sent={sent} received={recv} ==")
    print("== prompt-line mix (sent openers) ==")
    for pid, digest, n in out.execute(
        "SELECT COALESCE(prompt_line_id,''), COALESCE(prompt_line_digest,''), "
        "COUNT(*) AS n FROM outsend_emails_message WHERE direction='out' "
        "GROUP BY prompt_line_id, prompt_line_digest ORDER BY n DESC"
    ):
        print(f"  {pid or '(none)':<28} {digest:<12} {n}")
    first_send = out.execute(
        "SELECT MIN(DATE(sent_at)) FROM outsend_emails_message "
        "WHERE direction='out' AND sent_at IS NOT NULL"
    ).fetchone()[0]
    if first_send:
        days = (date.today() - date.fromisoformat(first_send)).days
        rate = (recv / sent) if sent else 0.0
        print(f"== kill criterion: {rate:.1%} reply over {days}d "
              f"(kill if < {KILL_RATE:.1%} after {KILL_DAYS}d) ==")
        if days >= KILL_DAYS and sent > 0 and rate < KILL_RATE:
            print("  KILL TRIGGERED: fix message/ICP, not the tool.")
            sys.exit(2)
        print("  ok (too early or above threshold).")
    else:
        print("== kill criterion: no live sends yet; clock starts on first send ==")
    out.close()


if __name__ == "__main__":
    main()
