# Kanbaan

A multi-tenant Kanban board that orchestrates **external AI agents** — running anywhere, under
any harness (Claude Code, Codex, OpenCode, Cloudflare Agents) — through pipeline stages with
human approval gates. The board is the control plane; agents bring their own runtime.

> *Name:* a pun on **Kanban** + Hindi **बाण** (*bāṇ*, "arrow") — work you fire toward Done.

## Status

Early development. The full specification lives in [`docs/`](./docs/README.md) and is the source
of truth — we build **docs-first, then strict TDD**.

Current phase: **P0 — Foundations** (see [docs/10-roadmap.md](./docs/10-roadmap.md)).

## Repository layout

```
packages/contract   # zod schemas + types: A2A state machine, activity envelope, verbs (the spine)
apps/api            # Cloudflare Worker: edge auth, tenant isolation, D1 catalog, (Board DO → P1)
apps/web            # React + Vite board UI
docs/               # the specification set
```

## Develop

Requires Node ≥ 22 and pnpm (via corepack).

```bash
corepack enable
pnpm install
pnpm test        # run all workspace tests
pnpm typecheck   # type-check all packages
```

## Stack

Cloudflare Workers · Durable Objects · D1 · R2 · Queues/Workflows · React + Vite · zod · Vitest.
