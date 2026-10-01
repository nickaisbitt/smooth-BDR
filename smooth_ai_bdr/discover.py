import httpx

from . import config, db

TAVILY = "https://api.tavily.com/search"

SKIP_DOMAINS = ("facebook.", "linkedin.", "instagram.", "twitter.", "x.com", "yelp.", "yell.", "tripadvisor.", "bbb.org", "reddit.", "youtube.", "tiktok.", "pinterest.", "yellowpages.", "opendi.", "cylex.", "hotfrog.", "trustpilot.", "google.", "apple.com", "bark.com", "thumbtack.", "angi.", "homeadvisor.", "checkatrade.", "houzz.")
BLOCKED_TLDS = (".ru", ".su", ".by", ".ir", ".kp", ".sy")


def ddg_search(query: str, n: int) -> list:
    from ddgs import DDGS

    raw = DDGS().text(query, max_results=n)
    return [{"url": r["href"], "title": r.get("title", ""), "content": r.get("body", "")} for r in raw]


def tavily_search(query: str, n: int) -> list:
    key = config.env("SAB_TAVILY_KEY")
    r = httpx.post(
        TAVILY,
        json={"api_key": key, "query": query, "max_results": n, "search_depth": "basic"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("results", [])


def search(query: str, n: int) -> list:
    if config.env("SAB_TAVILY_KEY"):
        return tavily_search(query, n)
    return ddg_search(query, n)


def domain_of(url: str) -> str:
    host = url.split("//")[-1].split("/")[0].lower()
    return host[4:] if host.startswith("www.") else host


def host_matches(host: str, entry: str) -> bool:
    """Suffix-aware domain match: 'x.com' skips x.com + sub.x.com,
    never x.company.com. Entries ending in '.' match any TLD suffix."""
    host = (host or "").lower().strip().strip(".")
    raw_entry = (entry or "").lower().strip()
    wildcard = raw_entry.endswith(".")
    raw = raw_entry.strip(".")
    if not host or not raw:
        return False
    if wildcard:
        stem = raw
        # Exact host also matches ("x.com" satisfies "x.com."): the wildcard
        # only widens to sibling subdomains, never to lookalikes.
        return host == stem or any(part == stem for part in host.split("."))
    return host == raw or host.endswith("." + raw)


def acceptable(host: str) -> bool:
    if any(host_matches(host, b) for b in SKIP_DOMAINS):
        return False
    tld = "." + host.rsplit(".", 1)[-1]
    return tld not in BLOCKED_TLDS


def discover(queries: list[str], per_query: int, conn) -> int:
    added = 0
    for query in queries:
        try:
            results = search(query, per_query)
        except Exception as exc:
            print(f"  search failed for {query!r}: {exc} (skipped, rest continue)")
            continue
        for result in results:
            url = result.get("url", "")
            host = domain_of(url)
            if not host or not acceptable(host):
                continue
            if db.upsert_discovered(conn, host, result.get("title", "")[:150], result.get("content", "")):
                added += 1
    return added
