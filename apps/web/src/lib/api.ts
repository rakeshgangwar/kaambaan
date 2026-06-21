/**
 * Thin client for the Kaambaan API (apps/api). P1 uses a dev-mode tenant; real auth replaces it
 * later without changing call sites.
 */
const TENANT = 'tnt_dev';
const headers = { 'X-Tenant-Id': TENANT, 'Content-Type': 'application/json' };

export interface Stage {
  key: string;
  name: string;
  order: number;
  gate?: 'none' | 'approval';
  wipLimit?: number;
}

export interface Card {
  id: string;
  title: string;
  ownerUserId: string;
  currentStageKey: string;
  state: string;
  priority: number;
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
}

export const DEFAULT_STAGES: Stage[] = [
  { key: 'backlog', name: 'Backlog', order: 0 },
  { key: 'ready', name: 'Ready', order: 1 },
  { key: 'in-progress', name: 'In Progress', order: 2, wipLimit: 3 },
  { key: 'review', name: 'Review', order: 3, gate: 'approval' },
  { key: 'done', name: 'Done', order: 4 },
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
    body: JSON.stringify({ title, ownerUserId: 'usr_dev' }),
  });
  if (!res.ok) throw new Error(`createCard failed (${res.status})`);
}

/** Returns the raw response so callers can surface WIP-limit (409) and unknown-stage (400) cases. */
export function moveCard(boardId: string, cardId: string, toStageKey: string): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/cards/${cardId}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ toStageKey }),
  });
}

/** Resolve an approval gate. The dev resolver is `usr_dev`; real auth supplies the user. */
export function resolveGate(
  boardId: string,
  gateId: string,
  decision: GateDecision,
  comment?: string,
): Promise<Response> {
  return fetch(`/v1/boards/${boardId}/gates/${gateId}/resolve`, {
    method: 'POST',
    headers: { ...headers, 'X-User-Id': 'usr_dev' },
    body: JSON.stringify({ decision, comment }),
  });
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
