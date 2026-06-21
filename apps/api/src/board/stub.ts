import type { Env } from '../env';
import type { BoardStub } from './board-do';

/**
 * Resolve the Board DO stub for a (tenant, board). The DO name binds tenant + board, so an instance
 * can never serve two tenants (docs/02). Hand-typed as `BoardStub` to avoid deep RPC type recursion.
 */
export function boardStub(env: Env, tenantId: string, boardId: string): BoardStub {
  return env.BOARD_DO.get(env.BOARD_DO.idFromName(`${tenantId}:${boardId}`)) as unknown as BoardStub;
}
