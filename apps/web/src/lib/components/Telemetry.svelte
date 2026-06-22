<script lang="ts">
  import { onMount } from 'svelte';
  import { getUsage, type UsageSummary } from '$lib/api';
  import { app } from '$lib/stores/app.svelte';
  import { agentColor, initialOf } from '$lib/components/agentColor';

  // ---- reactive data ----
  let usage = $state<UsageSummary | null>(null);
  let loading = $state(false);
  let window_ = $state<'5h' | '7d'>('7d');

  // ---- derived from store ----
  const board = $derived(app.board);
  const agents = $derived(app.agents);
  const boardId = $derived(app.boardId);

  // budget metrics from board snapshot
  const totalCost = $derived(board?.usage.totalCostUsd ?? 0);
  const budgetUsd = $derived(board?.usage.budgetUsd ?? null);
  const overBudget = $derived(board?.usage.overBudget ?? false);
  const burnPct = $derived(
    budgetUsd && budgetUsd > 0 ? Math.min(100, Math.round((totalCost / budgetUsd) * 100)) : 0,
  );

  // token totals from usage report
  const totalInput = $derived(usage?.totalInputTokens ?? 0);
  const totalOutput = $derived(usage?.totalOutputTokens ?? 0);
  const totalTokens = $derived(totalInput + totalOutput);

  // card count from board
  const cardCount = $derived(board?.cards.length ?? 0);
  const avgCostPerCard = $derived(cardCount > 0 ? totalCost / cardCount : 0);

  // helper: agent name from id
  function agentName(id: string): string {
    return agents.find((a) => a.id === id)?.name ?? id;
  }

  // helper: card title from id
  function cardTitle(id: string): string {
    return board?.cards.find((c) => c.id === id)?.title ?? id;
  }

  // helper: format USD
  function usd(n: number): string {
    return '$' + n.toFixed(2);
  }

  // helper: format token count
  function fmtK(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }

  // max cost for bar scaling
  const maxAgentCost = $derived(
    usage?.byAgent.length ? Math.max(...usage.byAgent.map((a) => a.costUsd), 0.001) : 0.001,
  );
  const maxModelCost = $derived(
    usage?.byModel.length ? Math.max(...usage.byModel.map((m) => m.costUsd), 0.001) : 0.001,
  );
  const maxCardCost = $derived(
    usage?.byCard.length ? Math.max(...usage.byCard.map((c) => c.costUsd), 0.001) : 0.001,
  );

  // ---- fetch ----
  async function load(id: string, win: '5h' | '7d') {
    loading = true;
    try {
      usage = await getUsage(id, win);
    } catch {
      // getUsage already returns empty summary on failure
      usage = null;
    } finally {
      loading = false;
    }
  }

  // re-fetch whenever boardId or window changes
  $effect(() => {
    if (boardId) load(boardId, window_);
  });

  onMount(() => {
    if (boardId) load(boardId, window_);
  });
</script>

<div class="tele-pad scroll flex-1 overflow-y-auto">
  <!-- header row -->
  <div class="mb-4 flex items-end justify-between gap-4 flex-wrap">
    <div>
      <div class="eyebrow mb-1">telemetry</div>
      <h1 class="wordmark text-xl">Agent telemetry</h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {board?.name ?? 'Board'} · last
        <button
          class="mono text-xs underline underline-offset-2 hover:text-foreground transition"
          onclick={() => { window_ = window_ === '7d' ? '5h' : '7d'; }}
        >
          {window_ === '7d' ? '7 days' : '5 hours'}
        </button>
        {#if loading}<span class="mono text-muted-foreground text-xs ml-2">loading…</span>{/if}
      </p>
    </div>
  </div>

  <!-- ===== metric cards ===== -->
  <div class="tele-grid">
    <!-- Spend / budget -->
    <div class="tele-metric">
      <div class="tele-metric-k">Spend / budget</div>
      <div class="tele-metric-v" class:text-coral={overBudget}>
        {usd(totalCost)}
        {#if budgetUsd}<small class="text-muted-foreground font-medium text-sm">/ {usd(budgetUsd)}</small>{/if}
      </div>
      {#if budgetUsd}
        <div class="tele-burn" class:tele-burn-over={overBudget}>
          <i style="width:{burnPct}%"></i>
        </div>
        <div class="mono mt-1 text-[10px] {overBudget ? 'text-coral' : 'text-muted-foreground'}">
          {burnPct}% of budget used{overBudget ? ' · over budget' : ''}
        </div>
      {:else}
        <div class="mono text-muted-foreground mt-1 text-[10px]">no budget cap set</div>
      {/if}
    </div>

    <!-- Avg cost / card -->
    <div class="tele-metric">
      <div class="tele-metric-k">Avg cost / card</div>
      <div class="tele-metric-v">{usd(avgCostPerCard)}</div>
      <div class="mono text-muted-foreground mt-1 text-[10px]">{cardCount} cards tracked</div>
    </div>

    <!-- Total tokens -->
    <div class="tele-metric">
      <div class="tele-metric-k">Total tokens</div>
      <div class="tele-metric-v">{fmtK(totalTokens)}</div>
      <div class="mono text-muted-foreground mt-1 text-[10px]">
        in {fmtK(totalInput)} · out {fmtK(totalOutput)}
      </div>
    </div>

    <!-- Unpriced records -->
    <div class="tele-metric">
      <div class="tele-metric-k">Unpriced records</div>
      <div class="tele-metric-v">{usage?.unpricedRecords ?? 0}</div>
      <div class="mono text-muted-foreground mt-1 text-[10px]">records without cost data</div>
    </div>
  </div>

  <!-- ===== two-column panels ===== -->
  <div class="tele-two">
    <!-- By agent -->
    <div class="tele-panel">
      <div class="tele-panel-h">By agent</div>
      {#if usage?.byAgent.length}
        <div class="tele-bars">
          {#each usage.byAgent as row (row.agentId)}
            {@const name = agentName(row.agentId)}
            {@const color = agentColor(row.agentId)}
            {@const pct = Math.round((row.costUsd / maxAgentCost) * 100)}
            <div class="tele-barrow">
              <span class="flex items-center gap-1.5 truncate">
                <span
                  class="tele-av flex-none"
                  style="background:{color};color:#0f1118"
                  title={name}
                >{initialOf(name)}</span>
                <span class="truncate text-xs">{name}</span>
              </span>
              <span class="tele-track"><i style="width:{pct}%;background:{color}"></i></span>
              <span class="tele-num">{usd(row.costUsd)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="tele-empty">No agent cost data yet.</p>
      {/if}
    </div>

    <!-- By model -->
    <div class="tele-panel">
      <div class="tele-panel-h">By model</div>
      {#if usage?.byModel.length}
        <div class="tele-bars">
          {#each usage.byModel as row (row.model)}
            {@const pct = Math.round((row.costUsd / maxModelCost) * 100)}
            <div class="tele-barrow">
              <span class="mono truncate text-xs">{row.model}</span>
              <span class="tele-track"><i style="width:{pct}%"></i></span>
              <span class="tele-num">{usd(row.costUsd)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="tele-empty">No model cost data yet.</p>
      {/if}
    </div>
  </div>

  <!-- By card (full width) -->
  <div class="tele-panel mt-3">
    <div class="tele-panel-h">Top spenders · by card</div>
    {#if usage?.byCard.length}
      <div class="tele-bars">
        {#each usage.byCard.slice(0, 8) as row (row.cardId)}
          {@const title = cardTitle(row.cardId)}
          {@const pct = Math.round((row.costUsd / maxCardCost) * 100)}
          <div class="tele-barrow tele-barrow-wide">
            <span class="truncate text-xs">{title}</span>
            <span class="tele-track"><i style="width:{pct}%"></i></span>
            <span class="tele-num">{usd(row.costUsd)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="tele-empty">No card cost data yet.</p>
    {/if}
  </div>

  <!-- Tier 2 note -->
  <p class="eyebrow mt-5 leading-relaxed">
    success rate · time-in-stage · throughput · gate-rejection — coming with the telemetry aggregation (Tier 2)
  </p>
</div>
