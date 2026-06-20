import { assertTenantId, TenantIsolationError } from '../db/tenant-scope';

/**
 * The authenticated caller, resolved at the edge before any board is touched (docs/02).
 * A user acts under a role; an agent (app-actor) acts under capability scopes. Both are pinned
 * to exactly one tenant.
 */
export type Principal =
  | { kind: 'user'; userId: string; tenantId: string; role: string }
  | { kind: 'agent'; agentId: string; tenantId: string; scopes: string[] };

export function tenantOf(principal: Principal): string {
  return principal.tenantId;
}

/**
 * Guard: a principal may only act within its own tenant. Throws `TenantIsolationError` on any
 * cross-tenant attempt or when the resource tenant is missing.
 */
export function assertSameTenant(principal: Principal, resourceTenantId: string): void {
  assertTenantId(resourceTenantId);
  assertTenantId(principal.tenantId);
  if (principal.tenantId !== resourceTenantId) {
    throw new TenantIsolationError(
      `principal (tenant "${principal.tenantId}") is not authorized for tenant "${resourceTenantId}"`,
    );
  }
}
