import hashlib
import json
import subprocess

from . import config, db

SENDER = config.env("SAB_OUTSEND_BIN", "outsend")


def lead_record(row) -> dict:
    domain = row["website"]
    lead_id = "sab-" + hashlib.sha1(domain.encode()).hexdigest()[:12]
    name = row["name"] or domain
    return {
        "lead_id": lead_id,
        "email": row["email"],
        "first_name": "",
        "last_name": "",
        "company": name,
        "title": "",
        "website": f"https://{domain}",
        "linkedin_url": "",
        "profile_text": row["plan_text"],
        "reason": f"fit {row['fit_score']}/100: {row['business_type']}",
    }


def ingest(min_fit: int, limit: int) -> None:
    conn = db.connect()
    rows = db.ready_for_ingest(conn, min_fit, limit)
    if not rows:
        print("nothing ready to ingest")
        return
    lines = "\n".join(json.dumps(lead_record(r)) for r in rows)
    print(lines)
    import os

    result = subprocess.run(
        [SENDER],
        input=lines,
        capture_output=True,
        text=True,
        env={**os.environ, "OUTSEND_HOME": str(config.HOME / "outsend")},
    )
    print(result.stderr.strip())
    if result.returncode == 0:
        for row in rows:
            db.mark_ingested(conn, row["id"])
        print(f"ingested {len(rows)} leads into outsend")


