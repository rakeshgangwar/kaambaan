/**
 * Recognize the shape of a reference URL (docs/06 §1). GitHub PR/issue/repo/commit URLs get a
 * richer `provider`/`sourceType` and a durable `externalId` (`owner/repo#n`); anything else is a
 * valid generic `url` reference — Kaambaan is domain-agnostic, references aren't git-specific.
 */
export interface RecognizedReference {
  provider: string;
  sourceType: string;
  externalId?: string;
}

const GENERIC: RecognizedReference = { provider: 'url', sourceType: 'url' };

export function recognizeReference(url: string): RecognizedReference {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return GENERIC;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') return GENERIC;

  const [owner, repo, kind, id] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return { provider: 'github', sourceType: 'url' };
  // GitHub owner/repo are case-insensitive; normalize so an externalId from a mixed-case URL still
  // matches the canonical `repository.full_name` a webhook delivers (docs/06 §3).
  const slug = `${owner}/${repo}`.toLowerCase();

  if (!kind) return { provider: 'github', sourceType: 'repo', externalId: slug };
  if (kind === 'pull' && id) return { provider: 'github', sourceType: 'pull_request', externalId: `${slug}#${id}` };
  if (kind === 'issues' && id) return { provider: 'github', sourceType: 'issue', externalId: `${slug}#${id}` };
  if (kind === 'commit' && id) return { provider: 'github', sourceType: 'commit', externalId: `${slug}@${id}` };
  if ((kind === 'tree' || kind === 'blob') && id) return { provider: 'github', sourceType: 'branch', externalId: `${slug}@${id}` };

  // A github.com URL we don't specifically model (e.g. /actions, /wiki).
  return { provider: 'github', sourceType: 'url' };
}
