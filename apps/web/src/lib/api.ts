/**
 * Thin client for the Kaambaan API (apps/api). The deployed app authenticates with a session cookie
 * (sent automatically, same-origin); the `X-Tenant-Id` header is a no-op there and only enables the
 * local dev workspace (when the server runs with DEV_AUTH on).
 */
const TENANT = 'tnt_dev';
const headers = { 'X-Tenant-Id': TENANT, 'Content-Type': 'application/json' };

export interface User {
  userId: string;
  tenantId: string;
  name?: string;
  login?: string;
  avatarUrl?: string;
}

export interface BoardSummary {
  id: string;
  name: string;
}

export interface AgentToken {
  agent: { id: string; name: string; capabilities: string[] };
  token: string;
}

export interface Stage {
  key: string;
  name: string;
  order: number;
  gate?: 'none' | 'approval';
  wipLimit?: number;
  routing?: 'pipeline' | 'manager';
  ownerKind?: 'capability' | 'human';
  owner?: string;
}

export interface Card {
  id: string;
  title: string;
  spec?: Record<string, unknown> | null;
  ownerUserId: string;
  currentStageKey: string;
  state: string;
  priority: number;
  costUsd: number;
  overBudget: boolean;
  attemptCount: number;
}

export interface Attempt {
  runId: string;
  agentId: string;
  stageKey: string;
  status: string;
  outcome: string | null;
  costUsd: number;
  model: string | null;
  profileKey: string | null;
}

export interface Activity {
  seq: number;
  runId: string;
  type: string;
  ts: string;
  body: string | null;
  action: string | null;
  parameter: unknown;
  result: unknown;
  signal: string | null;
}

export interface CardActivities {
  activities: Activity[];
  handoff: Record<string, unknown> | null;
}

export interface Notification {
  seq: number;
  kind: string;
  cardId: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface BoardUsage {
  totalCostUsd: number;
  estimatedCostUsd: number;
  budgetUsd: number | null;
  cardUsdCap: number | null;
  overBudget: boolean;
}

export interface GateOption {
  name: string;
  title: string;
  interactive?: boolean;
}

export interface Gate {
  id: string;
  cardId: string;
  stageKey: string;
  status: string;
  options: GateOption[];
  producedBy: string;
}

export type GateDecision = 'approve' | 'request_changes' | 'reject';

export interface Reference {
  id: string;
  cardId: string;
  url: string;
  title?: string | null;
  subtitle?: string | null;
  provider: string;
  sourceType: string;
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  addedBy: 'agent' | 'user';
}

export interface BoardSnapshot {
  boardId: string | null;
  tenantId: string | null;
  name: string | null;
  stages: Stage[];
  cards: Card[];
  gates: Gate[];
  references: Reference[];
  usage: BoardUsage;
  github: { issueTrigger: boolean; webhookConfigured: boolean };
}

export interface Profile {
  key: string;
  name: string | null;
  harness: string | null;
  model: string | null;
  permissionPolicy: string | null;
  autonomyLevel: string | null;
  capabilities: string[];
}

export const DEFAULT_STAGES: Stage[] = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'ready', name: 'Ready', order: 1 },
  { key: 'in-progress', name: 'In Progress', order: 2, wipLimit: 3 },
  { key: 'review', name: 'Review', order: 3, gate: 'approval' },
  { key: 'done', name: 'Done', order: 4 },
];

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  stages: Stage[];
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'agent-pipeline',
    name: 'Agent pipeline',
    description: 'Research → Review (your approval) → Publish. Agents work the Research & Publish lanes; you approve in the middle.',
    stages: [
      { key: 'research', name: 'Research', order: 0, ownerKind: 'capability', owner: 'research' },
      { key: 'review', name: 'Review', order: 1, ownerKind: 'human', gate: 'approval' },
      { key: 'publish', name: 'Publish', order: 2, ownerKind: 'capability', owner: 'publish' },
    ],
  },
  {
    id: 'simple',
    name: 'Simple board',
    description: 'A classic Kanban: Backlog → Ready → In Progress → Review → Done. All human lanes (you move the cards).',
    stages: DEFAULT_STAGES,
  },
];

export async function createBoard(name: string, stages: Stage[]): Promise<string> {
  const res = await fetch('/v1/boards', { method: 'POST', headers, body: JSON.stringify({ name, stages }) });
  if (!res.ok) throw new Error(`createBoard failed (${res.status})`);
  const data = (await res.json()) as { boardId: string };
  return data.boardId;
}

export async function getBoard(boardId: string): Promise<BoardSnapshot> {
  const res = await fetch(`/v1/boards/${boardId}`, { headers });
  if (!res.ok) throw new Error(`getBoard failed (${res.status})`);
  return (await res.json()) as BoardSnapshot;
}

export async function createCard(boardId: string, title: string): Promise<void> {
  const res = await fetch(`/v1/boards/${boardId}/cards`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title }), // owner is the signed-in user, set by the server
  });
  if (!res.ok) throw new Error(`createCard failed (${res.status})`);
}

/** Edit a card's title / description (spec) / priority. */
export function updateCard(boardId: string, cardId: string, patch: { title?: string; spec?: Record<string, unknown>; priority?: number }): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/cards/${cardId}`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
}

/** Delete a card and everything scoped to it. */
export function deleteCard(boardId: string, cardId: string): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/cards/${cardId}`, { method: 'DELETE', headers });
}

/** Attach a reference (link) to a card by hand. */
export function addReference(boardId: string, cardId: string, ref: { url: string; title?: string }): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/cards/${cardId}/references`, { method: 'PUT', headers, body: JSON.stringify({ ...ref, addedBy: 'user' }) });
}

/** Returns the raw response so callers can surface WIP-limit (409) and unknown-stage (400) cases. */
export function moveCard(boardId: string, cardId: string, toStageKey: string): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/cards/${cardId}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ toStageKey }),
  });
}

/** The attempts (runs) for a card, for the comparison view (docs/07 §5). */
export async function getAttempts(boardId: string, cardId: string): Promise<Attempt[]> {
  const res = await fetch(`/v1/boards/${boardId}/cards/${cardId}/attempts`, { headers });
  if (!res.ok) throw new Error(`getAttempts failed (${res.status})`);
  return ((await res.json()) as { attempts: Attempt[] }).attempts;
}

/** A card's session-replay timeline + carried handoff (docs/07 §4). */
export async function getCardActivities(boardId: string, cardId: string): Promise<CardActivities> {
  const res = await fetch(`/v1/boards/${boardId}/cards/${cardId}/activities`, { headers });
  if (!res.ok) throw new Error(`getCardActivities failed (${res.status})`);
  return (await res.json()) as CardActivities;
}

/** In-app notification feed (docs/07 §7). */
export async function getNotifications(boardId: string): Promise<Notification[]> {
  const res = await fetch(`/v1/boards/${boardId}/notifications`, { headers });
  if (!res.ok) throw new Error(`getNotifications failed (${res.status})`);
  return ((await res.json()) as { notifications: Notification[] }).notifications;
}

export function markNotificationRead(boardId: string, seq: number): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/notifications/${seq}/read`, { method: 'POST', headers });
}

/** Resolve an approval gate. The resolver identity is the signed-in user (set by the server). */
export function resolveGate(
  boardId: string,
  gateId: string,
  decision: GateDecision,
  comment?: string,
): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/gates/${gateId}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision, comment }),
  });
}

/** The signed-in user, or null when signed out (drives the auth gate). */
export async function getMe(): Promise<User | null> {
  const res = await fetch('/auth/me', { headers });
  if (!res.ok) return null;
  return ((await res.json()) as { user: User | null }).user;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', headers });
}

/** The boards in the signed-in user's workspace. */
export async function getBoards(): Promise<BoardSummary[]> {
  const res = await fetch('/v1/boards', { headers });
  if (!res.ok) throw new Error(`getBoards failed (${res.status})`);
  return ((await res.json()) as { boards: BoardSummary[] }).boards;
}

/** Register an agent and mint its bearer token (shown once). */
export async function createAgent(name: string, capabilities: string[]): Promise<AgentToken> {
  const res = await fetch('/v1/agents', { method: 'POST', headers, body: JSON.stringify({ name, capabilities }) });
  if (!res.ok) throw new Error(`createAgent failed (${res.status})`);
  return (await res.json()) as AgentToken;
}

export interface Estimate {
  stageKey: string;
  estimatedUsd: number | null;
  sampleSize: number;
}

/** Set or clear the board / per-card USD budget caps (pass null to clear). */
export function setBudget(boardId: string, caps: { boardUsdCap?: number | null; cardUsdCap?: number | null }): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/budget`, { method: 'PUT', headers, body: JSON.stringify(caps) });
}

/** Pre-run cost estimate for a card's current stage, from history (docs/07 §6). */
export async function getEstimate(boardId: string, cardId: string): Promise<Estimate | null> {
  const res = await fetch(`/v1/boards/${boardId}/cards/${cardId}/estimate`, { headers });
  if (!res.ok) return null;
  return (await res.json()) as Estimate;
}

/** The agents registered in the signed-in user's workspace. */
export async function getAgents(): Promise<Array<{ id: string; name: string; capabilities: string[] }>> {
  const res = await fetch('/v1/agents', { headers });
  if (!res.ok) throw new Error(`getAgents failed (${res.status})`);
  return ((await res.json()) as { agents: Array<{ id: string; name: string; capabilities: string[] }> }).agents;
}

/** Rename a board. */
export function renameBoard(boardId: string, name: string): Promise<Response> {
  return fetch(`/v1/boards/${boardId}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) });
}

/** Remove a board from the workspace. */
export function deleteBoard(boardId: string): Promise<Response> {
  return fetch(`/v1/boards/${boardId}`, { method: 'DELETE', headers });
}

/** Configure the GitHub webhook secret + issue→card trigger for a board. */
export function setGithubConfig(boardId: string, cfg: { secret?: string; issueTrigger?: boolean }): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/github`, { method: 'PUT', headers, body: JSON.stringify(cfg) });
}

/** Agent profiles configured on a board (docs/05 §7). */
export async function getProfiles(boardId: string): Promise<Profile[]> {
  const res = await fetch(`/v1/boards/${boardId}/profiles`, { headers });
  if (!res.ok) throw new Error(`getProfiles failed (${res.status})`);
  return ((await res.json()) as { profiles: Profile[] }).profiles;
}

export function createProfile(boardId: string, input: { key: string; name?: string; model?: string; capabilities?: string[] }): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/profiles`, { method: 'POST', headers, body: JSON.stringify(input) });
}

/** Revoke an agent and all of its tokens. */
export function deleteAgent(agentId: string): Promise<Response> {
  return fetch(`/v1/agents/${agentId}`, { method: 'DELETE', headers });
}

/** Subscribe to the board's live event feed; `onEvent` fires on every server message. */
export function openBoardSocket(boardId: string, onEvent: () => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/v1/boards/${boardId}/ws?tenant=${TENANT}`);
  ws.addEventListener('message', () => {
    onEvent();
  });
  return ws;
}
