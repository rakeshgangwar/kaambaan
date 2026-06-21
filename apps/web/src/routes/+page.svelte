<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createBoard,
    getBoard,
    createCard,
    moveCard,
    resolveGate,
    openBoardSocket,
    getAttempts,
    getNotifications,
    markNotificationRead,
    DEFAULT_STAGES,
    type BoardSnapshot,
    type GateDecision,
    type Attempt,
    type Notification,
  } from '$lib/api';
  import { Button } from '$lib/components/ui/button';
  import { cardDraggable, columnDropTarget } from '$lib/dnd';

  const BOARD_KEY = 'kaambaan.boardId';

  let board = $state<BoardSnapshot | null>(null);
  let title = $state('');
  let error = $state<string | null>(null);
  let connected = $state(false);
  let overStage = $state<string | null>(null);

  let notifications = $state<Notification[]>([]);
  let showNotifications = $state(false);
  let attemptsByCard = $state<Record<string, Attempt[]>>({});
  let openAttempts = $state<string | null>(null);

  let boardId: string | null = null;

  async function refresh(): Promise<void> {
    if (!boardId) return;
    try {
      board = await getBoard(boardId);
      notifications = await getNotifications(boardId);
    } catch (e) {
      error = String(e);
    }
  }

  const unreadCount = $derived(notifications.filter((n) => !n.read).length);

  async function onMarkRead(seq: number): Promise<void> {
    if (!boardId) return;
    await markNotificationRead(boardId, seq);
    await refresh();
  }

  async function toggleAttempts(cardId: string): Promise<void> {
    if (openAttempts === cardId) {
      openAttempts = null;
      return;
    }
    if (boardId) attemptsByCard[cardId] = await getAttempts(boardId, cardId);
    openAttempts = cardId;
  }

  onMount(() => {
    let socket: WebSocket | undefined;
    void (async () => {
      try {
        let id = localStorage.getItem(BOARD_KEY);
        if (id) {
          try {
            await getBoard(id);
          } catch {
            id = null; // stale id — recreate
          }
        }
        if (!id) {
          id = await createBoard('My Board', DEFAULT_STAGES);
          localStorage.setItem(BOARD_KEY, id);
        }
        boardId = id;
        await refresh();
        socket = openBoardSocket(id, refresh);
        socket.addEventListener('open', () => (connected = true));
        socket.addEventListener('close', () => (connected = false));
      } catch (e) {
        error = String(e);
      }
    })();
    return () => socket?.close();
  });

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

  async function onResolve(gateId: string, decision: GateDecision): Promise<void> {
    if (!boardId) return;
    const res = await resolveGate(boardId, gateId, decision);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      error = body?.error?.message ?? `Resolve failed (${res.status})`;
    } else {
      error = null;
    }
    await refresh();
  }
</script>

<main class="min-h-screen px-5 py-5 sm:px-7">
  {#if !board}
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
          <div class="mono text-muted-foreground mt-1 text-xs">{board.name}</div>
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
              <article
                use:cardDraggable={{ cardId: card.id }}
                class="tile bg-inset border-border cursor-grab rounded-[10px] border p-3 active:cursor-grabbing {gate ? 'tile-gate' : ''}"
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
                        <a {href} target="_blank" rel="noreferrer" title={ref.url} class="border-border hover:border-marigold/50 mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]">
                          <span style="color:var(--marigold)">↗</span>{inner}
                        </a>
                      {:else}
                        <span class="border-border mono inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10px]">{inner}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}

                {#if card.attemptCount > 1}
                  <button onclick={() => toggleAttempts(card.id)} class="text-muted-foreground hover:text-foreground mono mt-2 text-[11px]">
                    ×{card.attemptCount} attempts {openAttempts === card.id ? '▾' : '▸'}
                  </button>
                  {#if openAttempts === card.id && attemptsByCard[card.id]}
                    <div class="border-border mt-1.5 space-y-1 border-l pl-2.5">
                      {#each attemptsByCard[card.id] as a, i (a.runId)}
                        <div class="mono flex items-center justify-between gap-2 text-[10px]">
                          <span class="text-muted-foreground">{i + 1} · {a.agentId}{a.profileKey ? ` · ${a.profileKey}` : a.model ? ` · ${a.model}` : ''}</span>
                          <span>{fmtUsd(a.costUsd)}{a.outcome ? ` · ${a.outcome}` : ''}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}

                {#if gate}
                  <div class="border-border mt-2.5 border-t pt-2.5">
                    <div class="eyebrow text-coral mb-1.5">awaiting your review</div>
                    <div class="flex flex-wrap gap-1.5">
                      <Button size="sm" onclick={() => onResolve(gate.id, 'approve')}>Approve</Button>
                      <Button size="sm" variant="outline" onclick={() => onResolve(gate.id, 'request_changes')}>Changes</Button>
                      <Button size="sm" variant="ghost" onclick={() => onResolve(gate.id, 'reject')}>Reject</Button>
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</main>
