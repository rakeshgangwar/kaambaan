import { describe, it, expect } from 'vitest';
import { verifyGithubSignature, githubSignatureHeader } from '../src/references/github-signature';

describe('verifyGithubSignature (X-Hub-Signature-256, docs/06 §3)', () => {
  it('accepts the known-good vector from GitHub docs', async () => {
    // secret "It's a Secret to Everybody", body "Hello, World!"
    const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(await verifyGithubSignature("It's a Secret to Everybody", 'Hello, World!', header)).toBe(true);
  });

  it('round-trips its own signer', async () => {
    const body = '{"action":"opened"}';
    const header = await githubSignatureHeader('shhh', body);
    expect(await verifyGithubSignature('shhh', body, header)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const header = await githubSignatureHeader('shhh', '{"n":1}');
    expect(await verifyGithubSignature('shhh', '{"n":2}', header)).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const header = await githubSignatureHeader('right', 'body');
    expect(await verifyGithubSignature('wrong', 'body', header)).toBe(false);
  });

  it('rejects missing or malformed headers', async () => {
    expect(await verifyGithubSignature('s', 'b', null)).toBe(false);
    expect(await verifyGithubSignature('s', 'b', 'sha1=abc')).toBe(false);
    expect(await verifyGithubSignature('s', 'b', 'garbage')).toBe(false);
  });
});
