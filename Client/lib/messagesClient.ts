import api from './api';

export interface MessageEntry {
  key: string;
  category: string;
  kind: 'static' | 'template';
  default: string;
  placeholders: string[];
  override: string | null;
  enabled: boolean;
}

export async function listMessages(): Promise<MessageEntry[]> {
  const r = await api.get('/settings/messages');
  return r.data?.data ?? r.data ?? [];
}

export async function saveMessage(message_key: string, override_text: string, enabled = true): Promise<void> {
  await api.put('/settings/messages', { message_key, override_text, enabled });
}

export async function resetMessage(message_key: string): Promise<void> {
  await api.delete('/settings/messages', { data: { message_key } });
}
