# Lessons 4–6 — engagement review and decision (issue #206)

**Date:** 2026-09-19
**Scope:** epic #191, issue #206 (backlog, gated on engagement)
**Decision:** do **not** write lessons 4–6 now. Keep #206 as backlog. Re-review only when the engagement gate passes.

## What was reviewed (before any writing, per the acceptance criteria)

1. **Lesson age — no mature window exists.**
   - Lesson 2 (`leer-tu-primer-mes` / `read-your-first-month`) shipped 2026-09-18 (#250).
   - Lesson 3 (`armar-tu-presupuesto` / `build-your-budget`) shipped 2026-09-19 (#251, today).
   - A completion / scroll-depth / activation-correlation read on lessons 2 and 3 cannot exist yet; the content is 1 day old or newer.

2. **Metrics reports (`reports/metrics/2026-09-07.md` → `2026-09-18.md`).**
   - The “Time to First Transaction — Guide Exposure” section is still the **pre-launch baseline placeholder** in every report, including the latest (2026-09-18): guide-viewed / email-received segmentation requires client event tracking “not yet in the database” and is listed as a placeholder that “will be added when the guide ships.”
   - No per-article views, scroll depth, or completion aggregates appear in any committed metrics report.

3. **Event tracking vs. reporting gap (#208 — still OPEN).**
   - Raw instrumentation exists: `guide_opens` table (migration `20260911000000_guide_opens.sql`) plus `guide-view` / `guide-scroll` (25/50/75/100) / `guide-anchor` events from `GuideArticleLayout` via `POST /api/guide-event`.
   - What #208 still requires — and what #206 is gated on — is **not** the raw events but the aggregate join: per-article completion measurable per piece, opens attributable to source **in the report**, activation funnel segmentable by guide exposure, and the summary folded into the existing metrics report. None of that is in the reports as of 2026-09-18.

4. **Launch-email experiment (#199 — measurement window still open).**
   - Broadcast sent 2026-09-09 to all 23 users; baseline captured 2026-09-07.
   - The +7d / +14d comparisons and the written conclusion on whether the content intervention moved activation are **pending** (14d lands ~2026-09-23). There is no activation read to correlate lessons against yet.

## Basis for the decision

The issue text is explicit: the gate is evidence that anyone finishes the earlier lessons (completion, scroll depth, correlation with activation), and three tidy issues would create the appearance of committed scope for content that may never be justified. As of 2026-09-19:

- Completion: not measurable in the metrics report (#208 open).
- Scroll depth: collected as raw events only, not aggregated or reported.
- Activation correlation: impossible — lessons 2–3 are <48h old and the #199 post-send window has not closed.

Writing three full lessons now would be exactly what the issue forbids: scope committed without the evidence it demands.

## What happens when the gate passes

If a future review shows real engagement (lesson completion + depth + activation correlation, per #208’s summary), the three deferred topics are, in Spanish with tuteo per `docs/guide-voseo-note.md`:

1. **Ingresos irregulares** — planificar sin una cifra mensual fija; por qué el consejo estándar se rompe aquí.
2. **Deudas sin vergüenza** — los dos ordenamientos de pago comunes como opciones, no como prescripciones.
3. **Fondo de emergencia como concepto** — qué hacer cuando tres a seis meses de gastos no es alcanzable hoy; **no** abrir con “ahorra de tres a seis meses” como instrucción.

Constraints carried forward from #206 and the epic: every lesson uses the layout-provided disclaimer slot plus an in-body aclaración (same pattern as lessons 1–3), regional examples with realistic figures, and **no specific prescribed figures for an individual’s situation**.

## Re-review trigger (do not re-open on a calendar alone)

- #208 closed (completion per piece + source attribution + funnel segmentation in the metrics report), **and**
- #199 14d conclusion recorded, **and**
- at least one full engagement window on lessons 2–3 (≥14 days since 2026-09-19 with non-trivial views).

Until all three hold, #206 stays backlog. This file is the documented engagement review required before any writing starts.
