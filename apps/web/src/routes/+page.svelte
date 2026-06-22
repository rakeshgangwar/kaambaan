<script lang="ts">
  import { onMount } from 'svelte';
  import {
    markNotificationRead,
    logout,
    createAgent,
    getAgents,
    deleteAgent,
    setBudget,
    BOARD_TEMPLATES,
    type BoardSnapshot,
    type BoardSummary,
    type AgentToken,
  } from '$lib/api';
  import { Button } from '$lib/components/ui/button';
  import NewBoardDialog from '$lib/components/NewBoardDialog.svelte';
  import BoardSettings from '$lib/components/BoardSettings.svelte';
  import BoardKanban from '$lib/components/board/BoardKanban.svelte';
  import CardDrawer from '$lib/components/CardDrawer.svelte';
  import { app, type CardFilters } from '$lib/stores/app.svelte';

  // ---- store aliases (single source of truth) ----
  const board = $derived(app.board);
  const authState = $derived(app.authState);
  const user = $derived(app.user);
  const needsBoard = $derived(app.needsBoard);
  const connected = $derived(app.connected);
  const boardId = $derived(app.boardId);
  const notifications = $derived(app.notifications);

  // ---- page-local UI state (modals, drawer, form inputs) ----
  let creating = $state(false);
  let error = $state<string | null>(null);

  // boards (switcher + create from a template)
  let boards = $state<BoardSummary[]>([]);
  let showBoardMenu = $state(false);
  let showNewBoard = $state(false);
  let showSettings = $state(false);

  // budget editor (board + per-card USD caps)
  let showBudget = $state(false);
  let boardCapInput = $state<number | null>(null);
  let cardCapInput = $state<number | null>(null);
  let savingBudget = $state(false);

  // agents manager (list + mint + revoke)
  let showConnect = $state(false);
  let agents = $state<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const ALL_CAPS = ['research', 'review', 'publish'];
  let agentName = $state('');
  let newCaps = $state<string[]>(['research', 'review', 'publish']);
  let minted = $state<AgentToken | null>(null);
  let minting = $state(false);

  let title = $state('');

  let showNotifications = $state(false);

  // views + filters (Linear-style) – kept local so filter state is per-session; synced to store via $effect
  let view = $state<'board' | 'list'>('board');
  let listGroupBy = $state<'stage' | 'state' | 'owner' | 'priority'>('stage');
  let showFilterMenu = $state(false);
  let filters = $state<CardFilters>({ states: [], owners: [], minPriority: null, needsReview: false, live: false, overBudget: false });

  const boardStates = $derived(board ? [...new Set(board.cards.map((c) => c.state))].sort() : []);
  const boardOwners = $derived(board ? [...new Set(board.cards.map((c) => c.ownerUserId))].sort() : []);

  const filteredCards = $derived(
    !board
      ? []
      : board.cards.filter((c) => {
          if (filters.states.length && !filters.states.includes(c.state)) return false;
          if (filters.owners.length && !filters.owners.includes(c.ownerUserId)) return false;
          if (filters.minPriority !== null && c.priority < filters.minPriority) return false;
          if (filters.needsReview && !board!.gates.some((g) => g.cardId === c.id)) return false;
          if (filters.live && c.state !== 'working') return false;
          if (filters.overBudget && !c.overBudget) return false;
          return true;
        }),
  );

  const activeFilterCount = $derived(
    filters.states.length + filters.owners.length + (filters.minPriority !== null ? 1 : 0) + (filters.needsReview ? 1 : 0) + (filters.live ? 1 : 0) + (filters.overBudget ? 1 : 0),
  );

  const listGroups = $derived.by(() => {
    if (!board) return [] as Array<{ key: string; label: string; cards: BoardSnapshot['cards'] }>;
    const cards = filteredCards;
    let groups: Array<{ key: string; label: string; cards: BoardSnapshot['cards'] }>;
    if (listGroupBy === 'stage') {
      groups = board.stages.map((s) => ({ key: s.key, label: s.name, cards: cards.filter((c) => c.currentStageKey === s.key) }));
    } else {
      const keyOf = (c: BoardSnapshot['cards'][number]) => (listGroupBy === 'state' ? c.state : listGroupBy === 'owner' ? c.ownerUserId : `P${c.priority}`);
      const keys = [...new Set(cards.map(keyOf))].sort();
      groups = keys.map((k) => ({ key: k, label: k, cards: cards.filter((c) => keyOf(c) === k) }));
    }
    return groups.filter((g) => g.cards.length > 0);
  });

  const mcpSnippet = $derived(
    minted
      ? JSON.stringify({ mcpServers: { kaambaan: { url: `${location.origin}/mcp`, headers: { Authorization: `Bearer ${minted.token}` } } } }, null, 2)
      : '',
  );

  const unreadCount = $derived(notifications.filter((n) => !n.read).length);

  // ---- refresh: delegates to store ----
  async function refresh(): Promise<void> {
    await app.refresh();
  }

  // ---- board lifecycle (delegate to store) ----
  async function openBoard(id: string): Promise<void> {
    showBoardMenu = false;
    await app.openBoard(id);
    boards = app.boards;
    agents = app.agents;
  }

  async function switchBoard(id: string): Promise<void> {
    showBoardMenu = false;
    if (id !== boardId) await openBoard(id);
  }

  async function onDeleteBoard(id: string): Promise<void> {
    await app.deleteBoard(id);
    if (app.error) {
      error = app.error;
    }
    boards = app.boards;
  }

  onMount(() => {
    void app.init().then(() => {
      boards = app.boards;
      agents = app.agents;
    });
    return () => app.dispose();
  });

  async function createFirstBoard(): Promise<void> {
    creating = true;
    try {
      await app.createFirstBoard();
      if (app.error) error = app.error;
      boards = app.boards;
    } finally {
      creating = false;
    }
  }

  async function onLogout(): Promise<void> {
    await logout();
    location.reload();
  }

  async function openAgents(): Promise<void> {
    showConnect = true;
    minted = null;
    try {
      agents = await getAgents();
    } catch {
      agents = [];
    }
  }

  function toggleCap(cap: string): void {
    newCaps = newCaps.includes(cap) ? newCaps.filter((c) => c !== cap) : [...newCaps, cap];
  }

  async function mintAgent(): Promise<void> {
    if (agentName.trim() === '' || newCaps.length === 0) return;
    minting = true;
    try {
      minted = await createAgent(agentName.trim(), [...newCaps]);
      agentName = '';
      agents = await getAgents();
    } catch (e) {
      error = String(e);
    } finally {
      minting = false;
    }
  }

  async function onDeleteAgent(id: string): Promise<void> {
    const res = await deleteAgent(id);
    if (res.ok) agents = await getAgents();
  }

  function closeConnect(): void {
    showConnect = false;
    minted = null;
    agentName = '';
  }

  async function onAdd(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!boardId || title.trim() === '') return;
    try {
      await app.dispatchCard(title.trim());
      title = '';
      if (app.error) error = app.error;
    } catch (err) {
      error = String(err);
    }
  }

  // $effect: sync page-local filters → store so BoardKanban sees them
  $effect(() => {
    app.filters = { ...filters };
  });

  // budget editor ----------------------------------------------------------
  function openBudget(): void {
    boardCapInput = board?.usage.budgetUsd ?? null;
    cardCapInput = board?.usage.cardUsdCap ?? null;
    showBudget = true;
  }

  async function saveBudget(): Promise<void> {
    if (!boardId) return;
    savingBudget = true;
    try {
      const res = await setBudget(boardId, {
        boardUsdCap: boardCapInput && boardCapInput > 0 ? boardCapInput : null,
        cardUsdCap: cardCapInput && cardCapInput > 0 ? cardCapInput : null,
      });
      if (!res.ok) error = `Couldn't save the budget (${res.status})`;
      showBudget = false;
      await refresh();
    } finally {
      savingBudget = false;
    }
  }

  async function onMarkRead(seq: number): Promise<void> {
    if (!boardId) return;
    await markNotificationRead(boardId, seq);
    await refresh();
  }

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }
  function clearFilters(): void {
    filters = { states: [], owners: [], minPriority: null, needsReview: false, live: false, overBudget: false };
  }

  function stageLabel(key: string): string {
    return board?.stages.find((s) => s.key === key)?.name ?? key;
  }

  function gateFor(cardId: string): BoardSnapshot['gates'][number] | undefined {
    return board?.gates.find((g) => g.cardId === cardId);
  }

  function refsFor(cardId: string): BoardSnapshot['references'] {
    return board ? board.references.filter((r) => r.cardId === cardId) : [];
  }

  // Defense-in-depth: the API only stores http(s) reference urls, but never emit a non-http(s)
  // href (e.g. javascript:) even if a malformed one slips through.
  function safeHref(url: string): string | null {
    return /^https?:\/\//i.test(url) ? url : null;
  }

  const SUB_STATE_LABELS: Record<string, string> = {
    draft_pr_open: 'draft',
    pr_open: 'open',
    agent_iterating: 'iterating',
    awaiting_review: 'review',
    merged: 'merged',
    closed: 'closed',
    agent_working: 'working',
    issue_open: 'open',
    issue_closed: 'closed',
  };

  function subStateLabel(ref: BoardSnapshot['references'][number]): string | null {
    const s = ref.metadata?.subState;
    return typeof s === 'string' ? (SUB_STATE_LABELS[s] ?? s) : null;
  }

  function refLabel(ref: BoardSnapshot['references'][number]): string {
    if (ref.sourceType === 'pull_request') return `PR ${ref.externalId?.split('#')[1] ? `#${ref.externalId.split('#')[1]}` : ''}`.trim();
    if (ref.sourceType === 'issue') return `Issue ${ref.externalId?.split('#')[1] ? `#${ref.externalId.split('#')[1]}` : ''}`.trim();
    if (ref.sourceType === 'repo') return ref.externalId ?? 'repo';
    return ref.title ?? ref.sourceType;
  }

  function fmtUsd(n: number): string {
    return `$${n.toFixed(2)}`;
  }


</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      app.closeCard();
      closeConnect();
      showNotifications = false;
      showBoardMenu = false;
      showNewBoard = false;
      showBudget = false;
      showSettings = false;
      showFilterMenu = false;
    }
  }}
/>

<main class="min-h-screen px-5 py-5 sm:px-7">
  {#if authState === 'loading'}
    <div class="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <svg class="arrowmark size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12h15" /><path d="M13 6l6 6-6 6" /><path d="M3 9l3 3-3 3" />
      </svg>
      <div class="wordmark text-lg">Kaambaan</div>
      <div class="mono text-muted-foreground flex items-center gap-2 text-xs"><span class="live-dot"></span>warming up the flight deck…</div>
    </div>
  {:else if authState === 'signed-out'}
    <!-- sign-in -->
    <div class="mx-auto flex min-h-[85vh] max-w-md flex-col items-center justify-center gap-7 text-center">
      <div class="flex flex-col items-center gap-3">
        <svg class="arrowmark size-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12h15" /><path d="M13 6l6 6-6 6" /><path d="M3 9l3 3-3 3" />
        </svg>
        <div class="flex items-baseline gap-2.5">
          <span class="wordmark text-3xl leading-none">Kaambaan</span>
          <span class="eyebrow">agent flight deck</span>
        </div>
      </div>
      <p class="text-muted-foreground max-w-sm text-sm leading-relaxed">
        A board where AI agents do the work and you stay in command. Cards flow through your pipeline, agents pick up the ones they can handle, and nothing ships until you approve it.
      </p>
      <a
        href="/auth/login"
        data-sveltekit-reload
        class="bg-primary text-primary-foreground inline-flex items-center gap-2.5 rounded-[7px] px-4 py-2.5 text-sm font-medium transition hover:brightness-110"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.2 11.19.6.11.82-.26.82-.58l-.01-2C5.67 21.6 4.97 19.3 4.97 19.3c-.55-1.36-1.34-1.73-1.34-1.73-1.08-.73.09-.72.09-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.8 1.28 3.49.98.11-.76.42-1.28.76-1.58-2.66-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.13-.3-.54-1.5.11-3.12 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.3-1.53 3.3-1.21 3.3-1.21.65 1.62.24 2.82.12 3.12.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.22.69.83.57A12 12 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z" /></svg>
        Sign in with GitHub
      </a>
      {#if error}<p class="text-coral mono text-xs">{error}</p>{/if}
    </div>
  {:else if needsBoard}
    <!-- onboarding: signed in, no board yet -->
    <div class="mx-auto flex min-h-[85vh] max-w-xl flex-col justify-center gap-5">
      <div class="flex items-center gap-3">
        <svg class="arrowmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12h15" /><path d="M13 6l6 6-6 6" /><path d="M3 9l3 3-3 3" />
        </svg>
        <div>
          <div class="flex items-baseline gap-2.5"><span class="wordmark text-[19px] leading-none">Kaambaan</span><span class="eyebrow">agent flight deck</span></div>
          <div class="mono text-muted-foreground mt-1 text-xs">welcome, {user?.name ?? user?.login ?? 'there'}</div>
        </div>
      </div>
      <div class="bg-surface border-border rounded-[10px] border p-6">
        <div class="eyebrow mb-2">first board</div>
        <h1 class="wordmark text-xl leading-snug">Set up the pipeline your agents will work</h1>
        <p class="text-muted-foreground mt-2.5 text-sm leading-relaxed">
          A board is a pipeline. Work enters as cards and moves stage by stage — agents claim the cards they're capable of, do the work, and hand off down the line. An approval gate pauses the flow so nothing moves past review without your sign-off.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-1.5">
          {#each BOARD_TEMPLATES[0].stages as s, i (s.key)}
            <span class="border-border mono rounded-[6px] border px-2 py-1 text-[11px] {s.ownerKind === 'capability' ? 'text-marigold' : s.gate === 'approval' ? 'text-coral' : ''}">{s.name}{#if s.gate === 'approval'}<span class="ml-1 opacity-70">gate</span>{/if}</span>
            {#if i < BOARD_TEMPLATES[0].stages.length - 1}<span style="color:var(--marigold)" aria-hidden="true">→</span>{/if}
          {/each}
        </div>
        <div class="mt-6 flex flex-wrap gap-2.5">
          <Button onclick={createFirstBoard} disabled={creating}>{creating ? 'Creating…' : 'Create my first board'}</Button>
          <Button variant="outline" onclick={openAgents}>Connect an agent</Button>
        </div>
      </div>
      <button onclick={onLogout} class="text-muted-foreground hover:text-foreground mono self-start text-xs">sign out</button>
      {#if error}<p class="text-coral mono text-xs">{error}</p>{/if}
    </div>
  {:else if !board}
    <div class="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <svg class="arrowmark size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12h15" /><path d="M13 6l6 6-6 6" /><path d="M3 9l3 3-3 3" />
      </svg>
      <div class="wordmark text-lg">Kaambaan</div>
      <div class="mono text-muted-foreground flex items-center gap-2 text-xs">
        <span class="live-dot"></span>{error ?? app.error ?? 'establishing link to the board…'}
      </div>
    </div>
  {:else}
    <header class="border-border flex flex-wrap items-center justify-between gap-4 border-b pb-4">
      <div class="flex items-center gap-3">
        <svg class="arrowmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12h15" /><path d="M13 6l6 6-6 6" /><path d="M3 9l3 3-3 3" />
        </svg>
        <div>
          <div class="flex items-baseline gap-2.5">
            <span class="wordmark text-[19px] leading-none">Kaambaan</span>
            <span class="eyebrow">agent flight deck</span>
          </div>
          <!-- board switcher -->
          <div class="relative mt-1">
            <button
              onclick={() => (showBoardMenu = !showBoardMenu)}
              class="text-muted-foreground hover:text-foreground mono inline-flex items-center gap-1 text-xs"
            >
              {board.name}
              <svg class="size-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {#if showBoardMenu}
              <div class="bg-card border-border absolute left-0 z-20 mt-2 w-72 rounded-[10px] border p-1.5 shadow-2xl">
                <div class="eyebrow px-1.5 py-1">boards</div>
                {#each boards as b (b.id)}
                  <div class="group hover:bg-muted flex items-center rounded-[7px]">
                    <button onclick={() => switchBoard(b.id)} class="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs">
                      <span class="size-1.5 shrink-0 rounded-full" style="background:{b.id === boardId ? 'var(--marigold)' : 'var(--muted)'}"></span>
                      <span class="truncate {b.id === boardId ? 'text-foreground' : 'text-muted-foreground'}">{b.name}</span>
                    </button>
                    <button onclick={() => onDeleteBoard(b.id)} aria-label="Delete board" title="Delete board" class="text-muted-foreground hover:text-coral mr-1 px-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                {/each}
                <button onclick={() => { showBoardMenu = false; showSettings = true; }} class="text-muted-foreground hover:text-foreground hover:bg-muted border-border/60 mt-1 flex w-full items-center gap-1.5 rounded-[7px] border-t px-2 py-1.5 text-left text-xs">
                  <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
                  Board settings
                </button>
                <button onclick={() => { showBoardMenu = false; showNewBoard = true; }} class="text-marigold hover:bg-muted mt-0.5 flex w-full items-center gap-1.5 rounded-[7px] px-2 py-1.5 text-left text-xs">
                  <span class="text-sm leading-none">+</span> New board
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
        <!-- live signal -->
        <span class="border-border mono inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-xs">
          {#if connected}
            <span class="live-dot"></span><span style="color:var(--live)">live</span>
          {:else}
            <span class="text-muted-foreground">○</span><span class="text-muted-foreground">offline</span>
          {/if}
        </span>

        <!-- spend meter (click to set budgets) -->
        <div class="relative">
          <button
            onclick={openBudget}
            title="Set budget caps"
            class="border-border hover:border-marigold/50 flex items-center gap-2 rounded-[7px] border px-2.5 py-1.5"
          >
            <span class="eyebrow">spend</span>
            <span class="mono text-xs {board.usage.overBudget ? 'text-coral' : ''}">
              {fmtUsd(board.usage.totalCostUsd)}{#if board.usage.budgetUsd !== null}<span class="text-muted-foreground">/{fmtUsd(board.usage.budgetUsd)}</span>{/if}
            </span>
            {#if board.usage.budgetUsd !== null}
              <span class="bg-muted relative h-1 w-14 overflow-hidden rounded-full">
                <span
                  class="absolute inset-y-0 left-0 rounded-full"
                  style="width:{Math.min(100, (board.usage.totalCostUsd / board.usage.budgetUsd) * 100)}%; background:{board.usage.overBudget ? 'var(--coral)' : 'var(--marigold)'}"
                ></span>
              </span>
            {/if}
          </button>
          {#if showBudget}
            <div class="bg-card border-border absolute right-0 z-30 mt-2 w-64 rounded-[10px] border p-3 shadow-2xl max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:mt-0 max-sm:w-auto">
              <div class="eyebrow mb-2">budget caps (USD)</div>
              <label class="mb-2 block">
                <span class="text-muted-foreground text-xs">whole board</span>
                <input type="number" min="0" step="0.5" bind:value={boardCapInput} placeholder="no cap" class="bg-inset border-border focus:border-marigold mono mt-1 w-full rounded-[6px] border px-2 py-1.5 text-xs outline-none" />
              </label>
              <label class="block">
                <span class="text-muted-foreground text-xs">per card</span>
                <input type="number" min="0" step="0.5" bind:value={cardCapInput} placeholder="no cap" class="bg-inset border-border focus:border-marigold mono mt-1 w-full rounded-[6px] border px-2 py-1.5 text-xs outline-none" />
              </label>
              <p class="text-muted-foreground mt-2 text-[11px] leading-relaxed">When spend hits a cap, agents stop being handed new work.</p>
              <div class="mt-3 flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onclick={() => (showBudget = false)}>Cancel</Button>
                <Button size="sm" onclick={saveBudget} disabled={savingBudget}>{savingBudget ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          {/if}
        </div>

        <!-- alerts -->
        <div class="relative">
          <button
            onclick={() => (showNotifications = !showNotifications)}
            aria-label="Notifications"
            class="border-border inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5"
          >
            <svg class="size-3.5 {unreadCount > 0 ? 'text-coral' : 'text-muted-foreground'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span class="mono text-xs {unreadCount > 0 ? 'text-coral' : 'text-muted-foreground'}">{unreadCount}</span>
          </button>
          {#if showNotifications}
            <div class="bg-card border-border absolute right-0 z-30 mt-2 w-80 rounded-[10px] border p-1.5 shadow-2xl max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:mt-0 max-sm:w-auto">
              <div class="eyebrow px-1.5 py-1">alerts</div>
              {#if notifications.length === 0}
                <p class="text-muted-foreground px-1.5 py-2 text-sm">All clear — nothing needs you.</p>
              {:else}
                {#each notifications.slice(0, 20) as n (n.seq)}
                  <button
                    onclick={() => onMarkRead(n.seq)}
                    class="hover:bg-muted flex w-full items-start gap-2.5 rounded-[7px] p-2 text-left text-xs"
                  >
                    <span class="mt-1.5 size-1.5 shrink-0 rounded-full" style="background:{n.read ? 'var(--muted)' : 'var(--coral)'}"></span>
                    <span><span class="mono uppercase tracking-wide" style="color:{n.read ? 'var(--muted)' : 'var(--text)'}">{n.kind}</span><span class="text-muted-foreground"> — {n.body}</span></span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- connect an agent -->
        <Button size="sm" variant="outline" onclick={openAgents}>Agents</Button>

        <!-- identity -->
        <div class="border-border flex items-center gap-2 border-l pl-2.5">
          {#if user?.avatarUrl}
            <img src={user.avatarUrl} alt="" class="size-6 rounded-full" />
          {:else}
            <span class="bg-inset text-muted-foreground mono inline-flex size-6 items-center justify-center rounded-full text-[10px]">{(user?.name ?? user?.login ?? '?').slice(0, 1).toUpperCase()}</span>
          {/if}
          <span class="text-muted-foreground hidden text-xs sm:inline">{user?.name ?? user?.login}</span>
          <button onclick={onLogout} aria-label="Sign out" title="Sign out" class="text-muted-foreground hover:text-coral">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
          </button>
        </div>
      </div>
    </header>

    <form class="mt-4 flex gap-2" onsubmit={onAdd}>
      <input
        bind:value={title}
        placeholder="Dispatch a new card…"
        aria-label="New card title"
        class="bg-card border-border focus:border-marigold w-full max-w-sm rounded-[7px] border px-3 py-2 text-sm outline-none focus:ring-0"
      />
      <Button type="submit">Dispatch</Button>
    </form>

    {#if error || app.error}
      <p
        role="alert"
        class="border-coral/40 text-coral mono mt-3 rounded-[7px] border px-3 py-2 text-xs"
        style="background:rgba(255,107,87,.08)"
      >
        {error ?? app.error}
      </p>
    {/if}

    <!-- view + filter toolbar (Linear-style) -->
    <div class="mt-5 flex flex-wrap items-center gap-2">
      <div class="border-border inline-flex overflow-hidden rounded-[7px] border text-xs">
        <button onclick={() => (view = 'board')} class="mono px-2.5 py-1.5 {view === 'board' ? 'bg-marigold text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">Board</button>
        <button onclick={() => (view = 'list')} class="mono border-border border-l px-2.5 py-1.5 {view === 'list' ? 'bg-marigold text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">List</button>
      </div>

      <div class="relative">
        <button onclick={() => (showFilterMenu = !showFilterMenu)} class="border-border hover:border-marigold/50 mono inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-xs">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          Filter{#if activeFilterCount > 0}<span style="color:var(--marigold)"> · {activeFilterCount}</span>{/if}
        </button>
        {#if showFilterMenu}
          <div class="bg-card border-border absolute left-0 z-30 mt-2 w-64 rounded-[10px] border p-2 shadow-2xl max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:mt-0 max-sm:w-auto">
            {#if boardStates.length > 0}
              <div class="eyebrow px-1.5 py-1">state</div>
              {#each boardStates as s (s)}
                <button onclick={() => (filters.states = toggleIn(filters.states, s))} class="hover:bg-muted flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-xs">
                  <span class="size-3 rounded-[3px] border {filters.states.includes(s) ? 'border-marigold bg-marigold' : 'border-border'}"></span>{s}
                </button>
              {/each}
            {/if}
            {#if boardOwners.length > 0}
              <div class="eyebrow mt-1.5 px-1.5 py-1">owner</div>
              {#each boardOwners as o (o)}
                <button onclick={() => (filters.owners = toggleIn(filters.owners, o))} class="hover:bg-muted flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-xs">
                  <span class="size-3 rounded-[3px] border {filters.owners.includes(o) ? 'border-marigold bg-marigold' : 'border-border'}"></span><span class="truncate">{o}</span>
                </button>
              {/each}
            {/if}
            <label class="text-muted-foreground mt-2 flex items-center justify-between gap-2 px-1.5 text-xs">
              min priority
              <input type="number" min="0" bind:value={filters.minPriority} placeholder="any" class="bg-inset border-border focus:border-marigold mono w-16 rounded-[5px] border px-1.5 py-0.5 text-[11px] outline-none" />
            </label>
            <div class="border-border mt-2 space-y-0.5 border-t pt-1.5">
              <button onclick={() => (filters.needsReview = !filters.needsReview)} class="hover:bg-muted flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-xs"><span class="size-3 rounded-[3px] border {filters.needsReview ? 'border-coral bg-coral' : 'border-border'}"></span>needs review</button>
              <button onclick={() => (filters.live = !filters.live)} class="hover:bg-muted flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-xs"><span class="size-3 rounded-[3px] border {filters.live ? 'border-marigold bg-marigold' : 'border-border'}"></span>live (working)</button>
              <button onclick={() => (filters.overBudget = !filters.overBudget)} class="hover:bg-muted flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-xs"><span class="size-3 rounded-[3px] border {filters.overBudget ? 'border-coral bg-coral' : 'border-border'}"></span>over budget</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- active filter chips -->
      {#each filters.states as s (s)}<button onclick={() => (filters.states = toggleIn(filters.states, s))} class="bg-inset border-border mono rounded-[6px] border px-2 py-1 text-[11px]">state: {s} ×</button>{/each}
      {#each filters.owners as o (o)}<button onclick={() => (filters.owners = toggleIn(filters.owners, o))} class="bg-inset border-border mono rounded-[6px] border px-2 py-1 text-[11px]">owner: {o} ×</button>{/each}
      {#if filters.minPriority !== null}<button onclick={() => (filters.minPriority = null)} class="bg-inset border-border mono rounded-[6px] border px-2 py-1 text-[11px]">≥ P{filters.minPriority} ×</button>{/if}
      {#if filters.needsReview}<button onclick={() => (filters.needsReview = false)} class="bg-inset border-coral/50 text-coral mono rounded-[6px] border px-2 py-1 text-[11px]">needs review ×</button>{/if}
      {#if filters.live}<button onclick={() => (filters.live = false)} class="bg-inset border-border mono rounded-[6px] border px-2 py-1 text-[11px]">live ×</button>{/if}
      {#if filters.overBudget}<button onclick={() => (filters.overBudget = false)} class="bg-inset border-coral/50 text-coral mono rounded-[6px] border px-2 py-1 text-[11px]">over budget ×</button>{/if}
      {#if activeFilterCount > 0}<button onclick={clearFilters} class="text-muted-foreground hover:text-foreground text-xs">clear</button>{/if}

      {#if view === 'list'}
        <div class="text-muted-foreground ml-auto flex items-center gap-1.5">
          <span class="eyebrow">group</span>
          {#each ['stage', 'state', 'owner', 'priority'] as g (g)}
            <button onclick={() => (listGroupBy = g as typeof listGroupBy)} class="mono rounded-[5px] px-1.5 py-0.5 text-[11px] {listGroupBy === g ? 'text-marigold' : 'text-muted-foreground hover:text-foreground'}">{g}</button>
          {/each}
        </div>
      {/if}
    </div>

    {#if view === 'board'}
      <!-- board view: re-skinned kanban via the shared store -->
      <BoardKanban />
    {:else}
      <!-- list view (Linear-style, grouped) -->
      <div class="mt-4 pb-10">
        {#if listGroups.length === 0}
          <p class="text-muted-foreground mono py-16 text-center text-sm">No cards match these filters.</p>
        {:else}
          {#each listGroups as group (group.key)}
            <div class="mb-5">
              <div class="border-border/60 mb-1 flex items-center gap-2 border-b pb-1.5">
                <span class="wordmark text-[13px] tracking-wide">{group.label}</span>
                <span class="mono text-muted-foreground text-xs">{group.cards.length}</span>
              </div>
              {#each group.cards as card (card.id)}
                {@const gate = gateFor(card.id)}
                <button
                  onclick={() => app.openCard(card.id)}
                  class="border-border/40 hover:bg-inset/60 flex w-full items-center gap-3 border-b py-2.5 pr-1 pl-2 text-left {gate ? 'tile-gate' : ''}"
                >
                  <span class="mono text-muted-foreground w-7 shrink-0 text-[11px]">{card.priority > 0 ? `P${card.priority}` : ''}</span>
                  <span class="flex-1 truncate text-sm">{card.title}</span>
                  {#if card.state === 'working'}<span class="live-dot shrink-0" title="Agent working"></span>{/if}
                  {#if gate}<span class="eyebrow text-coral shrink-0">review</span>{/if}
                  {#if refsFor(card.id).length > 0}<span class="mono hidden shrink-0 text-[10px] sm:inline" style="color:var(--marigold)">↗{refsFor(card.id).length}</span>{/if}
                  {#if listGroupBy !== 'state'}<span class="mono text-muted-foreground hidden w-20 shrink-0 truncate text-right text-[11px] md:block">{card.state}</span>{/if}
                  <span class="mono text-muted-foreground hidden w-24 shrink-0 truncate text-[11px] sm:block">{card.ownerUserId}</span>
                  {#if listGroupBy !== 'stage'}<span class="border-border mono hidden shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[10px] lg:inline">{stageLabel(card.currentStageKey)}</span>{/if}
                  <span class="mono w-14 shrink-0 text-right text-[11px] {card.overBudget ? 'text-coral' : 'text-muted-foreground'}">{card.costUsd > 0 ? fmtUsd(card.costUsd) : ''}</span>
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}

  <!-- card drawer: session replay + gate resolution (owned by CardDrawer) -->
  {#if app.openCardId}
    <CardDrawer />
  {/if}

  <!-- agents manager -->
  {#if showConnect}
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button class="absolute inset-0 bg-black/55" onclick={closeConnect} aria-label="Close" tabindex="-1"></button>
      <div class="bg-surface border-border drawer-in relative w-full max-w-lg rounded-[12px] border p-6 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="eyebrow mb-1">agents</div>
            <h2 class="wordmark text-lg leading-snug">{minted ? 'Token created' : 'Agents in this workspace'}</h2>
          </div>
          <button onclick={closeConnect} aria-label="Close" class="text-muted-foreground hover:text-foreground shrink-0">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {#if minted}
          <p class="text-muted-foreground mt-2.5 text-sm leading-relaxed">
            <span class="text-foreground">{minted.agent.name}</span>'s token —
            <span class="text-coral">copy it now, it won't be shown again.</span>
          </p>
          <div class="bg-inset border-border mono mt-3 flex items-center justify-between gap-2 rounded-[7px] border px-3 py-2 text-xs">
            <span class="truncate">{minted.token}</span>
            <button onclick={() => navigator.clipboard?.writeText(minted!.token)} class="shrink-0 hover:brightness-110" style="color:var(--marigold)">copy</button>
          </div>
          <div class="eyebrow mt-5 mb-1.5">add it to your MCP client — .mcp.json</div>
          <pre class="bg-inset border-border mono overflow-x-auto rounded-[7px] border p-3 text-[11px] leading-relaxed">{mcpSnippet}</pre>
          <p class="text-muted-foreground mt-2 text-xs leading-relaxed">The agent claims cards whose stage matches its capabilities, works them, and hands off down the pipeline.</p>
          <div class="mt-5 flex justify-end"><Button onclick={() => (minted = null)}>Done</Button></div>
        {:else}
          <div class="mt-4 max-h-52 space-y-1.5 overflow-y-auto">
            {#if agents.length === 0}
              <p class="text-muted-foreground text-sm">No agents yet. Create one below — you'll get a token to point an AI agent at this workspace.</p>
            {:else}
              {#each agents as a (a.id)}
                <div class="bg-inset border-border group flex items-center justify-between gap-2 rounded-[8px] border px-3 py-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm">{a.name}</div>
                    <div class="mt-1 flex flex-wrap gap-1">
                      {#each a.capabilities as c (c)}<span class="border-border mono text-muted-foreground rounded-[4px] border px-1 py-0.5 text-[10px]">{c}</span>{/each}
                    </div>
                  </div>
                  <button onclick={() => onDeleteAgent(a.id)} aria-label="Revoke agent" title="Revoke agent + its token" class="text-muted-foreground hover:text-coral shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              {/each}
            {/if}
          </div>

          <div class="border-border mt-5 border-t pt-4">
            <div class="eyebrow mb-2">new agent</div>
            <input
              bind:value={agentName}
              placeholder="e.g. Research bot"
              onkeydown={(e) => {
                if (e.key === 'Enter') mintAgent();
              }}
              class="bg-inset border-border focus:border-marigold w-full rounded-[7px] border px-3 py-2 text-sm outline-none"
            />
            <div class="text-muted-foreground mt-2.5 mb-1.5 text-xs">capabilities it can claim:</div>
            <div class="flex flex-wrap gap-1.5">
              {#each ALL_CAPS as cap (cap)}
                <button
                  onclick={() => toggleCap(cap)}
                  class="mono rounded-[6px] border px-2.5 py-1 text-[11px] transition {newCaps.includes(cap)
                    ? 'border-marigold text-marigold'
                    : 'border-border text-muted-foreground hover:text-foreground'}"
                >
                  {newCaps.includes(cap) ? '✓ ' : ''}{cap}
                </button>
              {/each}
            </div>
            <div class="mt-4 flex justify-end">
              <Button onclick={mintAgent} disabled={minting || agentName.trim() === '' || newCaps.length === 0}>{minting ? 'Minting…' : 'Create + mint token'}</Button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <NewBoardDialog
    open={showNewBoard}
    onClose={() => (showNewBoard = false)}
    onCreated={(id) => {
      showNewBoard = false;
      void openBoard(id);
    }}
  />

  {#if board}
    <BoardSettings open={showSettings} {board} onClose={() => (showSettings = false)} onChanged={refresh} />
  {/if}
</main>
