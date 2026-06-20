<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createBoard,
    getBoard,
    createCard,
    moveCard,
    openBoardSocket,
    DEFAULT_STAGES,
    type BoardSnapshot,
  } from '$lib/api';

  const BOARD_KEY = 'kaambaan.boardId';

  let board = $state<BoardSnapshot | null>(null);
  let title = $state('');
  let error = $state<string | null>(null);
  let connected = $state(false);

  let boardId: string | null = null;
  let dragCardId: string | null = null;

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

  async function onDropCard(stageKey: string): Promise<void> {
    if (!boardId || !dragCardId) return;
    const res = await moveCard(boardId, dragCardId, stageKey);
    dragCardId = null;
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
</script>

<main class="app">
  {#if !board}
    <h1 class="brand">Kaambaan</h1>
    <p class="muted">{error ?? 'Loading board…'}</p>
  {:else}
    <header class="topbar">
      <h1 class="brand">Kaambaan <span class="muted">/ {board.name}</span></h1>
      <span class="dot {connected ? 'live' : 'off'}">{connected ? 'live' : 'offline'}</span>
    </header>

    <form class="composer" onsubmit={onAdd}>
      <input bind:value={title} placeholder="New card title…" aria-label="New card title" />
      <button type="submit">Add card</button>
    </form>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <div class="board">
      {#each board.stages as stage (stage.key)}
        {@const cards = cardsIn(stage.key)}
        {@const overLimit = stage.wipLimit !== undefined && cards.length >= stage.wipLimit}
        <section
          class="column"
          role="list"
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => {
            e.preventDefault();
            void onDropCard(stage.key);
          }}
        >
          <div class="column-head">
            <span class="column-name">{stage.name}</span>
            <span class="count {overLimit ? 'full' : ''}">
              {cards.length}{stage.wipLimit !== undefined ? ` / ${stage.wipLimit}` : ''}
            </span>
            {#if stage.gate === 'approval'}
              <span class="gate" title="Approval gate">⛳</span>
            {/if}
          </div>
          <div class="cards">
            {#each cards as card (card.id)}
              <article class="card" draggable="true" ondragstart={() => (dragCardId = card.id)}>
                <div class="card-title">{card.title}</div>
                <div class="card-meta">{card.ownerUserId}</div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</main>
