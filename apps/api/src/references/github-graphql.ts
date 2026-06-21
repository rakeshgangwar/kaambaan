/**
 * GraphQL reconciliation queries (docs/06 §3). Our agents are remote, so webhooks give only
 * eventual truth — a periodic Workflow re-fetches authoritative link state for active references so
 * a missed/late webhook can't leave a card wrong. These builders encode the correctness traps:
 *
 * - **Trap #2**: `closedByPullRequestsReferences` excludes closed/merged PRs by default — we MUST
 *   pass `includeClosedPrs: true`, or an issue whose PR already merged looks unlinked.
 * - **Trap #1** (companion): the PR→issues link only auto-closes when the PR targets the default
 *   branch, so we select `baseRefName` to compare against the repo default.
 *
 * The live cron that runs these needs a GitHub App installation token (operator config) — wiring it
 * is the remaining P5 operational task; the query correctness lives (and is tested) here.
 */
export interface RepoRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse a reference externalId ("owner/repo#42") into its parts, or null if it isn't one. */
export function parseRepoRef(externalId: string): RepoRef | null {
  const match = externalId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

const q = (v: string): string => JSON.stringify(v); // JSON-encodes (and escapes) a GraphQL string literal

/** PR → the issues it will close, plus the base branch needed for the trap #1 default-branch check. */
export function closingIssuesQuery(ref: RepoRef): string {
  return `query {
  repository(owner: ${q(ref.owner)}, name: ${q(ref.repo)}) {
    defaultBranchRef { name }
    pullRequest(number: ${ref.number}) {
      state merged baseRefName
      closingIssuesReferences(first: 20) { nodes { number state } }
    }
  }
}`;
}

/** issue → the PRs that close it. `includeClosedPrs: true` is the trap #2 fix. */
export function closedByPullRequestsQuery(ref: RepoRef): string {
  return `query {
  repository(owner: ${q(ref.owner)}, name: ${q(ref.repo)}) {
    issue(number: ${ref.number}) {
      state
      closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
        nodes { number state merged }
      }
    }
  }
}`;
}
