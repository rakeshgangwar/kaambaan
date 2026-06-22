<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import type { BoardSnapshot } from '$lib/api';

  // ---- helpers ----
  function stageLabel(key: string): string {
    return app.board?.stages.find((s) => s.key === key)?.name ?? key;
  }

  function gateFor(cardId: string): BoardSnapshot['gates'][number] | undefined {
    return app.board?.gates.find((g) => g.cardId === cardId);
  }

  function refsFor(cardId: string): BoardSnapshot['references'] {
    return app.board ? app.board.references.filter((r) => r.cardId === cardId) : [];
  }

  function fmtUsd(n: number): string {
    return `$${n.toFixed(2)}`;
  }

  // ---- grouped list ----
  const listGroups = $derived.by(() => {
    const board = app.board;
    if (!board) return [] as Array<{ key: string; label: string; cards: BoardSnapshot['cards'] }>;
    const cards = app.filteredCards();
    let groups: Array<{ key: string; label: string; cards: BoardSnapshot['cards'] }>;
    if (app.listGroupBy === 'stage') {
      groups = board.stages.map((s) => ({
        key: s.key,
        label: s.name,
        cards: cards.filter((c) => c.currentStageKey === s.key),
      }));
    } else {
      const keyOf = (c: BoardSnapshot['cards'][number]) =>
        app.listGroupBy === 'state'
          ? c.state
          : app.listGroupBy === 'owner'
            ? c.ownerUserId
            : `P${c.priority}`;
      const keys = [...new Set(cards.map(keyOf))].sort();
      groups = keys.map((k) => ({ key: k, label: k, cards: cards.filter((c) => keyOf(c) === k) }));
    }
    return groups.filter((g) => g.cards.length > 0);
  });
</script>

<div class="pb-10">
  {#if listGroups.length === 0}
    <p class="text-muted-foreground mono py-16 text-center text-sm">No cards match these filters.</p>
  {:else}
    {#each listGroups as group (group.key)}
      <div class="mb-5">
        <div class="border-border/60 mb-1 flex items-center gap-2 border-b pb-1.5 px-4">
          <span class="wordmark text-[13px] tracking-wide">{group.label}</span>
          <span class="mono text-muted-foreground text-xs">{group.cards.length}</span>
        </div>
        {#each group.cards as card (card.id)}
          {@const gate = gateFor(card.id)}
          <button
            onclick={() => app.openCard(card.id)}
            class="border-border/40 hover:bg-inset/60 flex w-full items-center gap-3 border-b py-2.5 pr-4 pl-6 text-left {gate
              ? 'tile-gate'
              : ''}"
          >
            <span class="mono text-muted-foreground w-7 shrink-0 text-[11px]">{card.priority > 0 ? `P${card.priority}` : ''}</span>
            <span class="flex-1 truncate text-sm">{card.title}</span>
            {#if card.state === 'working'}
              <span class="live-dot shrink-0" title="Agent working"></span>
            {/if}
            {#if gate}
              <span class="eyebrow text-coral shrink-0">review</span>
            {/if}
            {#if refsFor(card.id).length > 0}
              <span class="mono hidden shrink-0 text-[10px] sm:inline" style="color:var(--marigold)">↗{refsFor(card.id).length}</span>
            {/if}
            {#if app.listGroupBy !== 'state'}
              <span class="mono text-muted-foreground hidden w-20 shrink-0 truncate text-right text-[11px] md:block">{card.state}</span>
            {/if}
            <span class="mono text-muted-foreground hidden w-24 shrink-0 truncate text-[11px] sm:block">{card.ownerUserId}</span>
            {#if app.listGroupBy !== 'stage'}
              <span class="border-border mono hidden shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[10px] lg:inline">{stageLabel(card.currentStageKey)}</span>
            {/if}
            <span class="mono w-14 shrink-0 text-right text-[11px] {card.overBudget ? 'text-coral' : 'text-muted-foreground'}">{card.costUsd > 0 ? fmtUsd(card.costUsd) : ''}</span>
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</div>
