/**
 * Draft-PR sub-state machine (docs/06 §2): translate a GitHub webhook into a sub-state + metadata
 * patch for the referenced PR/issue. This *enriches* the card (it never replaces the canonical A2A
 * state in docs/03). Pure and total — returns null for events/actions we don't model.
 *
 * Trap #1 (docs/06 §3): closing keywords (`Fixes #123`) only auto-close when the PR targets the
 * repo's **default** branch. We can't text-parse the PR body reliably, so we record
 * `mergedToDefaultBranch` here; the actual issue→card linkage is the reconciliation worker's job.
 */
export interface GithubEventResult {
  externalId: string; // matches Reference.externalId, e.g. "org/repo#42"
  sourceType: 'pull_request' | 'issue';
  subState: string;
  metadata: Record<string, unknown>;
}

interface Repo {
  full_name?: string;
  default_branch?: string;
}

export function mapGithubEvent(event: string, payload: unknown): GithubEventResult | null {
  const p = payload as Record<string, any>;
  const repo = (p.repository ?? {}) as Repo;
  const fullName = repo.full_name?.toLowerCase();
  if (!fullName) return null;

  if (event === 'pull_request') {
    const pr = p.pull_request as Record<string, any> | undefined;
    if (!pr || typeof pr.number !== 'number') return null;
    const externalId = `${fullName}#${pr.number}`;
    const base = { externalId, sourceType: 'pull_request' as const };
    const meta = (extra: Record<string, unknown>): Record<string, unknown> => ({
      state: pr.state,
      draft: !!pr.draft,
      baseRef: pr.base?.ref,
      headRef: pr.head?.ref,
      url: pr.html_url,
      ...extra,
    });

    switch (p.action) {
      case 'opened':
      case 'reopened':
        return { ...base, subState: pr.draft ? 'draft_pr_open' : 'pr_open', metadata: meta({}) };
      case 'synchronize':
        return { ...base, subState: 'agent_iterating', metadata: meta({}) };
      case 'ready_for_review':
        return { ...base, subState: 'awaiting_review', metadata: meta({}) };
      case 'converted_to_draft':
        return { ...base, subState: 'draft_pr_open', metadata: meta({ draft: true }) };
      case 'closed':
        return pr.merged
          ? { ...base, subState: 'merged', metadata: meta({ merged: true, mergedToDefaultBranch: pr.base?.ref === repo.default_branch }) }
          : { ...base, subState: 'closed', metadata: meta({ merged: false }) };
      default:
        return null;
    }
  }

  if (event === 'issues') {
    const issue = p.issue as Record<string, any> | undefined;
    if (!issue || typeof issue.number !== 'number') return null;
    const externalId = `${fullName}#${issue.number}`;
    const base = { externalId, sourceType: 'issue' as const };
    const meta = { state: issue.state, url: issue.html_url };
    switch (p.action) {
      case 'assigned':
        return { ...base, subState: 'agent_working', metadata: meta };
      case 'reopened':
        return { ...base, subState: 'issue_open', metadata: meta };
      case 'closed':
        return { ...base, subState: 'issue_closed', metadata: meta };
      default:
        return null;
    }
  }

  return null;
}
