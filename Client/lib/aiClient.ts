// Client-side AI helpers. Streaming endpoints (chat, draft) use fetch + ReadableStream because
// the shared axios `api` instance can't stream; non-streaming calls go through `api`.
import api from './api';
import { getToken } from './auth';

const BASE_URL = '/v1/api/hr';

export interface AiHealth {
  ok: boolean; enabled: boolean; reason?: string;
  models?: string[]; chatModel?: string; embedModel?: string;
  chatReady?: boolean; embedReady?: boolean;
  features?: { assistant: boolean; drafting: boolean; ocr: boolean; insights: boolean };
}

export async function aiHealth(): Promise<AiHealth> {
  const r = await api.get('/ai/health');
  return r.data?.data ?? r.data;
}

export async function aiGetConfig(): Promise<any> {
  const r = await api.get('/ai/config');
  return r.data?.data ?? r.data;
}

export async function aiSaveConfig(cfg: any): Promise<any> {
  const r = await api.put('/ai/config', cfg);
  return r.data?.data ?? r.data;
}

export async function aiReindex(): Promise<{ chunks: number }> {
  const r = await api.post('/ai/reindex', {});
  return r.data?.data ?? r.data;
}

export interface KnowledgeEntry { id: string; title: string; content: string; enabled: boolean; updated_at?: string; }

export async function aiListKnowledge(): Promise<KnowledgeEntry[]> {
  const r = await api.get('/ai/knowledge');
  return r.data?.data ?? r.data ?? [];
}

export async function aiSaveKnowledge(entry: { id?: string; title: string; content: string; enabled?: boolean }): Promise<void> {
  if (entry.id) await api.put(`/ai/knowledge/${entry.id}`, entry);
  else await api.post('/ai/knowledge', entry);
}

export async function aiSetKnowledgeEnabled(id: string, enabled: boolean): Promise<void> {
  await api.put(`/ai/knowledge/${id}`, { enabled });
}

export async function aiDeleteKnowledge(id: string): Promise<void> {
  await api.delete(`/ai/knowledge/${id}`);
}

export async function aiAttrition(): Promise<any> {
  const r = await api.get('/ai/insights/attrition');
  return r.data?.data ?? r.data;
}

export async function aiOcr(file: File): Promise<{ fields: any; raw: string; note?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await api.post('/ai/ocr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return r.data?.data ?? r.data;
}

// Stream an SSE endpoint, invoking onToken for each text chunk. Returns the full text.
async function streamSSE(
  path: string, body: any, onToken: (t: string) => void, signal?: AbortSignal,
): Promise<string> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    credentials: 'include',
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); msg = j?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const obj = JSON.parse(payload);
        if (obj.token) { full += obj.token; onToken(obj.token); }
      } catch { /* ignore malformed chunk */ }
    }
  }
  return full;
}

export function aiChatStream(message: string, onToken: (t: string) => void, signal?: AbortSignal) {
  return streamSSE('/ai/chat', { message }, onToken, signal);
}

export function aiDraftStream(
  kind: string, context: string, onToken: (t: string) => void, maxChars?: number, signal?: AbortSignal,
) {
  return streamSSE('/ai/draft', { kind, context, maxChars }, onToken, signal);
}
