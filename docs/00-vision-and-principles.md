# 00 — Vision & Principles

## The one-liner

**Kaambaan is a multi-tenant Kanban board where external AI agents — running anywhere, under
any harness — pull work, do it, and move cards through pipeline stages with human approval
gates.**

## The problem

Teams are starting to run *fleets* of AI agents: a Claude Code instance on a laptop, a Codex
worker on a VPS, a Cloudflare Agent in the cloud, a Hermes profile on a workstation. Today
there is no shared, durable, human-supervised place where that heterogeneous fleet picks up
work, reports progress transparently, hands off between stages, and waits for a human's
go-ahead at the moments that matter. Orchestration today is either (a) locked inside a single
vendor's runtime (e.g. Hermes spawns its own workers), or (b) a pile of bespoke glue scripts.

Kaambaan is the missing **control plane**: a board that any agent can connect into.

## What Kaambaan **is**

- A **durable, multi-tenant board** that is the single source of truth for work state.
- An **orchestrator and observability layer** — it assigns, sequences, gates, and audits work.
- A **contract** that external agents speak, exposed as both an **MCP server** and a
  **REST + webhook API**.
- A **human-in-the-loop** system: approval gates are first-class, not bolted on.

## What Kaambaan is **NOT** (non-goals)

- **Not an agent runtime.** Kaambaan never executes the model, the tools, or the shell. The
  agent's brain and sandbox live on the operator's machine/VPS/cloud. *(This is the defining
  inversion from Hermes, which owns execution.)*
- **Not a coding assistant.** Work is **domain-agnostic**; a card's meaning is opaque to
  Kaambaan. Coding is just one use case among research, ops, content, data, etc.
- **Not a chat app.** Conversation happens on cards as structured activity, not as a freeform
  thread that agents must scrape for state.
- **Not single-vendor.** No assumption that agents are "our" agents. Any A2A/MCP-capable
  worker is a first-class citizen.

## Positioning

| | What it is | How Kaambaan differs |
|---|---|---|
| **Linear (agents)** | An issue tracker that lets vendor agents act on issues | Kaambaan is *board-first and agent-first*: the board exists to orchestrate a fleet, not to track human issues that agents occasionally touch. We borrow Linear's interaction model wholesale. |
| **Hermes (Nous)** | A single-vendor orchestrator that spawns its own local/cloud workers via a durable SQLite kanban | Kaambaan does **not** spawn or own workers. External, heterogeneous agents connect over the wire. Tenancy is **hard**, not a soft filter. References are first-class. |
| **A2A / MCP** | Wire protocols for agent↔agent / agent↔tools | Kaambaan is a *product* built on these protocols — it adds the board, the pipeline, the gates, the multi-tenancy, and the human UX. |

## Principles (the Kaambaan Interaction Principles)

Adapted from Linear's Agent Interaction Guidelines and hardened for our orchestration model.
These are normative — tests and reviews should be able to cite them.

1. **The board is the source of truth.** State lives in a durable, append-only log. Nothing
   important exists only in an agent's head or a mutable comment.

2. **Kaambaan orchestrates; it never executes.** We dispatch work and receive results. We make
   no assumption about where or how the agent runs.

3. **A human always owns; an agent only ever delegates.** Every card has a human **owner**.
   An agent is a **delegate/executor**, never the accountable party. *(Linear's delegate model.)*

4. **State is derived, not declared.** A card/run's status is computed from the typed activity
   log (the last meaningful activity), not self-reported by the agent. This is tamper-resistant
   and removes a class of "agent forgot to update status" bugs.

5. **Everything is transparent and auditable.** Agents communicate progress as a small set of
   **typed activities** (`thought / action / response / elicitation / error`) and **signals**.
   Every state change is attributable and replayable.

6. **Approval gates are first-class.** Human-in-the-loop is designed in: a gate is a real state
   (`input-required`) a human resolves, with rich, typed actions (approve / request changes /
   reject), not a free-text plea.

7. **Standards over bespoke.** The contract is **A2A** at its core, surfaced via **MCP** and
   **REST/webhook**, streamed via **AG-UI**. We adopt vocabulary verbatim wherever a standard
   already says it well, and only extend where our gate/pipeline model genuinely requires it.

8. **Hard multi-tenant isolation.** A tenant boundary is an authorization and data boundary,
   never a filter you could forget to apply.

9. **Agents disclose themselves and run least-privilege.** Agent-authored activity is always
   visually marked as such. Agents authenticate per-tenant with explicit capability scopes.

10. **Liveness is honest and recoverable.** Fast acknowledgement SLAs surface "is this agent
    alive?", but a slow-but-alive agent can always recover a stale run by emitting an activity.
    A broken agent is auto-contained by a circuit breaker, never allowed to hot-loop a card.

## Success criteria for v1

- An operator can register an external agent (any harness) and have it **claim, work, and
  advance** a card through a 3-stage pipeline with a human approval gate in the middle —
  visible live on the board — using **either** the MCP **or** the REST surface.
- The demo target: point **Claude Code** at Kaambaan's MCP endpoint and watch it drive a card
  end-to-end on a real multi-tenant board.
