<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { renameBoard, setGithubConfig, getProfiles, createProfile, type BoardSnapshot, type Profile } from '$lib/api';

  let { open = false, board, onClose, onChanged }: { open?: boolean; board: BoardSnapshot; onClose: () => void; onChanged: () => void } = $props();

  let nameInput = $state('');
  let githubSecret = $state('');
  let issueTrigger = $state(false);
  let profiles = $state<Profile[]>([]);
  let pKey = $state('');
  let pModel = $state('');
  let busy = $state('');
  let seeded = $state(false);

  const webhookUrl = $derived(`${location.origin}/v1/boards/${board.boardId}/webhooks/github?tenant=${board.tenantId}`);

  $effect(() => {
    if (open && !seeded) {
      nameInput = board.name ?? '';
      issueTrigger = board.github.issueTrigger;
      void getProfiles(board.boardId!).then((p) => (profiles = p)).catch(() => (profiles = []));
      seeded = true;
    }
    if (!open) seeded = false;
  });

  async function saveName(): Promise<void> {
    if (nameInput.trim() === '' || nameInput.trim() === board.name) return;
    busy = 'name';
    await renameBoard(board.boardId!, nameInput.trim());
    busy = '';
    onChanged();
  }

  function genSecret(): void {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    githubSecret = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  async function saveGithub(): Promise<void> {
    busy = 'github';
    await setGithubConfig(board.boardId!, { issueTrigger, ...(githubSecret.trim() !== '' ? { secret: githubSecret.trim() } : {}) });
    githubSecret = '';
    busy = '';
    onChanged();
  }

  async function addProfile(): Promise<void> {
    if (pKey.trim() === '') return;
    busy = 'profile';
    const res = await createProfile(board.boardId!, { key: pKey.trim(), model: pModel.trim() || undefined });
    if (res.ok) {
      pKey = '';
      pModel = '';
      profiles = await getProfiles(board.boardId!);
    }
    busy = '';
  }
</script>

{#if open}
  <div class="fixed inset-0 z-40 flex items-center justify-center p-4">
    <button class="absolute inset-0 bg-black/55" onclick={onClose} aria-label="Close" tabindex="-1"></button>
    <div class="bg-surface border-border drawer-in relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-[12px] border shadow-2xl">
      <div class="border-border flex items-start justify-between gap-3 border-b p-5">
        <div>
          <div class="eyebrow mb-1">board settings</div>
          <h2 class="wordmark text-lg leading-snug">{board.name}</h2>
        </div>
        <button onclick={onClose} aria-label="Close" class="text-muted-foreground hover:text-foreground shrink-0">
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div class="flex-1 space-y-6 overflow-y-auto p-5">
        <!-- rename -->
        <section>
          <div class="eyebrow mb-2">name</div>
          <div class="flex gap-2">
            <input bind:value={nameInput} class="bg-inset border-border focus:border-marigold flex-1 rounded-[7px] border px-3 py-2 text-sm outline-none" />
            <Button size="sm" onclick={saveName} disabled={busy === 'name' || nameInput.trim() === '' || nameInput.trim() === board.name}>Rename</Button>
          </div>
        </section>

        <!-- github -->
        <section>
          <div class="eyebrow mb-2">github integration</div>
          <p class="text-muted-foreground mb-3 text-xs leading-relaxed">
            In your repo → <span class="text-foreground">Settings → Webhooks → Add webhook</span>: paste the Payload URL and the same Secret below (content type <span class="mono">application/json</span>). Then turn on the trigger to open a card for each new issue.
          </p>

          <div class="text-muted-foreground mono mb-1 text-[10px]">payload url</div>
          <div class="bg-inset border-border mono mb-3 flex items-center justify-between gap-2 overflow-hidden rounded-[7px] border px-2.5 py-1.5 text-[10px]">
            <span class="truncate">{webhookUrl}</span>
            <button onclick={() => navigator.clipboard?.writeText(webhookUrl)} class="shrink-0" style="color:var(--marigold)">copy</button>
          </div>

          <div class="text-muted-foreground mono mb-1 text-[10px]">
            secret{#if board.github.webhookConfigured}<span style="color:var(--live)"> · configured</span>{/if}
          </div>
          <div class="mb-3 flex gap-1.5">
            <input
              bind:value={githubSecret}
              placeholder={board.github.webhookConfigured ? 'generate or type a new secret to replace' : 'generate or paste a secret'}
              class="bg-inset border-border focus:border-marigold mono min-w-0 flex-1 rounded-[7px] border px-2.5 py-2 text-xs outline-none"
            />
            <Button size="sm" variant="outline" onclick={genSecret}>Generate</Button>
            <button onclick={() => navigator.clipboard?.writeText(githubSecret)} disabled={githubSecret === ''} title="Copy secret" class="shrink-0 px-1 text-xs disabled:opacity-40" style="color:var(--marigold)">copy</button>
          </div>
          <label class="flex select-none items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={issueTrigger} class="accent-marigold" />
            <span>Open a card for each new GitHub issue</span>
          </label>
          <div class="mt-3 flex justify-end"><Button size="sm" variant="outline" onclick={saveGithub} disabled={busy === 'github'}>Save GitHub settings</Button></div>
        </section>

        <!-- profiles -->
        <section>
          <div class="eyebrow mb-2">agent profiles</div>
          <p class="text-muted-foreground mb-2 text-xs leading-relaxed">Named run configs (model, etc.) an agent can claim with.</p>
          {#if profiles.length > 0}
            <div class="mb-2.5 space-y-1.5">
              {#each profiles as p (p.key)}
                <div class="bg-inset border-border mono flex items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5 text-[11px]">
                  <span>{p.key}</span>
                  <span class="text-muted-foreground">{p.model ?? '—'}</span>
                </div>
              {/each}
            </div>
          {/if}
          <div class="flex flex-wrap gap-1.5">
            <input bind:value={pKey} placeholder="key — e.g. opus-careful" class="bg-inset border-border focus:border-marigold mono min-w-0 flex-1 rounded-[6px] border px-2.5 py-1.5 text-xs outline-none" />
            <input bind:value={pModel} placeholder="model" class="bg-inset border-border focus:border-marigold mono min-w-0 flex-1 rounded-[6px] border px-2.5 py-1.5 text-xs outline-none" />
            <Button size="sm" variant="outline" onclick={addProfile} disabled={busy === 'profile' || pKey.trim() === ''}>Add</Button>
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}
