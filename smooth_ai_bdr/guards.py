"""Brand + safety guards for the sab front half. Pure-python checks with no
network and no secrets: safe to run in tests and in wrapper preflights."""

import re
from pathlib import Path

BRAND_DOMAIN = "smoothaiconsultancy.com"
PLACEHOLDER_HINTS = (
    "[email",
    "email protected",
    "example.",
    "yourname",
    "your-email",
    "name@company",
    "@domain",
    "sentry",
    "wixpress",
    "aldusleaf",
    "sudtipos",
    "rfuenzalida",
    "impallari",
    # Cloudflare email-obfuscation + data-attribute scraper junk: the
    # visible "[email protected]" text and addresses built from
    # cfemail/data-cfemail payloads are never real contacts.
    "cloudflare",
    "data-cfemail",
    "cfemail",
)

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$")

IMAGE_TLDS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".bmp")

# Role prefixes that bounce when nobody owns the mailbox. info@/contact@
# sometimes work; sales@/reception@/support@ almost never survive on small
# business domains (5/5 5.1.1 on 2026-09-04). Prefer a named contact; when
# only a role address exists the lead stays audited, never ready.
WEAK_ROLE_PREFIXES = ("sales@", "reception@", "support@", "service@", "admin@")


def is_brand_domain_send(address: str) -> bool:
    """True if a send-from address would touch the brand domain."""
    addr = (address or "").strip().lower()
    domain = addr.rsplit("@", 1)[-1] if "@" in addr else addr
    return domain == BRAND_DOMAIN or domain.endswith("." + BRAND_DOMAIN)


def email_looks_real(email: str) -> bool:
    """Reject empty, malformed, and known placeholder/scraper-junk emails."""
    e = (email or "").strip().lower().rstrip(".")
    if not e or not EMAIL_RE.match(e):
        return False
    if any(e.endswith(t) for t in IMAGE_TLDS):
        return False
    return not any(h in e for h in PLACEHOLDER_HINTS)


def email_needs_verification(email: str) -> bool:
    """True when the address is real-shaped but likely to bounce.

    Any role prefix (info@, sales@, ...) may be unowned on a small
    business domain, so every role address gets RCPT-probed before
    ingest. Named contacts (first@, first.last@) skip the probe.
    """
    local = (email or "").strip().lower().split("@")[0] if "@" in (email or "") else ""
    if not local:
        return True
    role_prefixes = ("info@", "contact@", "hello@", "office@", "bookings@") + WEAK_ROLE_PREFIXES
    return any((local + "@").startswith(p) for p in role_prefixes)


def email_is_weak_role(email: str) -> bool:
    """True for role prefixes that bounce hardest; never ingest on these."""
    e = (email or "").strip().lower()
    return any(e.startswith(p) for p in WEAK_ROLE_PREFIXES)


def plan_cites_evidence(plan_text: str) -> bool:
    """The audit plan must reference concrete evidence, not generic claims."""
    t = (plan_text or "").strip()
    if len(t) < 80:
        return False
    markers = ("ISSUE:", "PLAN:", "QUICK WIN:", "EXPECTED:", "http", "$", "%")
    return any(m in plan_text for m in markers)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent
