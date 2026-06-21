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

<main class="min-h-screen p-6">
  {#if !board}
    <h1 class="text-xl font-bold">Kaambaan</h1>
    <p class="text-muted-foreground mt-2 text-sm">{error ?? 'Loading board…'}</p>
  {:else}
    <header class="flex items-center justify-between">
      <h1 class="text-xl font-bold">
        Kaambaan <span class="text-muted-foreground font-normal">/ {board.name}</span>
      </h1>
      <div class="flex items-center gap-2">
        <div class="relative">
          <button
            onclick={() => (showNotifications = !showNotifications)}
            class="rounded-full border px-2 py-0.5 text-xs {unreadCount > 0 ? 'border-amber-500/50 text-amber-400' : 'text-muted-foreground'}"
          >
            🔔 {unreadCount}
          </button>
          {#if showNotifications}
            <div class="bg-card absolute right-0 z-10 mt-1 w-72 rounded-md border p-1 text-xs shadow-lg">
              {#if notifications.length === 0}
                <p class="text-muted-foreground p-2">No notifications</p>
              {:else}
                {#each notifications.slice(0, 20) as n (n.seq)}
                  <button
                    onclick={() => onMarkRead(n.seq)}
                    class="hover:bg-muted flex w-full items-start gap-2 rounded p-1.5 text-left"
                  >
                    <span class={n.read ? 'text-muted-foreground' : 'text-amber-400'}>{n.read ? '○' : '●'}</span>
                    <span><span class="font-medium">{n.kind}</span> · {n.body}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
        <span
          title="Total agent cost{board.usage.budgetUsd !== null ? ` of a ${fmtUsd(board.usage.budgetUsd)} budget` : ''}"
          class="rounded-full border px-2 py-0.5 text-xs {board.usage.overBudget
            ? 'border-destructive/50 text-destructive'
            : 'text-muted-foreground'}"
        >
          {fmtUsd(board.usage.totalCostUsd)}{board.usage.budgetUsd !== null ? ` / ${fmtUsd(board.usage.budgetUsd)}` : ''}
        </span>
        <span
          class="rounded-full border px-2 py-0.5 text-xs {connected
            ? 'border-emerald-500/40 text-emerald-400'
            : 'text-muted-foreground'}"
        >
          {connected ? '● live' : '○ offline'}
        </span>
      </div>
    </header>

    <form class="mt-4 flex gap-2" onsubmit={onAdd}>
      <input
        bind:value={title}
        placeholder="New card title…"
        aria-label="New card title"
        class="bg-card focus:ring-ring w-full max-w-sm rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
      />
      <Button type="submit">Add card</Button>
    </form>

    {#if error}
      <p
        role="alert"
        class="border-destructive/40 bg-destructive/10 text-destructive-foreground mt-3 rounded-md border px-3 py-2 text-sm"
      >
        {error}
      </p>
    {/if}

    <div class="mt-5 flex items-start gap-3 overflow-x-auto pb-4">
      {#each board.stages as stage (stage.key)}
        {@const cards = cardsIn(stage.key)}
        {@const overLimit = stage.wipLimit !== undefined && cards.length >= stage.wipLimit}
        <section
          class="bg-card w-60 shrink-0 rounded-xl border p-2 transition-colors {overStage === stage.key
            ? 'ring-primary ring-2'
            : ''}"
          use:columnDropTarget={{
            stageKey: stage.key,
            onDrop: (cardId) => onDropCard(stage.key, cardId),
            onOver: (o) => (overStage = o ? stage.key : overStage === stage.key ? null : overStage),
          }}
        >
          <div class="flex items-center gap-2 px-1 pb-2">
            <span class="text-sm font-semibold">{stage.name}</span>
            <span
              class="ml-auto rounded-full border px-1.5 text-xs {overLimit
                ? 'text-destructive border-destructive/50'
                : 'text-muted-foreground'}"
            >
              {cards.length}{stage.wipLimit !== undefined ? ` / ${stage.wipLimit}` : ''}
            </span>
            {#if stage.gate === 'approval'}
              <span title="Approval gate">⛳</span>
            {/if}
            {#if stage.routing === 'manager'}
              <span title="Manager routing" class="text-muted-foreground text-[10px] uppercase">mgr</span>
            {/if}
          </div>
          <div class="flex min-h-10 flex-col gap-2">
            {#each cards as card (card.id)}
              <article
                use:cardDraggable={{ cardId: card.id }}
                class="bg-background cursor-grab rounded-lg border p-2.5 transition-opacity active:cursor-grabbing"
              >
                <div class="text-sm leading-snug">{card.title}</div>
                <div class="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
                  <span>{card.ownerUserId}</span>
                  {#if card.costUsd > 0}
                    <span title="Agent cost on this card" class={card.overBudget ? 'text-destructive font-medium' : ''}>
                      {fmtUsd(card.costUsd)}
                    </span>
                  {/if}
                </div>
                {#if refsFor(card.id).length > 0}
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    {#each refsFor(card.id) as ref (ref.id)}
                      {@const href = safeHref(ref.url)}
                      {#if href}
                        <a
                          {href}
                          target="_blank"
                          rel="noreferrer"
                          title={ref.url}
                          class="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
                        >
                          <span>🔗</span>{refLabel(ref)}{#if subStateLabel(ref)}<span class="opacity-60">· {subStateLabel(ref)}</span>{/if}
                        </a>
                      {:else}
                        <span class="bg-muted inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
                          <span>🔗</span>{refLabel(ref)}{#if subStateLabel(ref)}<span class="opacity-60">· {subStateLabel(ref)}</span>{/if}
                        </span>
                      {/if}
                    {/each}
                  </div>
                {/if}
                {#if card.attemptCount > 1}
                  <button
                    onclick={() => toggleAttempts(card.id)}
                    class="text-muted-foreground hover:text-foreground mt-1.5 text-xs underline-offset-2 hover:underline"
                  >
                    ⟳ {card.attemptCount} attempts
                  </button>
                  {#if openAttempts === card.id && attemptsByCard[card.id]}
                    <div class="mt-1 space-y-1 border-l pl-2 text-xs">
                      {#each attemptsByCard[card.id] as a, i (a.runId)}
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-muted-foreground">#{i + 1} {a.agentId}{a.profileKey ? ` · ${a.profileKey}` : a.model ? ` · ${a.model}` : ''}</span>
                          <span>{fmtUsd(a.costUsd)}{a.outcome ? ` · ${a.outcome}` : ''}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
                {#if gateFor(card.id)}
                  {@const gate = gateFor(card.id)!}
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" onclick={() => onResolve(gate.id, 'approve')}>Approve</Button>
                    <Button size="sm" variant="outline" onclick={() => onResolve(gate.id, 'request_changes')}>
                      Changes
                    </Button>
                    <Button size="sm" variant="ghost" onclick={() => onResolve(gate.id, 'reject')}>Reject</Button>
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
