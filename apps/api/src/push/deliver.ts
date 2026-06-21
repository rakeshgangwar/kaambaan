/**
 * Outbound push delivery (docs/05 §4): sign a queued delivery and POST it. Pull is the default; push
 * is an accelerator that just tells an agent to `claim`. The sender is injected so the send is
 * testable and so durability (Queue + Workflow with exponential backoff) can wrap it in production.
 */
import { hmacSignatureHeader } from '../crypto/hmac';

export interface PushDelivery {
  id: number;
  url: string;
  body: string; // JSON string — the exact bytes that are signed
  token: string; // per-config signing secret
}

export type PushSender = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

export interface PushOutcome {
  id: number;
  ok: boolean;
  status: number;
}

export async function signAndSend(delivery: PushDelivery, sender: PushSender): Promise<PushOutcome> {
  const signature = await hmacSignatureHeader(delivery.token, delivery.body);
  let event = '';
  try {
    event = (JSON.parse(delivery.body) as { event?: string }).event ?? '';
  } catch {
    event = '';
  }
  try {
    const res = await sender(delivery.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kaambaan-Signature': signature, 'X-Kaambaan-Event': event },
      body: delivery.body,
    });
    return { id: delivery.id, ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { id: delivery.id, ok: false, status: 0 };
  }
}
