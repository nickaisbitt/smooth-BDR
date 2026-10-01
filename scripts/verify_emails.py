#!/usr/bin/env python3
"""RCPT-probe role addresses before they can burn a send.

Reads leads in status 'audited' with an unverified role-prefix email,
probes the recipient MX with RCPT TO (quit before DATA, nothing sent),
and moves ACCEPTed leads to 'ready'. Weak role prefixes (sales@,
reception@, ...) are never probed: they bounced 5/5 on 2026-09-04 and
stay held. Named contacts skip the probe and move straight to ready.

Usage: scripts/verify_emails.py [--limit 20] [--apply]
  --apply actually updates the DB; without it, prints verdicts only.

Outbound port 25 is blocked on most residential networks, so a probe
that cannot connect reports UNREACHABLE (not REJECT): the lead stays
held, never marked bad on network failure alone.
"""
import smtplib
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smooth_ai_bdr import config, db, guards  # noqa: E402

SENDER = config.env("OUTSEND_MAILBOX_ADDRESS", "hi@smoothaigrowth.com")


def mx_hosts(domain: str) -> list:
    try:
        import dns.resolver
    except ImportError:
        return []
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=8)
        return [str(r.exchange).rstrip(".") for r in sorted(answers, key=lambda r: r.preference)]
    except Exception:
        return []


def rcpt_accepts(mx: str, addr: str) -> str:
    """ACCEPT / REJECT / UNREACHABLE. Never sends mail (quit before DATA)."""
    try:
        s = smtplib.SMTP(mx, 25, timeout=20)
    except (OSError, socket.error, smtplib.SMTPException):
        return "UNREACHABLE"
    try:
        s.ehlo("smoothaigrowth.com")
        s.mail(SENDER)
        code, _ = s.rcpt(addr)
        return "ACCEPT" if code == 250 else "REJECT"
    except (OSError, socket.error, smtplib.SMTPException):
        return "UNREACHABLE"
    finally:
        try:
            s.quit()
        except Exception:
            pass


def main() -> None:
    limit = 20
    apply = False
    args = list(sys.argv[1:])
    for i, arg in enumerate(args):
        if arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])
        elif arg == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
        elif arg == "--apply":
            apply = True
    conn = db.connect()
    rows = conn.execute(
        "SELECT * FROM leads WHERE status='audited' AND email != '' ORDER BY fit_score DESC LIMIT ?",
        (limit,),
    ).fetchall()
    if not rows:
        print("nothing to verify")
        return
    for row in rows:
        email = (row["email"] or "").strip()
        if guards.email_is_weak_role(email):
            print(f"  {row['website']}: {email} HELD (weak role prefix, never ingested)")
            continue
        if not guards.email_needs_verification(email):
            if apply:
                db.save_email(conn, row["id"], email)
            print(f"  {row['website']}: {email} NAMED (ready{' applied' if apply else ''})")
            continue
        mxs = mx_hosts(email.split("@")[-1])
        if not mxs:
            print(f"  {row['website']}: {email} NO_MX (held)")
            continue
        verdicts = [(mx, rcpt_accepts(mx, email)) for mx in mxs[:2]]
        if any(v == "ACCEPT" for _, v in verdicts):
            if apply:
                db.save_email(conn, row["id"], email)
            print(f"  {row['website']}: {email} ACCEPT {verdicts}{' applied' if apply else ''}")
        elif all(v == "UNREACHABLE" for _, v in verdicts):
            print(f"  {row['website']}: {email} UNREACHABLE {verdicts} (held, not marked bad)")
        else:
            print(f"  {row['website']}: {email} REJECT {verdicts} (held)")


if __name__ == "__main__":
    main()
