/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { Env as WorkerEnv } from '../src/env';

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env`; bind it to our Worker bindings.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
