# 06 — External References

Cards link to the outside world: GitHub issues/PRs, repositories, docs, and arbitrary URLs.
References are **first-class** (the thing Hermes got wrong by stuffing URLs into comment text)
and **kept in sync** with their source. The model is adapted from Linear's idempotent
attachments; the GitHub sync from GitHub's REST/GraphQL + webhooks.

## 1. The Reference model

```jsonc
{
  "id": "ref_…",
  "cardId": "card_…", "tenantId": "…",
  "url": "https://github.com/org/repo/pull/42",   // DEDUP KEY within a card
  "title": "Add OAuth login", "subtitle": "#42 · draft",
  "provider": "github | gitlab | docs | url | …",
  "sourceType": "issue | pull_request | repo | branch | commit | doc | url",
  "externalId": "PR_kwDOA…",                       // durable id (GitHub node_id / owner/repo#n)
  "metadata": { "state": "open", "draft": true, "merged": false,
                "headRef": "copilot/oauth", "baseRef": "main", "labels": [...] },
  "syncState": "synced | stale | error",
  "lastSyncedAt": "2026-06-20T…Z",
  "addedBy": "agent | user", "createdAt": "…"
}
```

- **Idempotent upsert keyed on `(cardId, url)`** — re-adding the same url updates the existing
  reference instead of duplicating (Linear's rule). This is what `addReference`
  ([04 §3](./04-agent-contract.md)) and `PUT /v1/cards/:id/references` ([05](./05-integration-surfaces.md))
  guarantee.
- Recognized URL shapes (GitHub PR/issue, repo) get **richer rendering and gating** (§4); a bare
  url is still a valid, generic reference (domain-agnostic — references aren't git-specific).

### Implementation (P5)

References live in the Board DO (`card_references`, `UNIQUE(card_id, url)`), surfaced in the board
snapshot + live feed. `addReference` is an idempotent upsert (`apps/api/src/board/board-do.ts`).

- **Surfaces**: `PUT /v1/boards/:boardId/cards/:cardId/references` (REST) and the MCP
  `kaambaan_add_reference` tool — both call `resolveReferenceInput`, which **auto-recognizes**
  GitHub PR/issue/repo/commit URLs into `provider`/`sourceType`/`externalId`
  (`apps/api/src/references/`), so a caller can pass just a url. The board UI renders each as a
  chip linking out.
- The card-centric REST path from §3 (`PUT /v1/cards/:id/references`) is realized board-scoped for
  now (the DO is keyed by tenant+board); a global card→board index lands with webhooks.
- **⚠️ Deferred to P5.2**: GitHub webhook ingestion (HMAC `X-Hub-Signature-256` verify + delivery
  dedup + a global reference→board routing index), the **draft-PR sub-state machine** (§2), the
  **GraphQL reconciliation Workflow** (§3, the three correctness traps), and **reference-based gate
  conditions** (§4). The reference model here is their prerequisite.

## 2. GitHub: linking & the draft-PR sub-state machine

When an agent works a coding card, the **GitHub draft PR is the agent's work surface** — its
lifecycle drives a *sub-state* shown on the card (it does **not** replace the canonical A2A
state in [03](./03-card-lifecycle.md); it enriches it):

| GitHub signal | Card sub-state |
|---|---|
| issue `assigned` (+ 👀 reaction from an agent) | Agent working |
| `pull_request` `opened` (`draft:true`) | Draft PR open |
| repeated `pull_request` `synchronize` | Agent iterating |
| `pull_request` `ready_for_review` | **Awaiting review** — *always a human action* → a natural approval-gate trigger |
| `pull_request` `closed` + `merged:true` | Done |
| session/agent exits without a PR | Failed / timed-out |

> **Separation of duties** ([08](./08-reliability-and-durable-execution.md)): like GitHub barring
> Copilot from approving its own PR, the identity that produced an attempt **cannot** satisfy its
> own approval gate. We record the human approver on the reference's `metadata`.

## 3. Sync: webhooks + GraphQL reconciliation (never text-parse)

Because our agents are **remote**, we only ever have **eventual, polled truth** about external
state. Two complementary mechanisms:

**(a) Inbound webhooks** — fast updates. Verify `X-Hub-Signature-256` (HMAC-SHA256 over the raw
body); dedup on `X-GitHub-Delivery`. Subscribe to:
- `pull_request`: `opened`, `edited`, `ready_for_review`, `converted_to_draft`, `synchronize`,
  `closed` (check `merged`), `reopened`
- `issues`: `assigned`, `closed`, `reopened`, `edited`
- `pull_request_review`, `pull_request_review_comment`, `issue_comment` (catch human feedback +
  `@`-mention iteration)

**(b) GraphQL reconciliation loop** — a periodic **Workflow** (cron) re-fetches authoritative link
state for active cards, so a missed/late webhook can't leave a card wrong. Use:
- PR → issues: **`closingIssuesReferences`**
- issue → PRs: **`closedByPullRequestsReferences(includeClosedPrs: true)`**

This reconciliation worker is also where `syncState` flips `stale → synced` / `error`.

### ⚠️ Three correctness traps (each becomes a test in [09](./09-testing-strategy.md))

1. **Closing keywords (`Fixes #123`) only link when the PR targets the repo's *default* branch.**
   Verify `base.ref` before trusting auto-close.
2. **`closedByPullRequestsReferences` excludes closed/merged PRs by default** — always pass
   `includeClosedPrs: true`, or a card whose PR already merged looks unlinked.
3. **Actions on agent PRs need "Approve and run workflows."** If a stage gates on green CI, model
   that approval as its own gate, and surface the repo opt-out setting as board config.

## 4. Gating on references

A stage's `exit` condition ([01](./01-domain-model-and-glossary.md)) may **require** a reference:
e.g. a `publish` stage can't be entered until a `pull_request` reference exists and is `merged`,
or a `review` gate auto-resolves when CI on the attached PR is green. References are therefore not
just metadata — they can be **preconditions** in the pipeline. **⚠️ OPEN**: expression language for
reference-based gate conditions.

## 5. Repos & docs

- **Repository** references record `{ hostname, fullName, defaultBranch }`. Unlike Hermes, Kaambaan
  does **not** mount or own the repo — the *remote agent* resolves it in its own sandbox; we track
  the **branch/ref** it produces as the integration unit ("workspace = unit of delegation; branch
  + PR = unit of integration").
- **Docs** are references of `sourceType: doc` (Notion/Confluence/Drive/url) attached for context;
  an agent receives them in its context bundle on `claim`.
- **Mirror the source's permission model.** A reference records branch scope and approver; we never
  assume more access than the source grants. **⚠️ OPEN**: deep doc-provider integrations (read
  content vs link-only) — link-only in v1.

## 6. Security summary

| Direction | Control |
|---|---|
| Inbound GitHub webhook | Verify `X-Hub-Signature-256`; dedup `X-GitHub-Delivery`; reject stale timestamps |
| Outbound to agents | HMAC/JWT-signed ([05 §4](./05-integration-surfaces.md)); URL allowlist (SSRF) |
| Reference write | Idempotent upsert on `(cardId, url)`; tenant-scoped; provenance recorded |
| Approver identity | Separation-of-duties enforced at the gate, recorded on the reference |
