<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createBoard,
    getBoard,
    getBoards,
    createCard,
    moveCard,
    resolveGate,
    openBoardSocket,
    getAttempts,
    getCardActivities,
    getNotifications,
    markNotificationRead,
    getMe,
    logout,
    createAgent,
    getAgents,
    deleteBoard,
    deleteAgent,
    BOARD_TEMPLATES,
    type BoardSnapshot,
    type BoardSummary,
    type GateDecision,
    type Attempt,
    type CardActivities,
    type Notification,
    type User,
    type AgentToken,
  } from '$lib/api';
  import { Button } from '$lib/components/ui/button';
  import { cardDraggable, columnDropTarget } from '$lib/dnd';

  const BOARD_KEY = 'kaambaan.boardId';

  // auth + onboarding
  let authState = $state<'loading' | 'signed-out' | 'ready'>('loading');
  let user = $state<User | null>(null);
  let needsBoard = $state(false); // signed in but no boards yet → onboarding
  let creating = $state(false);

  // boards (switcher + create from a template)
  let boards = $state<BoardSummary[]>([]);
  let showBoardMenu = $state(false);
  let showNewBoard = $state(false);
  let newBoardName = $state('');
  let newBoardTemplate = $state(BOARD_TEMPLATES[0]!.id);

  // agents manager (list + mint + revoke)
  let showConnect = $state(false);
  let agents = $state<Array<{ id: string; name: string; capabilities: string[] }>>([]);
  const ALL_CAPS = ['research', 'review', 'publish'];
  let agentName = $state('');
  let newCaps = $state<string[]>(['research', 'review', 'publish']);
  let minted = $state<AgentToken | null>(null);
  let minting = $state(false);

  let board = $state<BoardSnapshot | null>(null);
  let title = $state('');
  let error = $state<string | null>(null);
  let connected = $state(false);
  let overStage = $state<string | null>(null);
  let socket: WebSocket | undefined;

  let notifications = $state<Notification[]>([]);
  let showNotifications = $state(false);

  // card drawer (session replay, docs/07 §4)
  let openCardId = $state<string | null>(null);
  let cardDetail = $state<CardActivities | null>(null);
  let drawerAttempts = $state<Attempt[]>([]);
  let gateComment = $state('');

  let boardId = $state<string | null>(null);

  async function refresh(): Promise<void> {
    if (!boardId) return;
    try {
      board = await getBoard(boardId);
      notifications = await getNotifications(boardId);
      await refreshDrawer();
    } catch (e) {
      error = String(e);
    }
  }

  const mcpSnippet = $derived(
    minted
      ? JSON.stringify({ mcpServers: { kaambaan: { url: `${location.origin}/mcp`, headers: { Authorization: `Bearer ${minted.token}` } } } }, null, 2)
      : '',
  );

  const openCard = $derived(board && openCardId ? (board.cards.find((c) => c.id === openCardId) ?? null) : null);
  const openCardGate = $derived(openCardId ? gateFor(openCardId) : undefined);

  async function openDrawer(cardId: string): Promise<void> {
    openCardId = cardId;
    gateComment = '';
    await refreshDrawer();
  }

  function closeDrawer(): void {
    openCardId = null;
    cardDetail = null;
    drawerAttempts = [];
  }

  async function refreshDrawer(): Promise<void> {
    if (!openCardId || !boardId) return;
    try {
      [cardDetail, drawerAttempts] = await Promise.all([getCardActivities(boardId, openCardId), getAttempts(boardId, openCardId)]);
    } catch {
      /* drawer detail is best-effort */
    }
  }

  function activityMarker(type: string): { glyph: string; color: string } {
    if (type === 'action') return { glyph: '▸', color: 'var(--marigold)' };
    if (type === 'response') return { glyph: '●', color: 'var(--live)' };
    if (type === 'error') return { glyph: '✕', color: 'var(--coral)' };
    if (type === 'elicitation') return { glyph: '?', color: 'var(--coral)' };
    return { glyph: '·', color: 'var(--muted)' }; // thought
  }

  function fmtTime(ts: string): string {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  }

  const unreadCount = $derived(notifications.filter((n) => !n.read).length);

  async function onMarkRead(seq: number): Promise<void> {
    if (!boardId) return;
    await markNotificationRead(boardId, seq);
    await refresh();
  }

  async function loadBoards(): Promise<void> {
    try {
      boards = await getBoards();
    } catch {
      /* the switcher list is best-effort */
    }
  }

  async function openBoard(id: string): Promise<void> {
    boardId = id;
    needsBoard = false;
    showBoardMenu = false;
    localStorage.setItem(BOARD_KEY, id);
    await refresh();
    await loadBoards();
    socket?.close();
    socket = openBoardSocket(id, refresh);
    socket.addEventListener('open', () => (connected = true));
    socket.addEventListener('close', () => (connected = false));
  }

  async function switchBoard(id: string): Promise<void> {
    showBoardMenu = false;
    if (id !== boardId) await openBoard(id);
  }

  async function createNewBoard(): Promise<void> {
    const tpl = BOARD_TEMPLATES.find((t) => t.id === newBoardTemplate) ?? BOARD_TEMPLATES[0]!;
    if (newBoardName.trim() === '') return;
    creating = true;
    try {
      await openBoard(await createBoard(newBoardName.trim(), tpl.stages));
      showNewBoard = false;
      newBoardName = '';
    } catch (e) {
      error = String(e);
    } finally {
      creating = false;
    }
  }

  async function onDeleteBoard(id: string): Promise<void> {
    const res = await deleteBoard(id);
    if (!res.ok) {
      error = `Couldn't delete that board (${res.status})`;
      return;
    }
    await loadBoards();
    if (id === boardId) {
      const next = boards[0];
      if (next) {
        await openBoard(next.id);
      } else {
        boardId = null;
        board = null;
        localStorage.removeItem(BOARD_KEY);
        needsBoard = true;
        socket?.close();
      }
    }
  }

  onMount(() => {
    void (async () => {
      try {
        user = await getMe();
        if (!user) {
          authState = 'signed-out';
          return;
        }
        authState = 'ready';
        // Pick a board: the last one used, else the workspace's most recent, else onboarding.
        let id = localStorage.getItem(BOARD_KEY);
        if (id) {
          try {
            await getBoard(id);
          } catch {
            id = null;
            localStorage.removeItem(BOARD_KEY);
          }
        }
        if (!id) {
          await loadBoards();
          id = boards[0]?.id ?? null;
        }
        if (!id) {
          needsBoard = true; // new workspace → show onboarding
          return;
        }
        await openBoard(id);
      } catch (e) {
        error = String(e);
      }
    })();
    return () => socket?.close();
  });

  async function createFirstBoard(): Promise<void> {
    creating = true;
    try {
      // Default a new user into the agent pipeline so their board is workable by agents from day one.
      await openBoard(await createBoard('My first board', BOARD_TEMPLATES[0]!.stages));
    } catch (e) {
      error = String(e);
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
      await createCard(boardId, title.trim());
      title = '';
      await refresh();
    } catch (err) {
      error = String(err);
    }
  }

  async function onDropCard(stageKey: string, cardId: string): Promise<void> {
    if (!boardId) return;
    const res = await moveCard(boardId, cardId, stageKey);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      error = body?.error?.message ?? `Move failed (${res.status})`;
    } else {
      error = null;
    }
    await refresh();
  }

  function cardsIn(stageKey: string): BoardSnapshot['cards'] {
    return board ? board.cards.filter((c) => c.currentStageKey === stageKey) : [];
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

  async function onResolve(gateId: string, decision: GateDecision, comment?: string): Promise<void> {
    if (!boardId) return;
    const res = await resolveGate(boardId, gateId, decision, comment?.trim() || undefined);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      error = body?.error?.message ?? `Resolve failed (${res.status})`;
    } else {
      error = null;
      closeDrawer();
    }
    await refresh();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeConnect();
      showNotifications = false;
      showBoardMenu = false;
      showNewBoard = false;
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
        <span class="live-dot"></span>{error ?? 'establishing link to the board…'}
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
                    <button onclick={() => onDeleteBoard(b.id)} aria-label="Delete board" title="Delete board" class="text-muted-foreground hover:text-coral mr-1 px-1 opacity-0 group-hover:opacity-100">
                      <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                {/each}
                <button onclick={() => { showBoardMenu = false; showNewBoard = true; }} class="text-marigold hover:bg-muted mt-1 flex w-full items-center gap-1.5 rounded-[7px] px-2 py-1.5 text-left text-xs">
                  <span class="text-sm leading-none">+</span> New board
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <!-- live signal -->
        <span class="border-border mono inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-xs">
          {#if connected}
            <span class="live-dot"></span><span style="color:var(--live)">live</span>
          {:else}
            <span class="text-muted-foreground">○</span><span class="text-muted-foreground">offline</span>
          {/if}
        </span>

        <!-- spend meter -->
        <div
          class="border-border flex items-center gap-2 rounded-[7px] border px-2.5 py-1.5"
          title="Total agent spend{board.usage.budgetUsd !== null ? ` of a ${fmtUsd(board.usage.budgetUsd)} budget` : ''}"
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
            <div class="bg-card border-border absolute right-0 z-20 mt-2 w-80 rounded-[10px] border p-1.5 shadow-2xl">
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

    {#if error}
      <p
        role="alert"
        class="border-coral/40 text-coral mono mt-3 rounded-[7px] border px-3 py-2 text-xs"
        style="background:rgba(255,107,87,.08)"
      >
        {error}
      </p>
    {/if}

    <!-- the directed flight path: stages are waypoints, work flows → -->
    <div class="mt-6 flex items-start overflow-x-auto pb-6">
      {#each board.stages as stage, i (stage.key)}
        {@const cards = cardsIn(stage.key)}
        {@const overLimit = stage.wipLimit !== undefined && cards.length >= stage.wipLimit}
        {#if i > 0}
          <div class="flow-arrow px-2.5">
            <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </div>
        {/if}
        <section
          class="w-64 shrink-0 rounded-[12px] p-2 transition-[box-shadow,background-color] {overStage === stage.key ? 'ring-marigold bg-card ring-2' : 'bg-card/40'}"
          use:columnDropTarget={{
            stageKey: stage.key,
            onDrop: (cardId) => onDropCard(stage.key, cardId),
            onOver: (o) => (overStage = o ? stage.key : overStage === stage.key ? null : overStage),
          }}
        >
          <!-- waypoint -->
          <div class="flex h-[30px] items-center gap-2 px-1.5">
            <span class="wordmark text-[13px] tracking-wide">{stage.name}</span>
            <span class="mono text-xs {overLimit ? 'text-coral' : 'text-muted-foreground'}">
              {cards.length}{#if stage.wipLimit !== undefined}/{stage.wipLimit}{/if}
            </span>
            <span class="ml-auto flex items-center gap-1.5">
              {#if stage.gate === 'approval'}<span class="eyebrow text-coral" title="Approval gate">gate</span>{/if}
              {#if stage.routing === 'manager'}<span class="eyebrow" title="Manager routing">mgr</span>{/if}
            </span>
          </div>

          <div class="mt-1.5 flex min-h-12 flex-col gap-2">
            {#if cards.length === 0}
              <div class="eyebrow border-border/60 mx-1 rounded-[8px] border border-dashed px-2 py-4 text-center">awaiting work</div>
            {/if}
            {#each cards as card (card.id)}
              {@const gate = gateFor(card.id)}
              <div
                use:cardDraggable={{ cardId: card.id }}
                role="button"
                tabindex="0"
                aria-label="Open {card.title}"
                onclick={() => openDrawer(card.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openDrawer(card.id);
                  }
                }}
                class="tile bg-inset border-border cursor-grab rounded-[10px] border p-3 text-left active:cursor-grabbing {gate ? 'tile-gate' : ''}"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="text-[13px] leading-snug">{card.title}</div>
                  {#if card.state === 'working'}<span class="live-dot mt-1 shrink-0" title="Agent working"></span>{/if}
                </div>

                <div class="text-muted-foreground mono mt-2 flex items-center justify-between text-[11px]">
                  <span>{card.ownerUserId}</span>
                  {#if card.costUsd > 0}
                    <span title="Agent cost on this card" class={card.overBudget ? 'text-coral' : ''}>{fmtUsd(card.costUsd)}</span>
                  {/if}
                </div>

                {#if refsFor(card.id).length > 0}
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    {#each refsFor(card.id) as ref (ref.id)}
                      {@const href = safeHref(ref.url)}
                      {@const inner = `${refLabel(ref)}${subStateLabel(ref) ? ` · ${subStateLabel(ref)}` : ''}`}
                      {#if href}
                        <a {href} target="_blank" rel="noreferrer" title={ref.url} onclick={(e) => e.stopPropagation()} class="border-border hover:border-marigold/50 mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]">
                          <span style="color:var(--marigold)">↗</span>{inner}
                        </a>
                      {:else}
                        <span class="border-border mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]">{inner}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}

                {#if card.attemptCount > 1}
                  <div class="text-muted-foreground mono mt-2 text-[11px]">×{card.attemptCount} attempts</div>
                {/if}

                {#if gate}
                  <div class="border-border mt-2.5 border-t pt-2.5">
                    <div class="eyebrow text-coral mb-1.5">awaiting your review</div>
                    <div class="flex flex-wrap gap-1.5">
                      <Button size="sm" onclick={(e) => { e.stopPropagation(); onResolve(gate.id, 'approve'); }}>Approve</Button>
                      <Button size="sm" variant="outline" onclick={(e) => { e.stopPropagation(); openDrawer(card.id); }}>Changes…</Button>
                      <Button size="sm" variant="ghost" onclick={(e) => { e.stopPropagation(); onResolve(gate.id, 'reject'); }}>Reject</Button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}

  <!-- card drawer: session replay (docs/07 §4) -->
  {#if openCard}
    {@const stageName = board?.stages.find((s) => s.key === openCard.currentStageKey)?.name ?? openCard.currentStageKey}
    <div class="fixed inset-0 z-30 flex justify-end">
      <button class="absolute inset-0 bg-black/55" onclick={closeDrawer} aria-label="Close drawer" tabindex="-1"></button>
      <aside class="bg-surface border-border drawer-in relative flex h-full w-full max-w-[460px] flex-col border-l shadow-2xl">
        <div class="border-border flex items-start justify-between gap-3 border-b p-4">
          <div class="min-w-0">
            <div class="eyebrow mb-1.5">{stageName} · {openCard.state}</div>
            <h2 class="wordmark text-base leading-snug">{openCard.title}</h2>
            <div class="text-muted-foreground mono mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
              <span>{openCard.ownerUserId}</span>
              {#if openCard.costUsd > 0}<span class={openCard.overBudget ? 'text-coral' : ''}>{fmtUsd(openCard.costUsd)}</span>{/if}
              {#if openCard.state === 'working'}<span class="inline-flex items-center gap-1.5"><span class="live-dot"></span><span style="color:var(--live)">working</span></span>{/if}
            </div>
          </div>
          <button onclick={closeDrawer} class="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-[7px] p-1.5" aria-label="Close">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div class="flex-1 space-y-6 overflow-y-auto p-4">
          {#if refsFor(openCard.id).length > 0}
            <section>
              <div class="eyebrow mb-2">references</div>
              <div class="flex flex-wrap gap-1.5">
                {#each refsFor(openCard.id) as ref (ref.id)}
                  {@const href = safeHref(ref.url)}
                  {@const inner = `${refLabel(ref)}${subStateLabel(ref) ? ` · ${subStateLabel(ref)}` : ''}`}
                  {#if href}
                    <a {href} target="_blank" rel="noreferrer" class="border-border hover:border-marigold/50 mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]"><span style="color:var(--marigold)">↗</span>{inner}</a>
                  {:else}
                    <span class="border-border mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]">{inner}</span>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}

          {#if cardDetail?.handoff}
            <section>
              <div class="eyebrow mb-2">handoff from prior stage</div>
              <div class="bg-inset border-border mono space-y-1 rounded-[8px] border p-3 text-[11px]">
                {#each Object.entries(cardDetail.handoff) as [k, v] (k)}
                  <div><span class="text-muted-foreground">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}</div>
                {/each}
              </div>
            </section>
          {/if}

          {#if drawerAttempts.length > 1}
            <section>
              <div class="eyebrow mb-2">attempts · {drawerAttempts.length}</div>
              <div class="space-y-1.5">
                {#each drawerAttempts as a, i (a.runId)}
                  <div class="bg-inset border-border mono flex items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5 text-[11px]">
                    <span class="text-muted-foreground truncate">{i + 1} · {a.agentId}{a.profileKey ? ` · ${a.profileKey}` : a.model ? ` · ${a.model}` : ''}</span>
                    <span class="shrink-0">{fmtUsd(a.costUsd)}{a.outcome ? ` · ${a.outcome}` : ''}</span>
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <section>
            <div class="eyebrow mb-3">session replay</div>
            {#if !cardDetail || cardDetail.activities.length === 0}
              <p class="text-muted-foreground text-xs">No recorded activity yet — this card hasn't been worked.</p>
            {:else}
              <ol class="border-border ml-1 space-y-4 border-l pl-4">
                {#each cardDetail.activities as a (a.seq)}
                  {@const m = activityMarker(a.type)}
                  <li class="relative">
                    <span class="mono absolute -left-[22px] top-px text-[12px]" style="color:{m.color}">{m.glyph}</span>
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="eyebrow" style="color:{m.color}">{a.type}</span>
                      <span class="text-muted-foreground mono text-[10px]">{fmtTime(a.ts)}</span>
                    </div>
                    {#if a.action}
                      <div class="mono mt-1 text-[11px]"><span style="color:var(--marigold)">{a.action}</span>{#if a.parameter}<span class="text-muted-foreground"> {JSON.stringify(a.parameter).slice(0, 140)}</span>{/if}</div>
                    {/if}
                    {#if a.body}<div class="mt-1 text-xs leading-relaxed {a.type === 'error' ? 'text-coral' : 'text-foreground/90'}">{a.body}</div>{/if}
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        </div>

        {#if openCardGate}
          <div class="border-border bg-surface border-t p-4">
            <div class="eyebrow text-coral mb-2">awaiting your review</div>
            <textarea
              bind:value={gateComment}
              rows="2"
              placeholder="Feedback for the agent — sent on Request changes…"
              class="bg-inset border-border focus:border-marigold mb-2.5 w-full resize-none rounded-[7px] border px-2.5 py-2 text-xs outline-none"
            ></textarea>
            <div class="flex flex-wrap gap-1.5">
              <Button size="sm" onclick={() => onResolve(openCardGate.id, 'approve', gateComment)}>Approve</Button>
              <Button size="sm" variant="outline" onclick={() => onResolve(openCardGate.id, 'request_changes', gateComment)}>Request changes</Button>
              <Button size="sm" variant="ghost" onclick={() => onResolve(openCardGate.id, 'reject', gateComment)}>Reject</Button>
            </div>
          </div>
        {/if}
      </aside>
    </div>
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
                  <button onclick={() => onDeleteAgent(a.id)} aria-label="Revoke agent" title="Revoke agent + its token" class="text-muted-foreground hover:text-coral shrink-0 opacity-0 group-hover:opacity-100">
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

  <!-- new board -->
  {#if showNewBoard}
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button class="absolute inset-0 bg-black/55" onclick={() => (showNewBoard = false)} aria-label="Close" tabindex="-1"></button>
      <div class="bg-surface border-border drawer-in relative w-full max-w-lg rounded-[12px] border p-6 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="eyebrow mb-1">new board</div>
            <h2 class="wordmark text-lg leading-snug">Create a board</h2>
          </div>
          <button onclick={() => (showNewBoard = false)} aria-label="Close" class="text-muted-foreground hover:text-foreground shrink-0">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <input
          bind:value={newBoardName}
          placeholder="Board name — e.g. Launch"
          onkeydown={(e) => {
            if (e.key === 'Enter') createNewBoard();
          }}
          class="bg-inset border-border focus:border-marigold mt-4 w-full rounded-[7px] border px-3 py-2 text-sm outline-none"
        />

        <div class="eyebrow mt-5 mb-2">pipeline</div>
        <div class="space-y-2">
          {#each BOARD_TEMPLATES as tpl (tpl.id)}
            <button
              onclick={() => (newBoardTemplate = tpl.id)}
              class="block w-full rounded-[9px] border p-3 text-left transition {newBoardTemplate === tpl.id ? 'border-marigold bg-inset' : 'border-border hover:border-border/80'}"
            >
              <div class="flex items-center gap-2">
                <span class="size-3 rounded-full border" style="border-color:{newBoardTemplate === tpl.id ? 'var(--marigold)' : 'var(--line)'};background:{newBoardTemplate === tpl.id ? 'var(--marigold)' : 'transparent'}"></span>
                <span class="text-sm font-medium">{tpl.name}</span>
              </div>
              <p class="text-muted-foreground mt-1.5 pl-5 text-xs leading-relaxed">{tpl.description}</p>
              <div class="mt-2 flex flex-wrap items-center gap-1 pl-5">
                {#each tpl.stages as s, i (s.key)}
                  <span class="border-border mono rounded-[5px] border px-1.5 py-0.5 text-[10px] {s.ownerKind === 'capability' ? 'text-marigold' : s.gate === 'approval' ? 'text-coral' : 'text-muted-foreground'}">{s.name}</span>
                  {#if i < tpl.stages.length - 1}<span class="text-muted-foreground" aria-hidden="true">→</span>{/if}
                {/each}
              </div>
            </button>
          {/each}
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onclick={() => (showNewBoard = false)}>Cancel</Button>
          <Button onclick={createNewBoard} disabled={creating || newBoardName.trim() === ''}>{creating ? 'Creating…' : 'Create board'}</Button>
        </div>
      </div>
    </div>
  {/if}
</main>
