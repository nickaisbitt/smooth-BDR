# Smooth AI Consultancy: brand identity

Source of truth for look, voice, and logo use across the site and
outreach. Site tokens live in `smoothai-v2` (`tailwind.config.js` +
`src/index.css`); this file states the rules. Where they disagree, the
site tokens win and this file gets updated to match.

## 1. The mark

`brand/logo-mark.svg` (Heritage Stroke, locked 2026-09):

- Ink rounded square, 48 grid, `rx=11`, fill `#1A1A1E`.
- One paper `#FFFCF8` S stroke, width 5.6 on the 48 grid, round caps,
  no fill, no second element.
- Ships as a single file. No text baked in, no gradients, no shadow.

Why it looks like this: the stroke reads as one continuous motion
(smooth) at 16px and still shows open counters at 120px. It survives
favicon crush where the old filled S blurred.

## 2. Lockups

- **Site nav:** mark at 34px + wordmark `Smooth AI` in Fraunces bold
  18px ink. (Full name `Smooth AI Consultancy` appears in footer,
  title, and schema, not the nav.)
- **Reply-stage email header:** mark at 40px left + wordmark
  `Smooth AI Consultancy` in Georgia bold 20px with tagline, side by
  side in an Outlook-safe table lockup over a 3px tape rule. Footer is
  a paper-deep card with mailto + site links in clay, plus a one-line
  voice strip. See `brand/email-wrapper.html`.
- **Cold email:** no image at all. Text wordmark + signature only.
- **Social/OG:** `og-image.svg` (source) + rendered `og-image.jpg`
  (1200x630): tape headline band "Practical AI that pays for itself.",
  mark at 120px, wordmark + italic tagline on paper-deep. No violet,
  no network mesh, no glow. The old dark-network OG (wrong name
  "SmoothAI", wrong tagline, banned violet) is retired.

## 3. Clearspace and minimum size

- Clearspace: half the tile width on all sides. Nothing enters it.
- Minimum: 16px digital (favicon). Below 24px use the mark only,
  never the lockup.
- Maximum in email: 120px wide. The reply wrapper uses 40px.

## 4. Colour

Paper first, ink second, tape and clay as accents only.

| Role | Token | Hex | Use |
|---|---|---|---|
| Background | paper | `#FFFCF8` | page, email body |
| Deep wash | paper_deep | `#F6F1E9` | alt sections |
| Border | paper_border | `#E8E2D9` | hairlines |
| Text | ink | `#1A1A1E` | body, tile fill |
| Soft text | ink_soft | `#252529` | secondary |
| Muted | ink_muted | `#52525B` | captions, footers |
| Tape | tape | `#FFF2A8` | highlight fills |
| Tape rule | tape_border | `#E6D77A` | header rule, underlines |
| Tape ink | tape_ink | `#5A4E00` | text on tape |
| Clay | clay | `#C67A3B` | rare warm accent |
| Clay dark | clay_dark | `#8A4F1F` | links, footer link |

Rules: never pure `#000` or pure `#fff` for text surfaces. Never the
old violet `#863bff` anywhere. Clay is for links and small accents,
never large fills. Tape is a highlighter, not a background.

## 5. Type

- Display/wordmark: Fraunces, Georgia, serif. Bold, tight tracking.
- Body: Plus Jakarta Sans, system-ui, sans-serif. Relaxed leading.
- Handwritten: Caveat, accents only (annotations like `the honest
  bit`), never body, never buttons, never email.

Email fallback stacks (no webfont in inboxes): Georgia serif for the
wordmark, Arial/Helvetica for body.

## 6. Voice

Founder voice, one practitioner to another. Plain English, no jargon,
slightly uneven sentences.

Say: `No deck. We look at your actual workflow.` / `If we are wrong
for you, we say so on that call.` / `You keep the notes even if you
never hire us.` / `Confused by AI? Normal.`

Never: hype superlatives (revolutionize, supercharge, unlock,
game-changer); three-item hype lists; `I hope this finds you well` /
`I wanted to reach out`; em dashes in email bodies; any claim the
audit record cannot source; borrowed case studies.

Cold openers carry no links, meeting requests, or booking CTAs. The
question is the message and it closes the mail.

## 7. Email rules

- All mail sends from `hi@smoothaigrowth.com` (secondary domain).
  The brand domain `smoothaiconsultancy.com` is never sent from; it
  appears only as a link in the reply-stage footer.
- Cold openers and follow-ups: plain text only, text wordmark,
  signature, opt-out, no image.
- Reply stage (warm hand-sent continuations): `brand/email-wrapper.html`
  with the mark once at 40px, paper background, tape rule header,
  clay footer link.
- Signature (`brand/signature.txt`): three lines, no title, no photo,
  no phone until the client asks.

## 8. What changed and why (2026-09 polish)

- Retired the three-way mark confusion (nav `S` letter vs filled S
  path vs stale violet data-URI in `index.html`). One stroke file is
  now the source; nav tile, favicon, and wrapper all draw from it.
- Stated clearspace/minimum sizes so the mark stops being re-cut per
  surface.
- Wrote down the colour ratio (paper first, clay/tape as accents)
  that the site already followed but no file stated.
- Moved email format rules out of scattered comments into one place
  so the next rewrite has a fixed target.
