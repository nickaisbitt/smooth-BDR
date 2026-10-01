import argparse

from . import audit, config, db, discover, guards, ingest


def main():
    parser = argparse.ArgumentParser(prog="sab", description="Smooth AI BDR — front half (discover, audit, feed outsend)")
    parser.add_argument("--home", default=None, help="project dir containing .env and config.yaml")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("discover", help="find candidate business websites via search")
    p.add_argument("-n", type=int, default=3, help="results per query")
    p.add_argument("--queries", nargs="*", help="override configured queries")

    sub.add_parser("audit", help="crawl + score + plan pending leads")
    p = sub.add_parser("audit-one", help="audit a single URL and print the result")
    p.add_argument("url")

    sub.add_parser("ingest", help="pipe ready leads into outsend")
    p = sub.add_parser("run", help="discover + audit in one pass")
    p.add_argument("--discover", type=int, default=3)
    p.add_argument("--audit", type=int, default=10)
    sub.add_parser("stats", help="lead counts by status")

    args = parser.parse_args()
    if args.home:
        config.HOME = __import__("pathlib").Path(args.home)
    config.dotenv()
    cfg = config.load()

    if args.cmd == "discover":
        queries = args.queries or cfg["icp"]["search_queries"]
        conn = db.connect()
        added = discover.discover(queries, args.n, conn)
        print(f"{added} new leads discovered")
    elif args.cmd == "audit":
        audit.run(cfg, args.audit if hasattr(args, "audit") else 10)
    elif args.cmd == "audit-one":
        host = args.url.split("//")[-1].split("/")[0].removeprefix("www.")
        row = {"id": 0, "website": host, "name": "", "description": ""}
        result, plan_text = audit.audit_lead(row, cfg)
        result.pop("_emails", None)
        print(result.get("plan", {}).get("headline", ""))
        print()
        print(plan_text or result.get("error", "no plan"))
    elif args.cmd == "ingest":
        sender = config.env("OUTSEND_MAILBOX_ADDRESS")
        if guards.is_brand_domain_send(sender):
            raise SystemExit(
                "refusing ingest: OUTSEND_MAILBOX_ADDRESS is on the brand "
                "domain (smoothaiconsultancy.com). Outreach sends from the "
                "secondary domain only."
            )
        ingest.ingest(cfg["limits"].get("min_fit_score", 60), cfg["limits"].get("ingest_per_run", 20))
    elif args.cmd == "run":
        conn = db.connect()
        queries = cfg["icp"]["search_queries"]
        added = discover.discover(queries, args.discover, conn)
        print(f"discovered {added}; auditing")
        audit.run(cfg, args.audit)
    elif args.cmd == "stats":
        conn = db.connect()
        for row in db.stats(conn):
            print(f"{row['status']:12} {row['n']}")


if __name__ == "__main__":
    main()
