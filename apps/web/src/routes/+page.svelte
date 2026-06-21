<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createBoard,
    getBoard,
    createCard,
    moveCard,
    resolveGate,
    openBoardSocket,
    DEFAULT_STAGES,
    type BoardSnapshot,
    type GateDecision,
  } from '$lib/api';
  import { Button } from '$lib/components/ui/button';
  import { cardDraggable, columnDropTarget } from '$lib/dnd';

  const BOARD_KEY = 'kaambaan.boardId';

  let board = $state<BoardSnapshot | null>(null);
  let title = $state('');
  let error = $state<string | null>(null);
  let connected = $state(false);
  let overStage = $state<string | null>(null);

  let boardId: string | null = null;

  async function refresh(): Promise<void> {
    if (!boardId) return;
    try {
      board = await getBoard(boardId);
    } catch (e) {
      error = String(e);
    }
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
      <span
        class="rounded-full border px-2 py-0.5 text-xs {connected
          ? 'border-emerald-500/40 text-emerald-400'
          : 'text-muted-foreground'}"
      >
        {connected ? '● live' : '○ offline'}
      </span>
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
          </div>
          <div class="flex min-h-10 flex-col gap-2">
            {#each cards as card (card.id)}
              <article
                use:cardDraggable={{ cardId: card.id }}
                class="bg-background cursor-grab rounded-lg border p-2.5 transition-opacity active:cursor-grabbing"
              >
                <div class="text-sm leading-snug">{card.title}</div>
                <div class="text-muted-foreground mt-1.5 text-xs">{card.ownerUserId}</div>
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
