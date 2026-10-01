#!/usr/bin/env python3
"""Wrap a reply-stage email body in the brand HTML wrapper (repo-owned).

Usage: wrap_reply.py <subject> < body.txt > out.eml-body.html
Reads plain-text body on stdin, emits the wrapper with {{subject}} and
{{body_html}} substituted (paragraphs wrapped in <p>, HTML-escaped).

Why a script, not a tool patch: openoutsend's sender is plain-text only
by design (deliverability for cold mail). The wrapper is for HAND-SENT
warm-thread continuations: compose in the agent, wrap here, paste into
webmail. No dependency on the installed tool, survives upgrades.
"""
import html
import sys
from pathlib import Path

WRAPPER = Path(__file__).resolve().parent.parent / "brand" / "email-wrapper.html"


def main() -> None:
    subject = sys.argv[1] if len(sys.argv) > 1 else ""
    body = sys.stdin.read().strip()
    paras = "".join(
        f"<p style=\"margin:0 0 14px;\">{html.escape(p.strip())}</p>"
        for p in body.split("\n\n")
        if p.strip()
    )
    template = WRAPPER.read_text()
    out = template.replace("{{subject}}", html.escape(subject)).replace(
        "{{body_html}}", paras
    )
    sys.stdout.write(out)


if __name__ == "__main__":
    main()
