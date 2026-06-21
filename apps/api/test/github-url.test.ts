import { describe, it, expect } from 'vitest';
import { recognizeReference } from '../src/references/github-url';

/** docs/06 §1: recognized URL shapes get richer provider/sourceType; a bare url is still valid. */
describe('recognizeReference', () => {
  it('recognizes a GitHub pull request URL', () => {
    expect(recognizeReference('https://github.com/org/repo/pull/42')).toEqual({
      provider: 'github',
      sourceType: 'pull_request',
      externalId: 'org/repo#42',
    });
  });

  it('recognizes a GitHub issue URL', () => {
    expect(recognizeReference('https://github.com/org/repo/issues/7')).toEqual({
      provider: 'github',
      sourceType: 'issue',
      externalId: 'org/repo#7',
    });
  });

  it('recognizes a GitHub repository URL', () => {
    expect(recognizeReference('https://github.com/org/repo')).toEqual({
      provider: 'github',
      sourceType: 'repo',
      externalId: 'org/repo',
    });
  });

  it('recognizes a GitHub commit URL', () => {
    expect(recognizeReference('https://github.com/org/repo/commit/abc123')).toMatchObject({
      provider: 'github',
      sourceType: 'commit',
    });
  });

  it('tolerates trailing slashes and query strings', () => {
    expect(recognizeReference('https://github.com/org/repo/pull/42/')).toMatchObject({
      sourceType: 'pull_request',
      externalId: 'org/repo#42',
    });
    expect(recognizeReference('https://github.com/org/repo/pull/42?w=1')).toMatchObject({ sourceType: 'pull_request' });
  });

  it('falls back to a generic url reference for non-GitHub links', () => {
    expect(recognizeReference('https://docs.example.com/spec')).toEqual({ provider: 'url', sourceType: 'url' });
  });

  it('falls back gracefully for an unparseable string', () => {
    expect(recognizeReference('not a url')).toEqual({ provider: 'url', sourceType: 'url' });
  });
});
