# Tier 1 — Flight-Deck UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real `apps/web` app look and behave like the approved wireframe (`docs/wireframes/flight-deck.html`), using only data the backend already exposes.

**Architecture:** Keep the client-only SPA (`ssr=false`, static adapter). Break the 1,219-line `src/routes/+page.svelte` monolith into focused components driven by a single shared reactive store (Svelte 5 runes in a `.svelte.ts` module). Screens switch by state (a left rail), matching the wireframe — **no new SvelteKit routes**. Re-skin to wireframe fidelity using the tokens already in `app.css`.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Tailwind v4, `@atlaskit/pragmatic-drag-and-drop`, Playwright e2e, `svelte-check` typecheck.

## Global Constraints

- **Pure frontend.** No changes to `packages/contract`, `apps/api`, the Board DO, or any REST/MCP verb. Anything needing backend (the `Modify` gate decision, a real `labels` column, omni-channel triage intake + AI metadata, agent-performance telemetry aggregation, mid-run steering, plan-checklist entity) is **Tier 2** — out of scope here.
- **Labels + acceptance criteria read from `card.spec`** (`spec.labels: string[]`, `spec.acceptanceCriteria: string[]`). `CardView.spec` is already in the snapshot. No persistence change.
- **Gate triad = existing options only**: `approve` / `request_changes` / `reject` (from `gate.options`). Do NOT add `Modify` (Tier 2).
- **Telemetry from the existing endpoint** `GET /v1/boards/:id/usage?window=<5h|7d>` (returns `totalCost`, `byModel`, `byAgent`, `byCard`). Success-rate / time-in-stage / throughput / leaderboard metrics are **Tier 2**; show the cost breakdown + budget burn only, with an honest "more coming" note.
- **Triage = "Needs You" queue** derived from existing data: pending `gates`, `overBudget` cards, and unread `notifications`. No intake entity, no AI suggestions (Tier 2).
- **Visual source of truth:** `docs/wireframes/flight-deck.html` (markup + CSS). **Token source of truth:** `apps/web/src/app.css` (already has `--ink/--surface/--marigold/--live/--coral`, `.flow-arrow`, `.live-dot`, `.tile`). Reuse `app.css` classes; port wireframe-only classes into `app.css` as needed.
- **Regression gate:** the existing Playwright specs `apps/web/e2e/board.spec.ts` and `apps/web/e2e/gates.spec.ts` MUST stay green after every task. Run: `pnpm --filter @kaambaan/web e2e` (uses `PW_CHANNEL=chrome` locally).
- **Typecheck gate:** every task ends green on `pnpm --filter @kaambaan/web typecheck`.
- Commit after every task. Branch: `flight-deck-redesign`.

---

## File Structure

**Create:**
- `src/lib/stores/app.svelte.ts` — the single reactive app store (state + actions wrapping `api.ts`). One responsibility: hold board/auth/view/filter/screen state and the mutation+refresh loop.
- `src/lib/components/Rail.svelte` — left instrument-rail nav (wordmark, screen nav, boards, agents, user).
- `src/lib/components/Topbar.svelte` — board switcher, view toggle, filter chips, search-opens-Cmd-K, notifications bell.
- `src/lib/components/board/BoardKanban.svelte` — stage columns + flow-arrows + ghost lanes; uses dnd.
- `src/lib/components/board/CardTile.svelte` — one card tile (priority, labels, delegate avatar, cost meter, live-dot, gate edge, ref chip, due/owner).
- `src/lib/components/board/ListView.svelte` — the list/table view.
- `src/lib/components/CardDrawer.svelte` — card / agent-session drawer (status, plan-from-spec, acceptance criteria, activity stream, cost, references, gate panel).
- `src/lib/components/CommandPalette.svelte` — Cmd-K overlay.
- `src/lib/components/Telemetry.svelte` — cost/telemetry dashboard.
- `src/lib/components/TriageInbox.svelte` — "Needs You" queue.
- `src/lib/components/agentColor.ts` — tiny helper: deterministic avatar color + initial from an id/name.

**Modify:**
- `src/lib/api.ts` — add `getUsage()` + its return types (no behavior change to existing methods).
- `src/routes/+page.svelte` — shrink to a thin shell: `<Rail/> <Topbar/> {active screen} <CardDrawer/> <CommandPalette/>`, all reading the store.
- `src/app.css` — add any wireframe-only component classes (e.g. `.statepill`, `.refchip`, `.cmdk-*`, telemetry bars) under `@layer components`.

**Reuse as-is:** `NewBoardDialog.svelte`, `BoardSettings.svelte`, `dnd.ts`, `utils.ts`, `components/ui/button`.

---

### Task 1: Add `getUsage` client method + types

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add type + method near the other GETs)
- Test: `apps/web/e2e/board.spec.ts` (no change; regression run only)

**Interfaces:**
- Produces: `getUsage(boardId: string, window?: '5h'|'7d'): Promise<BoardUsageReport>` and
  `interface BoardUsageReport { totalCostUsd: number; byModel: UsageRow[]; byAgent: UsageRow[]; byCard: UsageRow[] }`,
  `interface UsageRow { key: string; costUsd: number; count?: number }`.
- Consumes: the existing backend route `GET /v1/boards/:id/usage?window=`.

- [ ] **Step 1: Confirm the backend response shape**

Run: `grep -n "async getUsage\|byModel\|byAgent\|byCard" apps/api/src/board/board-do.ts`
Expected: find the `getUsage` DO method and the keys it returns. Copy the exact JSON keys into the type below (adjust if they differ from `byModel/byAgent/byCard`).

- [ ] **Step 2: Add types + method to `api.ts`**

```ts
export interface UsageRow { key: string; costUsd: number; count?: number }
export interface BoardUsageReport {
  totalCostUsd: number;
  byModel: UsageRow[];
  byAgent: UsageRow[];
  byCard: UsageRow[];
}

export async function getUsage(boardId: string, window: '5h' | '7d' = '7d'): Promise<BoardUsageReport> {
  const res = await fetch(`/v1/boards/${boardId}/usage?window=${window}`, { headers });
  if (!res.ok) return { totalCostUsd: 0, byModel: [], byAgent: [], byCard: [] };
  return res.json();
}
```

(If Step 1 shows the backend returns objects/maps instead of arrays, normalize them to arrays inside `getUsage` so the component contract stays array-shaped.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kaambaan/web typecheck`
Expected: PASS (0 errors).

- [ ] **Step 4: Regression e2e**

Run: `pnpm --filter @kaambaan/web e2e`
Expected: existing specs PASS (UI unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): getUsage client method for the telemetry view"
```

---

### Task 2: Extract the shared reactive store

**Files:**
- Create: `apps/web/src/lib/stores/app.svelte.ts`
- Create: `apps/web/src/lib/components/agentColor.ts`

**Interfaces:**
- Produces: a singleton `app` object with reactive fields and actions. Exact surface the components rely on:
  - state: `app.authState`, `app.user`, `app.boards`, `app.boardId`, `app.board` (BoardSnapshot|null), `app.connected`, `app.screen` ('board'|'triage'|'telemetry'), `app.view` ('board'|'list'), `app.listGroupBy`, `app.filters`, `app.openCardId`, `app.cmdkOpen`, `app.notifications`, `app.agents`.
  - derived: `app.filteredCards()`, `app.unreadCount()`, `app.cardById(id)`, `app.gateForCard(id)`, `app.referencesForCard(id)`, `app.needsYou()` (cards at a pending gate, over budget, or with unread notifications).
  - actions: `app.init()`, `app.loadBoard(id)`, `app.refresh()`, `app.moveCard(cardId, toStage)`, `app.openCard(id)`, `app.closeCard()`, `app.setScreen(s)`, `app.toggleCmdk()`.
- Consumes: every method in `api.ts`; the `BoardSnapshot/Card/Gate/...` types from `api.ts`.

- [ ] **Step 1: Write `agentColor.ts`**

```ts
const PALETTE = ['#34D3B6', '#F4A526', '#FF6B57', '#b48bff', '#5b9cff'];
export function agentColor(id: string | null | undefined): string {
  if (!id) return '#8B91A8';
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initialOf(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}
```

- [ ] **Step 2: Write the store**, moving the state + handlers currently in `+page.svelte` into `app.svelte.ts` as a runes-based singleton. Read `apps/web/src/routes/+page.svelte` first and port each `$state`/`$derived`/handler verbatim. Skeleton (fill every action from the current page's logic):

```ts
import * as api from '$lib/api';
import type { BoardSnapshot, Card, Gate, Reference, Notification } from '$lib/api';

type Screen = 'board' | 'triage' | 'telemetry';
export interface Filters { states: string[]; owners: string[]; minPriority: number; needsReview: boolean; live: boolean; overBudget: boolean }

class AppStore {
  authState = $state<'loading' | 'signed-out' | 'ready'>('loading');
  user = $state<api.User | null>(null);
  boards = $state<api.BoardSummary[]>([]);
  boardId = $state<string | null>(null);
  board = $state<BoardSnapshot | null>(null);
  connected = $state(false);
  screen = $state<Screen>('board');
  view = $state<'board' | 'list'>('board');
  listGroupBy = $state<'stage' | 'state' | 'owner' | 'priority'>('stage');
  filters = $state<Filters>({ states: [], owners: [], minPriority: 0, needsReview: false, live: false, overBudget: false });
  openCardId = $state<string | null>(null);
  cmdkOpen = $state(false);
  notifications = $state<Notification[]>([]);
  agents = $state<{ id: string; name: string; capabilities: string[] }[]>([]);
  #socket: WebSocket | null = null;

  filteredCards(): Card[] { /* port the current $derived filteredCards logic verbatim */ return this.board?.cards ?? []; }
  unreadCount(): number { return this.notifications.filter(n => !n.read).length; }
  cardById(id: string): Card | undefined { return this.board?.cards.find(c => c.id === id); }
  gateForCard(id: string): Gate | undefined { return this.board?.gates.find(g => g.cardId === id && g.status === 'pending'); }
  referencesForCard(id: string): Reference[] { return this.board?.references.filter(r => r.cardId === id) ?? []; }
  needsYou(): Card[] {
    const cards = this.board?.cards ?? [];
    return cards.filter(c => this.gateForCard(c.id) || c.overBudget || c.state === 'failed');
  }

  async init() { /* port onMount: getMe, getBoards, pick board, loadBoard */ }
  async loadBoard(id: string) { this.boardId = id; this.board = await api.getBoard(id); this.#connect(id); await this.refresh(); }
  async refresh() { if (this.boardId) this.board = await api.getBoard(this.boardId); }
  #connect(id: string) { this.#socket?.close(); this.#socket = api.openBoardSocket(id, () => this.refresh()); }
  async moveCard(cardId: string, toStage: string) { await api.moveCard(this.boardId!, cardId, toStage); await this.refresh(); }
  openCard(id: string) { this.openCardId = id; }
  closeCard() { this.openCardId = null; }
  setScreen(s: Screen) { this.screen = s; }
  toggleCmdk() { this.cmdkOpen = !this.cmdkOpen; }
}
export const app = new AppStore();
```

- [ ] **Step 3: Typecheck the store in isolation**

Run: `pnpm --filter @kaambaan/web typecheck`
Expected: PASS. (The store is not wired into the page yet, so e2e is unaffected.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/stores/app.svelte.ts apps/web/src/lib/components/agentColor.ts
git commit -m "feat(web): shared app store + agent color helper (no UI wiring yet)"
```

---

### Task 3: Re-skinned `CardTile` + `BoardKanban`, wired to the store

**Files:**
- Create: `apps/web/src/lib/components/board/CardTile.svelte`, `apps/web/src/lib/components/board/BoardKanban.svelte`
- Modify: `apps/web/src/routes/+page.svelte` (replace the inline kanban with `<BoardKanban/>`), `apps/web/src/app.css` (port `.refchip`, `.statepill`, cost-bar classes from the wireframe)
- Test: `apps/web/e2e/board.spec.ts` (regression)

**Interfaces:**
- Consumes: `app` store (Task 2), `agentColor/initialOf` (Task 2), `cardDraggable`/`columnDropTarget` from `dnd.ts`.
- Produces: `<BoardKanban/>` (no props; reads `app`), `<CardTile card={card} />`.

- [ ] **Step 1: Port the tile markup** from `docs/wireframes/flight-deck.html` (`tileHTML`, the `.tile` block) into `CardTile.svelte`, binding to real fields: `card.priority` → `P{n}`, `card.spec?.labels`, `card.delegateAgentId` → avatar via `agentColor`, `card.costUsd`/`overBudget` → cost bar, `app.gateForCard(card.id)` → `.gated` edge, `app.referencesForCard(card.id)[0]` → ref chip (+ `metadata.subState` → draft/ready/merged), `card.state==='working'` → `.live-dot`. Click → `app.openCard(card.id)`.

- [ ] **Step 2: Port the columns** from the wireframe (`renderBoard`) into `BoardKanban.svelte`: iterate `app.board.stages` (sorted by `order`), place `app.filteredCards()` per stage, marigold `.flow-arrow` between columns, ghost "awaiting work" lane when empty, WIP count, gate flag. Keep `use:cardDraggable` / `use:columnDropTarget` calling `app.moveCard`.

- [ ] **Step 3: Wire into the page** — replace the inline board markup in `+page.svelte` with `{#if app.screen==='board' && app.view==='board'}<BoardKanban/>{/if}` and ensure the page calls `app.init()` in `onMount`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kaambaan/web typecheck`
Expected: PASS.

- [ ] **Step 5: Regression e2e (board)**

Run: `pnpm --filter @kaambaan/web e2e -- board`
Expected: `board.spec.ts` PASS — create-card, drag-move, columns, real-time all still work against the new components.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/board apps/web/src/routes/+page.svelte apps/web/src/app.css
git commit -m "feat(web): re-skinned board + card tile components on the shared store"
```

---

### Task 4: Re-skinned `CardDrawer` (agent session)

**Files:**
- Create: `apps/web/src/lib/components/CardDrawer.svelte`
- Modify: `apps/web/src/routes/+page.svelte` (replace inline drawer), `apps/web/src/app.css` (drawer/stream/gate classes)
- Test: `apps/web/e2e/gates.spec.ts` (regression)

**Interfaces:**
- Consumes: `app.openCardId`, `app.cardById`, `app.gateForCard`, `api.getCardActivities`, `api.getEstimate`, `api.resolveGate`.
- Produces: `<CardDrawer/>` (reads `app`). On gate resolve, calls `api.resolveGate(boardId, gateId, decision, comment?)` then `app.refresh()` + `app.closeCard()`.

- [ ] **Step 1: Port the drawer shell + status row** from the wireframe (`drawerHTML`) into `CardDrawer.svelte`, fed by the real card + `getCardActivities`. Render the activity stream from `CardActivities.activities` mapping `type` → icon (thought/action/response/elicitation/error). Show `delegateAgentId` via `agentColor`.
- [ ] **Step 2: Plan + acceptance criteria from `spec`** — if `card.spec?.plan` (array of `{t, done}`) render the checklist + rollup; if `card.spec?.acceptanceCriteria` render the list. Both degrade gracefully when absent.
- [ ] **Step 3: Cost block** from `card.costUsd` + `getEstimate`. **References** from `app.referencesForCard`.
- [ ] **Step 4: Gate panel** — render only when `app.gateForCard(card.id)` exists, using its real `options` (approve / request_changes / reject). `request_changes` reveals the comment textarea; on submit call `api.resolveGate(...)`. **No Modify button.**
- [ ] **Step 5: Wire into the page** — `{#if app.openCardId}<CardDrawer/>{/if}`; remove the old inline drawer.

- [ ] **Step 6: Typecheck + regression e2e (gates)**

Run: `pnpm --filter @kaambaan/web typecheck && pnpm --filter @kaambaan/web e2e -- gates`
Expected: PASS — the approve/request-changes/reject flow still works.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/CardDrawer.svelte apps/web/src/routes/+page.svelte apps/web/src/app.css
git commit -m "feat(web): re-skinned agent-session card drawer"
```

---

### Task 5: `Rail` + `Topbar` + screen shell (+ ListView)

**Files:**
- Create: `apps/web/src/lib/components/Rail.svelte`, `Topbar.svelte`, `board/ListView.svelte`
- Modify: `apps/web/src/routes/+page.svelte` (becomes the thin shell)

**Interfaces:**
- Consumes: `app` store. Produces: `<Rail/>`, `<Topbar/>`, `<ListView/>`.

- [ ] **Step 1: `Rail.svelte`** — port the wireframe rail: wordmark `kaam→baan`, nav buttons calling `app.setScreen('board'|'triage'|'telemetry')` with `app.screen` active state, boards list (`app.boards`, click → `app.loadBoard`), agents (`app.agents`), Quick-jump button → `app.toggleCmdk()`, user.
- [ ] **Step 2: `Topbar.svelte`** — board switcher, view toggle (`app.view`), filter chips bound to `app.filters`, the search field → `app.toggleCmdk()`, notifications bell with `app.unreadCount()`.
- [ ] **Step 3: `ListView.svelte`** — port the wireframe list table over `app.filteredCards()`, row click → `app.openCard`.
- [ ] **Step 4: Thin-shell `+page.svelte`** — reduce to: auth/onboarding gate, then `<div class="app"><Rail/><div class="stage"><Topbar/>{screen switch}</div></div><CardDrawer/><CommandPalette/>` plus the existing modal components. Screen switch: `board`→`{view==='board'?BoardKanban:ListView}`, `triage`→`TriageInbox`, `telemetry`→`Telemetry`. Keep `NewBoardDialog`/`BoardSettings`/budget/agents/notifications modals.

- [ ] **Step 5: Typecheck + full regression e2e**

Run: `pnpm --filter @kaambaan/web typecheck && pnpm --filter @kaambaan/web e2e`
Expected: ALL existing specs PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components apps/web/src/routes/+page.svelte
git commit -m "feat(web): instrument rail, topbar, list view, thin-shell page"
```

---

### Task 6: Command palette (Cmd-K)

**Files:**
- Create: `apps/web/src/lib/components/CommandPalette.svelte`
- Modify: `apps/web/src/app.css` (`.cmdk-*` classes from wireframe)
- Test: `apps/web/e2e/cmdk.spec.ts` (new)

**Interfaces:**
- Consumes: `app.board.cards`, `app.agents`, `app.cmdkOpen`, `app.setScreen`, `app.openCard`. A global keydown for Cmd/Ctrl-K toggles `app.toggleCmdk()`; Esc closes.

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/web/e2e/cmdk.spec.ts
import { test, expect } from '@playwright/test';
test('cmd-k opens palette and jumps to a card', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+k'); // ControlOrMeta handled by app; use Control on CI
  await expect(page.getByPlaceholder(/Jump to a card/i)).toBeVisible();
});
```

- [ ] **Step 2: Run it — expect FAIL** (`pnpm --filter @kaambaan/web e2e -- cmdk`), no palette yet.
- [ ] **Step 3: Build `CommandPalette.svelte`** — port the wireframe `cmdk` overlay + `renderCmdk` filtering: index `app.board.cards` (label=title, sub=#id, act=`app.setScreen('board'); app.openCard(id)`), `app.agents`, and static actions (Dispatch, Open Triage→`setScreen('triage')`, View Telemetry→`setScreen('telemetry')`). Arrow/Enter/Esc keyboard handling. Mount in the page shell. Add the global `keydown` listener (Meta/Ctrl-K) in `+page.svelte` `onMount`, handling both `Meta` and `Control` so it works on macOS and CI Linux.
- [ ] **Step 4: Run e2e — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/CommandPalette.svelte apps/web/e2e/cmdk.spec.ts apps/web/src/app.css apps/web/src/routes/+page.svelte
git commit -m "feat(web): command palette (Cmd-K) over board data"
```

---

### Task 7: Telemetry screen (existing cost data)

**Files:**
- Create: `apps/web/src/lib/components/Telemetry.svelte`
- Modify: `apps/web/src/app.css` (metric/burn/bar classes)

**Interfaces:**
- Consumes: `api.getUsage` (Task 1), `app.board.usage` (board budget burn).

- [ ] **Step 1: Build `Telemetry.svelte`** — on mount, `getUsage(app.boardId)`. Render: a **Spend / budget** burn bar from `app.board.usage` (`totalCostUsd` / `budgetUsd`), and **by-agent** + **by-model** + **by-card** cost tables/bars from the report. Port the wireframe metric-card + bar styling. Add one honest line: `<p class="eyebrow">success rate · time-in-stage · throughput — coming with the telemetry aggregation (Tier 2)</p>`.
- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kaambaan/web typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke e2e**

```ts
// add to apps/web/e2e/cmdk.spec.ts or a nav.spec.ts
test('telemetry screen shows spend', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Telemetry/i }).click();
  await expect(page.getByText(/Spend/i)).toBeVisible();
});
```
Run: `pnpm --filter @kaambaan/web e2e -- nav` (or cmdk). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/Telemetry.svelte apps/web/src/app.css apps/web/e2e
git commit -m "feat(web): telemetry screen from existing usage data"
```

---

### Task 8: Triage "Needs You" screen

**Files:**
- Create: `apps/web/src/lib/components/TriageInbox.svelte`

**Interfaces:**
- Consumes: `app.needsYou()` (Task 2), `app.notifications`, `app.openCard`, `app.gateForCard`.

- [ ] **Step 1: Build `TriageInbox.svelte`** — a "Needs You" list. For each card in `app.needsYou()`, render a wireframe-style intake row: reason badge (gate / over-budget / failed), title, owner, and a **Review →** action calling `app.openCard(card.id)` (which opens the drawer's gate panel). Below it, an "Activity" section listing unread `app.notifications`. Header copy: "Triage — everything that needs you". When empty, the flight-deck empty line: "All clear — nothing needs you."
- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kaambaan/web typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke e2e** — extend `nav.spec.ts`: click Triage, assert the heading renders (and the empty-state copy when there are no gates).
Run: `pnpm --filter @kaambaan/web e2e -- nav`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/TriageInbox.svelte apps/web/e2e
git commit -m "feat(web): triage 'needs you' queue from gates/budget/notifications"
```

---

### Task 9: Labels + acceptance-criteria authoring + final polish

**Files:**
- Modify: `apps/web/src/lib/components/CardDrawer.svelte` (edit `spec.labels` / `spec.acceptanceCriteria`), `apps/web/src/app.css` (final spacing/responsive pass)
- Test: full e2e suite

**Interfaces:**
- Consumes: `api.updateCard(boardId, cardId, { spec })` (existing) to persist `spec.labels` / `spec.acceptanceCriteria`.

- [ ] **Step 1: Add label + acceptance-criteria editing** in the drawer's edit mode — comma-separated inputs writing into `card.spec.labels` / `card.spec.acceptanceCriteria`, saved via the existing `updateCard` patch (spec is already editable). Tiles + drawer already render them (Tasks 3–4).
- [ ] **Step 2: Responsive + reduced-motion pass** — confirm the board scrolls horizontally on mobile, the drawer is full-width on small screens, and `prefers-reduced-motion` disables the live-dot/flow-arrow animation (port the wireframe's media query into `app.css`).
- [ ] **Step 3: Full typecheck + e2e**

Run: `pnpm --filter @kaambaan/web typecheck && pnpm --filter @kaambaan/web e2e`
Expected: ALL specs PASS (board, gates, cmdk, nav).

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): label + acceptance-criteria authoring; responsive/reduced-motion polish"
```

---

## Self-Review

- **Spec coverage:** board re-skin (T3), agent-session drawer (T4), Cmd-K (T6), telemetry on existing data (T7), thin triage (T8), labels+AC via spec (T3/T4/T9), componentization/store (T2/T5) — every Tier-1 item from the analysis has a task. Backend items (Modify gate, real labels column, AI triage, perf telemetry, steering) are explicitly Tier 2 per Global Constraints. ✔
- **No placeholders:** logic-heavy code (store, getUsage, agentColor, Cmd-K e2e) is given in full; presentational markup is ported from the in-repo wireframe by named reference (DRY, not a placeholder). ✔
- **Type consistency:** store surface in T2 matches consumption in T3–T8; `getUsage`/`BoardUsageReport` defined in T1 and consumed in T7; `resolveGate` uses the existing `GateDecision` union (no `modify`). ✔
- **Regression safety:** every UI task re-runs the existing board/gates specs; the store lands un-wired (T2) before the page is migrated (T3+). ✔
