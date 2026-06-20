# Kaambaan — Documentation

> **Kaambaan** is a multi-tenant Kanban board that orchestrates **external AI agents**.
> The board is the control plane; the agents bring their own runtime. Work flows
> through pipeline stages with human approval gates.
>
> *Name:* **काम** (*kaam*, "work") + **बाण** (*bāṇ*, "arrow") — the arrows of work you fire
> toward Done; also a nod to **Kanban**. Pronounced ~"kaam-baan".

These documents are the **source of truth**. We are **docs-first, then strict TDD**:
every behavioral statement here should become an executable test before its code exists.
Where a decision is still open, it is flagged inline with **⚠️ OPEN** so we can resolve it
deliberately rather than by accident.

## Reading order

| # | Doc | What it answers | Status |
|---|-----|-----------------|--------|
| 00 | [Vision & Principles](./00-vision-and-principles.md) | Why Kaambaan exists, what it is and isn't, the rules it holds itself to | ✅ Draft |
| 01 | [Domain Model & Glossary](./01-domain-model-and-glossary.md) | The nouns: Tenant, Board, Card, Task, Run, Agent, Activity, Signal, Reference | ✅ Draft |
| 02 | [Architecture](./02-architecture.md) | The Cloudflare topology, multi-tenancy, auth, data flow | ✅ Draft |
| 03 | [Card Lifecycle & Pipeline](./03-card-lifecycle.md) | The A2A-aligned state machine, stages, gates, handoff, rework | ✅ Draft |
| 04 | [Agent Contract](./04-agent-contract.md) | The verbs, identity, activities, signals, SLAs, idempotency | ✅ Draft |
| 05 | [Integration Surfaces](./05-integration-surfaces.md) | MCP + REST + webhooks over one contract; harness adapters (Claude Code/Codex/OpenCode/CF Agents/ACP); inbound triggers | ✅ Draft |
| 06 | [External References](./06-external-references.md) | Linking GitHub issues/PRs, repos, docs; draft-PR sub-state; webhook + GraphQL reconciliation | ✅ Draft |
| 07 | [Realtime & UI](./07-realtime-and-ui.md) | WebSocket board, AG-UI adapters, observability vocabulary, status taxonomy, attempts, cost/metering | ✅ Draft |
| 08 | [Reliability & Durable Execution](./08-reliability-and-durable-execution.md) | Temporal-style heartbeat + fenced reclaim on DO alarms; the four timeouts; idempotency; gates as durable waits | ✅ Draft |
| 09 | [Testing Strategy (TDD)](./09-testing-strategy.md) | The TDD loop, test pyramid, DO/alarm/Workflow testing, required suites, the agent conformance kit | ✅ Draft |
| 10 | [Roadmap](./10-roadmap.md) | Phased delivery P0→P7; the P4 demo milestone | ✅ Draft |
| 11 | [Prior Art & Market Scan](./11-prior-art-and-market-scan.md) | The landscape, cross-cutting learnings, what we avoid, the strategic whitespace | ✅ Draft |

## The one-paragraph design

Kaambaan's contract is anchored on the **A2A protocol** (Linux Foundation) — its `Task`
object and state machine model "dispatch long-running work to a remote agent, stream
artifacts, pause for human input." On top of that spine we layer **Linear's** accountability
and UX model (delegate-not-owner, an append-only typed activity log that *derives* state,
signals for human-in-the-loop) and **Hermes's** operational semantics (durable board,
structured stage handoff, heartbeats, stale-reclaim, circuit breaker). The same contract is
exposed two ways — an **MCP server** (for Claude Code / Codex / OpenCode / Cursor) and a
**REST + webhook API** (for any service) — and live activity streams to the board via
**AG-UI** adapters. External resources (GitHub issues/PRs, repos, docs) are first-class
**references**. Everything is **hard multi-tenant**.

## Prior art credits

Design ideas adapted from [Linear's agent platform](https://linear.app/developers/aig),
[Nous Research's Hermes kanban](https://hermes-agent.nousresearch.com/docs/), the
[A2A protocol](https://a2a-protocol.org), [MCP](https://modelcontextprotocol.io), and
[AG-UI](https://docs.ag-ui.com). See the team memory `kaambaan-research-sources` for the
full reference list.
