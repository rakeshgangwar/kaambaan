# 12 — Deploy (Cloudflare)

Kaambaan deploys as **one Worker** that serves both the API (`/v1`, `/auth`, `/mcp`, `/health`) and
the web SPA (static assets, same-origin). Same-origin means the session cookie and the app's relative
`fetch`es just work — no CORS, no cross-site cookies.

## Continuous deploy (the normal path)

Merging to `main` auto-deploys. The `deploy` job in `.github/workflows/ci.yml` runs after the `test`
and `e2e` jobs pass on a push to `main`: it migrates the remote D1 and runs `wrangler deploy
--var DEV_AUTH:false`. It needs one repo secret:

- **`CLOUDFLARE_API_TOKEN`** — a Cloudflare API token with **Workers Scripts: Edit** and **D1: Edit**,
  scoped to your account (a single-account token lets wrangler infer the account). Add it under
  *Settings → Secrets and variables → Actions*.

So the day-to-day flow is: open a PR → tests run → merge → it builds, migrates, and ships to
kaambaan.dev automatically. The manual steps below are only for first-time setup or one-off deploys.

## Prerequisites (you)

1. **Authenticate wrangler** (interactive):
   ```
   wrangler login
   ```
2. **Create a GitHub OAuth app** — https://github.com/settings/developers → *New OAuth App*:
   - Application name: `Kaambaan`
   - Homepage URL: your deployed origin (e.g. `https://kaambaan-api.<your-subdomain>.workers.dev`)
   - **Authorization callback URL**: `<origin>/auth/callback`
   - Note the **Client ID** and generate a **Client secret**.

   The origin isn't known until the first deploy, so: deploy once (step 3), read the URL, then fill
   the OAuth app and `APP_URL` with it.

## Deploy

3. **Create the D1 catalog** and paste its id into `apps/api/wrangler.jsonc` (`database_id`):
   ```
   cd apps/api && wrangler d1 create kaambaan-catalog
   ```
4. **Apply migrations** to the remote DB:
   ```
   pnpm --filter @kaambaan/api db:migrate
   ```
5. **Set secrets** (from `apps/api`):
   ```
   wrangler secret put SESSION_SECRET        # a long random string
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   wrangler secret put APP_URL               # the deployed origin, e.g. https://kaambaan-api.<sub>.workers.dev
   ```
6. **Build the web + deploy** (this builds `apps/web/build` and deploys with dev-auth OFF):
   ```
   pnpm --filter @kaambaan/api deploy
   ```

`deploy` runs `wrangler deploy --var DEV_AUTH:false`, so the deployed app accepts **only** real auth
(GitHub session cookies + `kbn_` agent tokens). The dev-mode `X-Tenant-Id` / `X-Agent-Id` headers are
rejected in production.

## After deploy

- Confirm the callback URL in the GitHub OAuth app matches `<origin>/auth/callback`.
- Visit the origin → "Sign in with GitHub" → you land in your personal workspace's onboarding.
- Connect an agent from the masthead to mint a `kbn_` token + copy the `.mcp.json`.

## Local development is unchanged

`pnpm --filter @kaambaan/api dev:setup` (migrate + seed the local D1) then run the web (`:5173`,
Vite) and API (`:8787`, wrangler) separately; Vite proxies `/v1`, `/auth`, `/mcp` to the Worker. Local
runs with `DEV_AUTH=true`, so the `tnt_dev` workspace works without signing in.
