# Blog scaffold

Status: parked until the first real audit exists. A blog with zero posts
hurts more than no blog. When warmup audits produce material:

## Rules

- Founder voice (brand/tokens.json). Plain English, no hype.
- Every post grounded in one real thing seen: a workflow, a number, a
  quote with permission. No generic AI advice.
- One idea per post, 400-700 words, ends with the Map CTA
  (cal.com/nick-smoothai/intro).

## First three post seeds (write after audit 1-2)

1. "What I saw in [trade] inboxes this week": the repeated chore, the
   math, what fixing it costs. Repurpose the best cold-opener observation.
2. "The Map, worked example": anonymised walkthrough of one real audit:
   what we looked at, what the math said, what they kept.
3. "When AI doesn't pay": the honest no-fit call. Lowest-volume workflows,
   why we said no, what they did instead. This one earns the most trust.

## Wiring (when unparked)

- Static posts in `~/Projects/smoothai-consultancy/site/src/` (same pattern as proof.js:
  one data module, rendered section, tests asserting no placeholders).
- Nav link + sitemap entry. No CMS, no new infra.
