import { describe, it, expect } from 'vitest';
import { mapGithubEvent } from '../src/references/github-events';

const repo = { full_name: 'org/repo', default_branch: 'main' };
const pr = (over: Record<string, unknown> = {}) => {
  const { action = 'opened', ...prOver } = over;
  return {
    action,
    pull_request: {
      number: 42,
      draft: true,
      merged: false,
      state: 'open',
      base: { ref: 'main' },
      head: { ref: 'feat' },
      html_url: 'https://github.com/org/repo/pull/42',
      ...prOver,
    },
    repository: repo,
  };
};

/** docs/06 §2: GitHub signals → a draft-PR sub-state on the card (enriches, never replaces A2A state). */
describe('mapGithubEvent — draft-PR sub-state machine', () => {
  it('maps an opened draft PR to draft_pr_open', () => {
    expect(mapGithubEvent('pull_request', pr({ draft: true }))).toMatchObject({
      externalId: 'org/repo#42',
      sourceType: 'pull_request',
      subState: 'draft_pr_open',
      metadata: { state: 'open', draft: true, baseRef: 'main', headRef: 'feat' },
    });
  });

  it('maps an opened non-draft PR to pr_open', () => {
    expect(mapGithubEvent('pull_request', pr({ draft: false }))).toMatchObject({ subState: 'pr_open', metadata: { draft: false } });
  });

  it('maps synchronize to agent_iterating', () => {
    expect(mapGithubEvent('pull_request', pr({ action: 'synchronize' }))).toMatchObject({ subState: 'agent_iterating' });
  });

  it('maps ready_for_review to awaiting_review (a human-action gate trigger)', () => {
    const r = mapGithubEvent('pull_request', pr({ action: 'ready_for_review', draft: false }));
    expect(r).toMatchObject({ subState: 'awaiting_review', metadata: { draft: false } });
  });

  it('maps converted_to_draft back to draft_pr_open', () => {
    expect(mapGithubEvent('pull_request', pr({ action: 'converted_to_draft' }))).toMatchObject({ subState: 'draft_pr_open' });
  });

  it('maps a merged PR to merged, recording trap #1 (merged into the default branch)', () => {
    const r = mapGithubEvent('pull_request', pr({ action: 'closed', merged: true, state: 'closed', base: { ref: 'main' } }));
    expect(r).toMatchObject({ subState: 'merged', metadata: { merged: true, mergedToDefaultBranch: true } });
  });

  it('flags a merge into a non-default branch (trap #1: closing keywords would NOT auto-close)', () => {
    const r = mapGithubEvent('pull_request', pr({ action: 'closed', merged: true, base: { ref: 'release/1.x' } }));
    expect(r).toMatchObject({ subState: 'merged', metadata: { mergedToDefaultBranch: false } });
  });

  it('maps a closed-unmerged PR to closed', () => {
    expect(mapGithubEvent('pull_request', pr({ action: 'closed', merged: false }))).toMatchObject({
      subState: 'closed',
      metadata: { merged: false },
    });
  });

  it('maps an assigned issue to agent_working', () => {
    const payload = { action: 'assigned', issue: { number: 7, state: 'open', html_url: 'https://github.com/org/repo/issues/7' }, repository: repo };
    expect(mapGithubEvent('issues', payload)).toMatchObject({ externalId: 'org/repo#7', sourceType: 'issue', subState: 'agent_working' });
  });

  it('maps a closed issue to issue_closed', () => {
    const payload = { action: 'closed', issue: { number: 7, state: 'closed', html_url: 'x' }, repository: repo };
    expect(mapGithubEvent('issues', payload)).toMatchObject({ subState: 'issue_closed' });
  });

  it('ignores events and actions it does not model', () => {
    expect(mapGithubEvent('pull_request', pr({ action: 'labeled' }))).toBeNull();
    expect(mapGithubEvent('star', { action: 'created' })).toBeNull();
    expect(mapGithubEvent('issues', { action: 'pinned', issue: { number: 1 }, repository: repo })).toBeNull();
  });
});
