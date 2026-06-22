# 11 — Prior Art & Market Scan

The competitive and standards landscape Kaambaan draws on, and where the whitespace is. This is the
"why our design is what it is" doc — every major decision in specs 00–10 traces to a learning here.

## 1. The landscape

| Category | Representatives | What we took |
|---|---|---|
| **Issue trackers + agents** | **Linear** (agent platform), Jira agents | Delegate-not-owner accountability; Agent Sessions; typed activity log that *derives* state; signals (`stop/auth/select`); idempotent external-link attachments; ack/stale SLAs |
| **Kanban-for-agents** | **Hermes** (Nous), **Vibe Kanban** (Bloop) | Durable board as source of truth; structured stage handoff; runs/attempts history; heartbeat + stale reclaim; circuit breaker; the **Attempt** object; a **harness-abstraction interface**; normalized typed events |
| **Parallel-agent runners** | Conductor, Claude Squad, Crystal/Nimbalyst, Sculptor (Imbue) | "Workspace = unit of delegation; branch+PR = unit of integration"; container/VM isolation > worktree for remote agents; clearest **status taxonomy** incl. "Needs your input"; comment-→-follow-up |
| **Autonomous SWE** | **Devin** (Cognition), **Factory** (Droids), Cursor cloud agents, **GitHub Copilot agent**, OpenHands, Sweep | Usage accounting (ACU/credits/budgets, pre-run cost estimate); **autonomy levels** + allow/deny/blocklist; draft-PR-as-work-surface; **never approve your own PR**; multiple inbound triggers → one task path; firewall/allowlist |
| **Multi-agent frameworks** | CrewAI, OpenAI Agents SDK (+Swarm), AutoGen, Semantic Kernel, LlamaIndex, Google ADK | Two routing archetypes (**predefined pipeline** default vs **manager** opt-in); explicit **typed context-passing** over broadcast history; handoff = named edge + event; guardrails/termination = halt semantics |
| **Human-in-the-loop** | **HumanLayer**, **MCP elicitation**, **LangGraph** interrupts, n8n/Trigger.dev/Inngest waits | `accept/decline/cancel/edit` tri-state-plus; structured options with `promptFill`; escalation/quorum/channels; resume-token; the "code-before-the-wait re-runs → idempotency" hazard |
| **Durable execution** | **Temporal**, Trigger.dev, Inngest, **Cloudflare Workflows + DO alarms** | Activity **heartbeat + reclaim** with **fencing**; the four timeouts; retry policy; at-least-once idempotency keys; signals/`waitForEvent` as durable human-waits |
| **Agent observability** | OTel-GenAI, OpenInference, Langfuse, AgentOps, Helicone | Trace→span→event; **session = card-run** grouping; span-kind enum; input/output token naming; **first-class cost**; `tenant_id` everywhere; session-replay timeline |
| **Wire protocols** | **A2A**, **MCP**, **AG-UI**, **ACP** | A2A `Task`/state-machine spine; MCP tool surface; AG-UI streaming to UI; ACP as a native harness transport |

## 2. Cross-cutting learnings (the big ones)

1. **Steal the "Attempt".** A task owns N immutable attempts, each pinned to `(agent, model,
   profile, base ref, prompt)`; rejection spawns a new attempt; attempts are comparable side-by-side.
   Vibe Kanban's single best idea ([03](./03-card-lifecycle.md), [07](./07-realtime-and-ui.md)).
2. **One harness-abstraction interface, over the wire.** `start / followUp / applyProfile /
   normalizeEvents / capabilities / availability` — the remote analog of Vibe Kanban's executor
   trait; ACP is already spoken by 3 CLIs ([05](./05-integration-surfaces.md)).
3. **Normalize agent output into a typed envelope**, not raw logs — this is what keeps the board
   **domain-agnostic** ([05 §1](./05-integration-surfaces.md)).
4. **Derive state from an immutable typed log** (Linear) — never trust self-reported status.
5. **Heartbeat + fenced reclaim** (Temporal) is the right liveness model for remote agents
   ([08](./08-reliability-and-durable-execution.md)).
6. **Gates: `accept/decline/cancel/edit` + structured options + escalation**, with
   **separation-of-duties** ([08 §6](./08-reliability-and-durable-execution.md)).
7. **Two-tier gates**: soft review column *and* hard policy gate; action-level autonomy lives in the
   profile (Factory).
8. **Remote = eventual truth** → a **reconciliation loop**, not fire-and-forget, for external state
   ([06](./06-external-references.md)).
9. **Many inbound triggers, one task path** (Devin/Factory/Cursor/Copilot convergence).
10. **Own cost/observability** — it's a near-universal gap in the parallel-runner tools and a real
    differentiator ([07 §6](./07-realtime-and-ui.md)).

## 3. What we deliberately do NOT copy

| Anti-pattern | Seen in | Our choice |
|---|---|---|
| Spawning our own workers / owning execution | Hermes | We **never execute**; external agents over the wire |
| Soft tenancy (a filter field) | Hermes | **Hard** isolation at auth + data boundary |
| URLs stuffed in comment text | Hermes | **First-class** typed references with sync |
| Coding-only, git-diff/branch/PR baked into the core | Vibe Kanban, Conductor, Sweep, Copilot | **Domain-agnostic** task/event/artifact model; git is one provider |
| Single-user / single-machine | every parallel-runner | **Multi-tenant**, team-first |
| Soft "review column" as the only gate | Vibe Kanban | Soft column **and** hard policy gates |
| State derived from nullable fields | HumanLayer | **Explicit** A2A-aligned state machine |
| Pure issue→PR bot | Sweep (pivoted away) | A board/pipeline control plane, not a bot |

## 4. Strategic whitespace

The market splits cleanly:
- **Issue-trackers + agents** (Linear) — human-issue-first; agents are guests.
- **Single-vendor orchestrators** (Hermes) — own the runtime; soft tenancy.
- **Local single-user runners** (Vibe Kanban *— company sunsetting*, Conductor, Claude Squad,
  Crystal, Sculptor) — your machine, your worktrees, coding-only.
- **Autonomous SWE SaaS** (Devin, Factory, Copilot agent) — powerful, but single-org and
  coding-centric, without heterogeneous-external-agent pipelines.

**No one occupies the union Kaambaan targets:**

> **multi-tenant · harness-agnostic · domain-agnostic · pipeline with real human gates · over
> external agents that run anywhere.**

That union is the moat. Two market signals reinforce the opening: **Vibe Kanban (the closest analog)
is being sunset**, and **Sweep (the canonical issue→PR bot) pivoted away entirely** — the pure-bot
and local-runner shapes did not become durable standalone products. The defensible shape is the
**control plane**.

## 5. Differentiators to protect

- **Domain-agnostic by construction** — keep task/event/artifact generic; resist git-specific
  shortcuts in review/gates. This is the moat; every competitor hard-codes "diff + branch + PR".
- **Any harness, anywhere** — the wire contract (A2A spine, MCP + REST + ACP) and the conformance kit
  are the product surface, not an add-on.
- **Real, policy-driven, auditable gates** with separation-of-duties — multi-tenant HITL nobody
  local-first ships.
- **Cost/observability as a first-class, per-tenant feature** — fills the field's biggest gap.

## 6. 2026 landscape refresh (June 2026)

Re-scanned post-v0.0.1. The design-time scan above still holds — every §1–§5 learning survived —
but the field moved fast. The deltas that matter:

**Status changes.**

| Tool | Change |
|---|---|
| **Vibe Kanban** (Bloop) | Company **sunset 2026-04-10**; repo continues community-maintained (Apache-2.0). Confirms §4's "closest analog is being sunset." |
| **Height** | **Shut down 2025-09-24.** |
| **Tegon** | **Archived 2025-06** (team → CORE). Its omni-channel **Triage inbox** is the best single UX idea still worth lifting. |
| **Crystal** | → **Nimbalyst** (renamed/succeeded). |
| **AutoGen** | **Maintenance mode**; superseded by **Microsoft Agent Framework** (GA 2026-04). |
| **ACP** (IBM/BeeAI) | **Merged into A2A (2025-09) — dead.** Our "ACP as a native transport" note in [05](./05-integration-surfaces.md) collapses to A2A. |

**New entrants worth tracking** — none existed at design time:

| Tool | What it is | Closest-to-us signal |
|---|---|---|
| **Multica** (Apache-2.0, 37k★) | Agent-first Kanban; assign issues to agents; Squads + Skills; multi-runtime | The closest OSS **board** analog |
| **Preloop** (Apache-2.0) | Agent **control plane**: MCP firewall, model gateway, async approvals, audit | The closest **control-plane/governance** analog |
| **agent-kanban** (saltbo) | Board with **Ed25519-signed cards/PRs**, dep cycles, auto-complete-on-merge | Crypto agent identity for untrusted runtimes |
| **Hermes Kanban** (Nous, MIT) | Shared `kanban.db`; dispatcher claims `ready` → worker; `complete`/`block` verbs | Verb model nearly identical to ours |
| **GitHub Agent HQ + Mission Control** | Multi-vendor agent command center (GA 2026-06) | The competitor-shaped supervise-a-fleet UX bar |
| **Plane** (AGPL-3.0, 52k★) | OSS Linear alt: agents-as-assignees, triage agents, native MCP | Nearest OSS feature-map to our premise |
| **Intent** (Augment), **Cline Kanban**, **Composio AO**, **Factory** | Plan→approve→verify flows, dependency-chained cards, ticket-as-unit | Gated-pipeline patterns ([13 §6](./13-linear-parity-program.md)) |

**The whitespace still holds.** Even with Multica, Preloop, and Plane, no one occupies the full
union from §4: Multica is a board but **orchestrates runtimes it half-owns**; Preloop is a
**governance plane, not a board/pipeline**; Plane is **human-issue-first**. *Multi-tenant ·
harness-agnostic · domain-agnostic · real human gates · external agents anywhere* remains
unoccupied — the competition **validates** the shape rather than taking it.

**Protocol bets validated.** **A2A v1.0** (Linux Foundation) + **MCP** + **AG-UI** went mainstream
in 2026 — CrewAI, Microsoft Agent Framework, Google ADK, and LangGraph all speak A2A + MCP; OpenAI
is the lone A2A holdout; **ACP is dead**. This confirms the A2A-spine + MCP-dispatch bet
([00](./00-vision-and-principles.md) Principle 7); **AG-UI** is the natural addition for the
HITL/UI streaming layer. The concrete, transferable patterns this scan surfaced are catalogued in
[13 — Linear Parity Program §6](./13-linear-parity-program.md).

*(Sources for this refresh: live web scan, June 2026 — the repos, changelogs, and announcements of
the tools named above.)*

## 7. Sources

Captured in team memory `kaambaan-research-sources`. Primary: Linear developer docs, Hermes docs,
Vibe Kanban (BloopAI), Conductor/Claude Squad/Crystal/Sculptor, Devin & Factory docs, GitHub Copilot
coding-agent docs, CrewAI / OpenAI Agents SDK / AutoGen / Semantic Kernel / ADK, HumanLayer &
12-factor-agents, MCP & LangGraph & Temporal & Cloudflare Workflows docs, OTel-GenAI / OpenInference
/ Langfuse / AgentOps, and the A2A / MCP / AG-UI / ACP specs.
