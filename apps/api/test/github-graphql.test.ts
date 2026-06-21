import { describe, it, expect } from 'vitest';
import { parseRepoRef, closingIssuesQuery, closedByPullRequestsQuery } from '../src/references/github-graphql';

/**
 * GraphQL reconciliation queries (docs/06 §3). The live cron Workflow that runs these needs a GitHub
 * App token (operator config), but the *queries* encode the correctness traps and are tested here.
 */
describe('github GraphQL reconciliation', () => {
  it('parses an externalId into owner/repo/number', () => {
    expect(parseRepoRef('org/repo#42')).toEqual({ owner: 'org', repo: 'repo', number: 42 });
    expect(parseRepoRef('org/repo')).toBeNull();
    expect(parseRepoRef('not-a-ref')).toBeNull();
  });

  it('issue→PRs query passes includeClosedPrs:true (trap #2: else a merged PR looks unlinked)', () => {
    const q = closedByPullRequestsQuery({ owner: 'org', repo: 'repo', number: 7 });
    expect(q).toContain('closedByPullRequestsReferences');
    expect(q.replace(/\s+/g, ' ')).toContain('includeClosedPrs: true');
  });

  it('PR→issues query uses closingIssuesReferences (and selects baseRef for trap #1)', () => {
    const q = closingIssuesQuery({ owner: 'org', repo: 'repo', number: 42 });
    expect(q).toContain('closingIssuesReferences');
    expect(q).toContain('baseRefName');
  });

  it('safely encodes owner/repo (no GraphQL injection)', () => {
    const q = closingIssuesQuery({ owner: 'a"injected', repo: 'r', number: 1 });
    expect(q).toContain('"a\\"injected"');
  });
});
