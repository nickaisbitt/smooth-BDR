import re
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-CA,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

CHAT_MARKERS = ["crisp", "tawk.to", "intercom", "drift", "tidio", "livechat", "hubspot-messages", "chatbase", "zendesk chat", "chatbot"]
BOOKING_MARKERS = ["calendly", "setmore", "simplybook", "booksy", "acuityscheduling", "schedulicity", "vagaro", "cal.com", "squareup", "fresha", " picktime"]
CMS_MARKERS = {"wix.com": "Wix", "squarespace": "Squarespace", "wp-content": "WordPress", "shopify": "Shopify", "godaddy": "GoDaddy", "webflow": "Webflow", "duda": "Duda", "weebly": "Weebly"}

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
BAD_EMAIL_HINTS = ("example.", "sentry", "wixpress", "godaddy", ".png", ".jpg", ".webp", ".gif", "[email", "email protected", "yourname", "your-email", "name@company", "@domain",
                     # Cloudflare email protection: obfuscated payloads and
                     # the visible "[email protected]" text are scraper junk.
                     "cloudflare", "data-cfemail", "cfemail", "__cf_email__",
                     # Font/template credits embedded in site footers (seen
                     # 2026-09-04 on thedentalclinic.ca): the foundry and
                     # designer addresses, not the business contact.
                     "aldusleaf", "sudtipos", "rfuenzalida", "impallari")


def decode_cfemail(hexs: str) -> str:
    """Decode a Cloudflare data-cfemail payload (first byte is the XOR key).

    Sites behind Cloudflare email protection render "[email protected]"
    plus this payload; the address is public (browsers decode it for display),
    so decoding recovers the real contact instead of discarding it.
    Returns "" on malformed input.
    """
    try:
        raw = bytes.fromhex(hexs.strip())
        if len(raw) < 2:
            return ""
        return bytes(b ^ raw[0] for b in raw[1:]).decode()
    except Exception:
        return ""


CFEMAIL_RE = re.compile(r'data-cfemail="([0-9a-fA-F]+)"')


def fetch(client: httpx.Client, url: str) -> str:
    try:
        r = client.get(url, follow_redirects=True, timeout=20)
        if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
            return r.text
    except Exception:
        pass
    return ""


def visible_text(html: str, limit: int = 6000) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return text[:limit]


def markers(html: str) -> dict:
    low = html.lower()
    return {
        "chat": [m for m in CHAT_MARKERS if m in low],
        "booking": [m for m in BOOKING_MARKERS if m in low],
        "cms": next((v for k, v in CMS_MARKERS.items() if k in low), "unknown"),
        "has_form": "<form" in low,
    }


def scrape_site(website: str) -> dict:
    base = website if website.startswith("http") else f"https://{website}"
    host = urlparse(base).netloc
    out = {"website": host, "title": "", "meta": "", "text": "", "contact_text": "", "emails": [], "markers": {}}
    with httpx.Client(headers=BROWSER_HEADERS) as client:
        home = fetch(client, base)
        if not home:
            return out
        soup = BeautifulSoup(home, "html.parser")
        out["title"] = soup.title.get_text(strip=True)[:150] if soup.title else ""
        md = soup.find("meta", attrs={"name": "description"})
        out["meta"] = md.get("content", "")[:200] if md else ""
        out["text"] = visible_text(home)
        out["markers"] = markers(home)

        emails = set(re.findall(EMAIL_RE, home))
        emails |= {e for m in CFEMAIL_RE.findall(home) if (e := decode_cfemail(m))}
        contact_html = ""
        for path in ("/contact", "/contact-us", "/about", "/about-us", "/book", "/book-online"):
            candidate = urljoin(base + "/", path.lstrip("/"))
            html = fetch(client, candidate)
            if html:
                contact_html += html
                emails |= set(re.findall(EMAIL_RE, html))
                emails |= {e for m in CFEMAIL_RE.findall(html) if (e := decode_cfemail(m))}
        if contact_html:
            out["contact_text"] = visible_text(contact_html, 3000)
            out["markers"] = {**out["markers"], **{k: v or out["markers"].get(k) for k, v in markers(contact_html).items()}}

        for e in emails:
            e = e.lower().strip(".")
            if not any(h in e for h in BAD_EMAIL_HINTS):
                out["emails"].append(e)
        out["emails"] = sorted(set(out["emails"]))[:8]
    return out
