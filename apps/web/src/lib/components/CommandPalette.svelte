<script lang="ts">
  import { app } from '$lib/stores/app.svelte';

  import { tick } from 'svelte';

  let inputEl = $state<HTMLInputElement | null>(null);

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') app.toggleCmdk();
  }

  $effect(() => {
    if (app.cmdkOpen) {
      void tick().then(() => inputEl?.focus());
    }
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if app.cmdkOpen}
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-black/60"
      onclick={() => app.toggleCmdk()}
      aria-label="Close command palette"
      tabindex="-1"
    ></button>

    <!-- Palette -->
    <div class="bg-surface border-border relative w-full max-w-lg rounded-[12px] border shadow-2xl">
      <div class="flex items-center gap-2 px-4 py-3">
        <svg class="size-4 shrink-0" style="color:var(--muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          bind:this={inputEl}
          type="text"
          placeholder="Jump to board, card, or command…"
          class="bg-transparent mono flex-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd class="mono border-border rounded-[4px] border px-1.5 py-0.5 text-[10px]" style="color:var(--muted)">esc</kbd>
      </div>
      <div class="border-border border-t px-2 py-2">
        <p class="mono px-2 py-4 text-center text-xs" style="color:var(--muted)">No results yet — more commands coming soon.</p>
      </div>
    </div>
  </div>
{/if}
