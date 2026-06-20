/**
 * @kaambaan/agent-sdk — a minimal, dependency-free client for the Kaambaan agent contract
 * (docs/04 §3). Any harness can use it to claim work and drive a run through the loop; it speaks
 * only the public REST surface. The HTTP `fetch` is injected so it runs anywhere (Workers, Node,
 * or a test runtime) without pulling in environment-specific types.
 */

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface AgentConfig {
  baseUrl: string;
  tenantId: string;
  boardId: string;
  agentId: string;
  capabilities: string[];
  maxConcurrency?: number;
  fetch: Fetcher;
}

export interface ClaimedWork {
  runId: string;
  leaseEpoch: number;
  card: { id: string; title: string; currentStageKey: string };
  stage: { key: string; name: string };
  handoff: unknown;
}

export interface AgentActivity {
  type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
  body?: string;
  action?: string;
  ephemeral?: boolean;
  signal?: string;
}

interface ClaimResponse {
  claimed: boolean;
  runId?: string;
  leaseEpoch?: number;
  card?: ClaimedWork['card'];
  stage?: ClaimedWork['stage'];
  handoff?: unknown;
}

/** A small client for the Kaambaan agent contract. One instance works one board as one agent. */
export class KaambaanAgent {
  constructor(private readonly config: AgentConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'X-Tenant-Id': this.config.tenantId, 'Content-Type': 'application/json', ...extra };
  }

  private post(path: string, body: unknown, extra: Record<string, string> = {}): Promise<HttpResponse> {
    return this.config.fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(extra),
      body: JSON.stringify(body),
    });
  }

  /** Claim the next ready card matching this agent, or null when none is available. */
  async claim(): Promise<ClaimedWork | null> {
    const res = await this.post(
      `/v1/boards/${this.config.boardId}/claims`,
      { capabilities: this.config.capabilities, maxConcurrency: this.config.maxConcurrency },
      { 'X-Agent-Id': this.config.agentId },
    );
    const body = (await res.json()) as ClaimResponse;
    if (!body.claimed || !body.runId || body.leaseEpoch === undefined || !body.card || !body.stage) {
      return null;
    }
    return {
      runId: body.runId,
      leaseEpoch: body.leaseEpoch,
      card: body.card,
      stage: body.stage,
      handoff: body.handoff ?? null,
    };
  }

  private run(work: ClaimedWork, action: string, extra: Record<string, unknown> = {}): Promise<HttpResponse> {
    return this.post(`/v1/boards/${this.config.boardId}/runs/${work.runId}/${action}`, {
      leaseEpoch: work.leaseEpoch,
      ...extra,
    });
  }

  heartbeat(work: ClaimedWork): Promise<HttpResponse> {
    return this.run(work, 'heartbeat');
  }
  activity(work: ClaimedWork, activity: AgentActivity): Promise<HttpResponse> {
    return this.run(work, 'activities', { ...activity });
  }
  complete(work: ClaimedWork, handoff?: unknown): Promise<HttpResponse> {
    return this.run(work, 'complete', { handoff });
  }
  block(work: ClaimedWork, reason: string): Promise<HttpResponse> {
    return this.run(work, 'block', { reason });
  }
  fail(work: ClaimedWork, reason: string): Promise<HttpResponse> {
    return this.run(work, 'fail', { reason });
  }
  release(work: ClaimedWork): Promise<HttpResponse> {
    return this.run(work, 'release');
  }
}

export type WorkHandler = (work: ClaimedWork, agent: KaambaanAgent) => Promise<unknown | void>;

/**
 * Reference driver: claim one card, acknowledge, run the work via `handler`, and complete it.
 * Returns true if a card was worked, false if there was nothing to claim. This is the loop a
 * real harness (Claude Code, Codex, …) wraps around its own execution.
 */
export async function runOnce(agent: KaambaanAgent, handler: WorkHandler): Promise<boolean> {
  const work = await agent.claim();
  if (!work) return false;
  await agent.heartbeat(work);
  await agent.activity(work, { type: 'thought', body: `working on "${work.card.title}"`, ephemeral: true });
  const handoff = await handler(work, agent);
  await agent.complete(work, handoff ?? undefined);
  return true;
}
