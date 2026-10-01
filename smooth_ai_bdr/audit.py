import json

from . import db, guards, llm, scrape

SYSTEM_AUDIT = """You are a pragmatic digital consultant auditing small-business websites for AI and automation opportunities.
Given a business's website content and detected tech markers, you:
1. Judge how well the business fits the consultancy's target profile (fit_score 0-100).
2. List concrete, evidence-grounded issues visible from the site (never invent facts).
3. Build a short, specific AI Opportunity Plan.
Be concrete and plain-spoken. Reference what the site actually shows. No hype words."""


def build_plan_text(audit: dict, company: str) -> str:
    lines = [f"Audit of {company} ({audit.get('business_type', 'business')}):"]
    for issue in audit.get("issues", [])[:4]:
        lines.append(f"- ISSUE: {issue.get('title')} — {issue.get('evidence')} → {issue.get('impact')}")
    plan = audit.get("plan", {})
    for rec in plan.get("recommendations", [])[:3]:
        lines.append(f"- PLAN: {rec.get('title')}: {rec.get('what')} ({rec.get('timeframe')})")
    for win in plan.get("quick_wins", [])[:2]:
        lines.append(f"- QUICK WIN: {win}")
    if plan.get("expected_outcomes"):
        lines.append(f"- EXPECTED: {'; '.join(plan['expected_outcomes'][:2])}")
    return "\n".join(lines)


def audit_lead(lead, cfg) -> tuple[dict, str]:
    site = scrape.scrape_site(lead["website"])
    if not site["text"]:
        return {"fit_score": 0, "business_type": "", "issues": [], "plan": {}, "error": "site unreachable"}, ""

    markers = site["markers"]
    user = f"""CONSULTANCY: {cfg['business']['name']} — {cfg['business']['value_prop']}
TARGET PROFILE: {cfg['icp']['description']}

BUSINESS: {lead['name'] or site['title']}
WEBSITE: {site['website']}
MARKERS DETECTED: {json.dumps(markers)}
EMAILS ON SITE: {site['emails'][:5]}

HOMEPAGE TEXT:
{site['text'][:3500]}

CONTACT PAGE TEXT:
{site['contact_text'][:1500]}

Return JSON:
{{
  "fit_score": 0-100,
  "business_type": "one line",
  "issues": [{{"title": "...", "evidence": "what the site shows", "impact": "business cost"}}],
  "plan": {{
    "headline": "one-line plan title",
    "recommendations": [{{"title": "...", "what": "...", "why": "...", "timeframe": "e.g. week 1-2"}}],
    "quick_wins": ["..."],
    "expected_outcomes": ["..."]
  }},
  "found_emails": ["best contact email from the site, or empty"]
}}
Max 4 issues, 3 recommendations, 2 quick wins, 2 outcomes. Every issue must cite real evidence from the text above."""
    audit = llm.llm_json(SYSTEM_AUDIT, user)

    emails = [e for e in site["emails"] if any(e.endswith("@" + site["website"].split(".")[-2]) or e.split("@")[-1] in site["website"] for _ in [0])]
    if not emails:
        emails = site["emails"]
    emails = [e for e in emails if guards.email_looks_real(e)]
    if audit.get("found_emails"):
        emails = [e for e in audit["found_emails"] if isinstance(e, str)] + emails
    audit["_emails"] = emails[:3]
    return audit, build_plan_text(audit, lead["name"] or site["title"])


def run(cfg, limit: int) -> None:
    conn = db.connect()
    leads = db.pending_audit(conn, limit)
    print(f"auditing {len(leads)} leads")
    for lead in leads:
        try:
            audit, plan_text = audit_lead(lead, cfg)
            if not guards.plan_cites_evidence(plan_text):
                print(f"  {lead['website']}: plan lacks evidence, held for review")
                db.save_audit(conn, lead["id"], {**audit, "fit_score": 0}, plan_text)
                continue
            db.save_audit(conn, lead["id"], audit, plan_text)
            emails = audit.get("_emails", [])
            # Weak role prefixes hold the lead at audited: they bounced 5/5
            # on 2026-09-04. Only a named contact or a verified role address
            # may move a lead to ready (see scripts/verify_emails.py).
            picked = emails[0] if emails else ""
            if picked and not guards.email_is_weak_role(picked):
                db.save_email(conn, lead["id"], picked)
            print(f"  {lead['website']}: fit={audit.get('fit_score')} email={picked or 'NONE'}")
        except Exception as exc:
            print(f"  {lead['website']}: FAILED {exc}")
