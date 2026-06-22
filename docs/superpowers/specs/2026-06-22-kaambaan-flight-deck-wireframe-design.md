# Kaambaan "Flight Deck" Wireframe — Design Spec

**Date:** 2026-06-22 · **Status:** Approved (brainstorming) · **Type:** high-fidelity HTML wireframe (vision artifact, not production code)

## Goal

A single, self-contained, clickable HTML wireframe that shows Kaambaan's UI **after** the
Linear-parity program ([docs/13](../../13-linear-parity-program.md)) — incorporating the borrow
patterns from the June 2026 scan ([docs/11 §6](../../11-prior-art-and-market-scan.md), [docs/13 §6](../../13-linear-parity-program.md)) —
rendered in the existing **"agent flight deck"** identity. It is a vision/design artifact to feel
out the patterns, **not** the real SvelteKit implementation.

## Approach (chosen: A)

Single self-contained file `docs/wireframes/flight-deck.html` — inline CSS + vanilla JS + inline
mock data. No build step, no dependencies, opens in any browser. Linked from `docs/13`.

## Identity (fixed — evolve, do not reinvent)

- **Palette:** ink `#0F1118`, surface `#161924`, inset `#1d2130`, line `#282D3B`, text `#ECEAF2`,
  muted `#8B91A8`; accent **marigold `#F4A526`** (primary/work-in-motion); **teal `#34D3B6`** =
  live/agent-active; **coral `#FF6B57`** = needs-you (gates, over-budget, failed). Dark ground.
- **Type:** Space Grotesk (display/wordmark/stage names), IBM Plex Sans (UI), IBM Plex Mono (ALL
  telemetry — cost, ids, counts, status — as instrument readouts). Loaded via Google Fonts.
- **Signatures:** pipeline as a directed flight-path (marigold `flow-arrow` between stages);
  pulsing teal `live-dot`; coral left-edge on gated tiles; "awaiting work" dashed ghost lane;
  `eyebrow` = mono uppercase 10px. Voice: "Dispatch", "awaiting your review", "All clear —
  nothing needs you." Respect `prefers-reduced-motion`.

## Interactivity (chosen: clickable + live motion)

Vanilla JS, no backend. Left instrument-rail nav switches 5 screens; global **Cmd-K** overlay from
any screen; card drawer opens over the board; a gate resolves; hover/focus states. Live motion:
pulsing live-dot, a streaming activity feed (appends a line every ~2s), animated cost-meter fill,
Cmd-K spring-in, flow-arrow shimmer — all gated behind `prefers-reduced-motion`.

## Mock data

One tenant, one board — a **"Content production"** pipeline (Brief → Research → Draft → Edit(gate)
→ Publish) — ~8 cards across stages, 3 agents, believable activity/cost/telemetry numbers, a few
triage items, a couple of card dependencies, one draft→ready→merged reference.

## The 5 screens → patterns demonstrated

1. **Board flight-deck (hero)** — stage columns as waypoints + flow-arrows; WIP counts; ghost lane.
   Tiles: priority chip, labels, **delegate-agent avatar + human owner**, cost meter, teal
   live-pulse (active), coral left-edge (gated), reference chips (incl. PR sub-state), due date,
   dependency connector. Top bar: board switcher, view toggle, filter chips, notifications bell.
   → *pipeline/stages, card depth, delegation, dependency edges, WIP, references.*
2. **Card / agent-session drawer** — live status row + ephemeral "Searching…"; **agent Plan
   checklist** w/ rollup; typed **thought/action/elicitation/error** stream (mono, per-step
   tokens+cost); acceptance-criteria field; **mid-run steering** (pause/refine/restart);
   **gate panel** with **approve / reject-with-feedback / modify** + risk badge.
   → *agent-session UI, mid-run steering, gate triad, risk gating, per-step cost, acceptance criteria.*
3. **Triage inbox** — omni-channel intake (Slack/email/GitHub/webhook) with **AI-suggested
   metadata** (accept/dismiss chips), dedup/related flag, **inspect-reasoning** expander, route-to-board.
   → *triage inbox, many-inbound-one-path, AI metadata, accept/dismiss/inspect.*
4. **Command palette (Cmd-K)** — fuzzy search across cards/agents/actions + quick actions.
   → *command palette, search, keyboard-first.*
5. **Agent telemetry dashboard** — cost-per-card, success/failure rate, time-in-stage, throughput,
   gate-rejection rate, budget-burn vs cap, per-agent leaderboard, versioned-cost nod.
   → *cost metering as agent telemetry, budgets, versioned pricing.*

## Out of scope

Real data/backend, auth, responsive-mobile perfection (desktop-first; degrade gracefully), the
actual SvelteKit port, and any planning machinery flagged 🔴 in docs/13 (cycles/roadmap/Gantt).

## Success criteria

Opens standalone; all 5 screens reachable; Cmd-K works from any screen; the card drawer opens and a
gate resolves with the triad; live-motion visible but reduced-motion-safe; visually unmistakably
Kaambaan (flight-deck identity). A reviewer can point at each borrowed pattern on screen.
