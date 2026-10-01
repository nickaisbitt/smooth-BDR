# smooth-ai-bdr

Autonomous BDR pipeline for Smooth AI Consultancy. Open-source, BYOK, ~<$30/mo.

- **Front half (this repo, `sab`)**: discovers business websites via DuckDuckGo search (no key
  needed; set `SAB_TAVILY_KEY` to upgrade to Tavily quality, optional), crawls each site,
  scores ICP fit, detects tech markers (chat/booking/CMS/forms), and generates a personalized
  "AI Opportunity Plan" per business via OpenRouter.
- **Back half (`outsend`**, installed via `uv tool install openoutsend`**)**: connects your mailbox,
  writes openers grounded in the audit plan, answers replies, follows up quiet leads, suppresses
  opt-outs, enforces sending windows/pace/daily caps.
- **Brand + voice (`brand/`)**: identity guide (`identity.md`, source of
  truth), design tokens mirrored from the live site (`tokens.json`), logo
  source + rules (`logo-mark.svg`, `logo.md`), plain-text signature
  (`signature.txt`), reply-stage HTML wrapper (`email-wrapper.html`),
  opener prompt lines (`prompt_lines/`, day-in-life primary).
  Cold mail stays text-only (no image logos — spam weight); the wrapper is
  for warm reply-stage threads only.
- **Guards (`smooth_ai_bdr/guards.py`, tested in `tests/`)**: ingest refuses
  brand-domain senders, audit re-filters placeholder + font-foundry junk
  emails, holds weak-role prefixes at audited and evidence-free plans for
  review. Pre-send probe: `scripts/verify_emails.py` (dry-run default).

## Setup checklist

1. `.env` — OpenRouter key restore: edit the `OUTSEND_LLM_API_KEY=""` line by hand, or copy the
   key to clipboard and run
   `cd ~/Projects/smoothai-consultancy/bdr && sed -i '' "s|OUTSEND_LLM_API_KEY=\"\"|OUTSEND_LLM_API_KEY=\"$(pbpaste | tr -d '[:space:]')\"|" .env`.
   Still needed for live sending:
   - Mailbox on a **secondary domain** + `OUTSEND_MAILBOX_*` / `OUTSEND_SMTP_*` / `OUTSEND_IMAP_*`
   - `OUTSEND_BOOKING_LINK` (Cal.com) so warm replies can book instantly
2. Refine `OUTSEND_PRODUCT_DOCS` / `OUTSEND_CAMPAIGN_TARGET` in `.env` — this is what every email is written from.
3. Tune `config.yaml` search queries to the verticals you want first.
4. `outsend check` — verifies the mailbox can send/receive.
5. Warm the new domain ~3 weeks before scaling (low volume, real recipients).

## Daily operation (scheduler)

Run via the Muse session scheduler (`muse cron_*`), not system crontab, so
jobs are listed, pausable, and auto-expire:

- Job A (pipeline, weekdays ~09:17 local):
  `run.sh run --discover 5 --audit 10 && run.sh ingest`, then `sab stats`.
- Job B (sender, weekdays ~09:45 and ~16:30 local):
  `run.sh outsend send 5` — one bounded pass per fire, replies exempt
  from caps by design.

Built-in sender guards (openoutsend `cold_outreach/core/conf.py`, no env
knobs): warm floor 5/day ramping ×1.25 (~3 weeks), 3.5–4.5 min send
spacing, Mon–Fri 08:00–20:00 operator-local window, max 3 touches/lead,
bounce kill-switch at 5%.

## Manual commands

```
sab discover -n 5                 # search for candidates (DuckDuckGo, no key)
sab audit                         # crawl + score + plan all pending
sab audit-one https://example.com # inspect one site's audit before trusting the batch
sab ingest                        # pipe ready leads into outsend (refuses brand-domain sender)
sab stats                         # pipeline counts
run.sh outsend send 5             # one bounded send pass (max 5 new conversations)
.venv/bin/python -m unittest discover -s tests   # guard tests, no network/sends
```

## Cost model

- OpenRouter `meta/muse-spark-1.3-contributor`: $0.10/M in, $0.20/M out — fractions of a cent per audit/email.
- Tavily: free tier.
- Domain: ~$12/yr. Everything else: $0.

## Rules of the road

- Never send from smoothaiconsultancy.com. Secondary domain only.
- CASL (Canada) applies to you: real opt-out line (outsend appends one), honour suppressions (it does),
  keep volumes human (40-50/day/mailbox max, enforced).
- Kill criteria: reply rate <1.5% after 60 days → fix the message/ICP, not the tool.
