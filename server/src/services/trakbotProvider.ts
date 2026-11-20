/**
 * Single server-side TrakBot LLM adapter.
 *
 * Supported execution: OpenAI Responses API, or self-hosted vLLM-compatible
 * Chat Completions on the SAME host (loopback only). Browser never sees keys.
 * Disabled/unavailable mode returns null and keeps deterministic chat working.
 */
export type TrakBotTransport = 'api' | 'local';
export interface TrakBotProviderSettings {
  enabled: boolean;
  apiKey: string;
  model: string;
  transport?: TrakBotTransport;
  localUrl?: string;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const LOCAL_DEFAULT = 'http://127.0.0.1:8000/v1/chat/completions';

/** Fail closed against open-proxy / SSRF configuration mistakes. */
export function safeLocalLlmUrl(raw: string): string | null {
  try {
    const url = new URL(raw || LOCAL_DEFAULT);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash ||
        url.pathname !== '/v1/chat/completions' || !url.port) return null;
    return url.href;
  } catch { return null; }
}

export function providerReady(settings: TrakBotProviderSettings): boolean {
  if (!settings.enabled || !settings.model.trim()) return false;
  if (settings.transport === 'local') return !!safeLocalLlmUrl(settings.localUrl || LOCAL_DEFAULT);
  return !!settings.apiKey.trim();
}

export function makeLlmRequest(
  instructions: string,
  input: string,
  maxOutputTokens: number,
  settings: TrakBotProviderSettings,
): { url: string; init: RequestInit } | null {
  if (!providerReady(settings)) return null;
  const local = settings.transport === 'local';
  const url = local ? safeLocalLlmUrl(settings.localUrl || LOCAL_DEFAULT) : OPENAI_RESPONSES_URL;
  if (!url) return null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.apiKey) headers.authorization = 'Bearer ' + settings.apiKey;
  const payload = local
    ? {
        model: settings.model,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
        max_tokens: maxOutputTokens,
        temperature: 0.25,
      }
    : {
        model: settings.model,
        instructions,
        input: [{ role: 'user', content: input }],
        store: false,
        max_output_tokens: maxOutputTokens,
      };
  return { url, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}

export function decodeLlmAnswer(payload: unknown, transport: TrakBotTransport): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (transport === 'local') {
    const content = obj.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }
  return (obj.output ?? []).flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '').join('\n').trim();
}

export async function requestGeneratedText(
  instructions: string,
  input: string,
  maxTokens: number,
  timeoutMs: number,
  settings: TrakBotProviderSettings,
): Promise<string | null> {
  const request = makeLlmRequest(instructions, input, maxTokens, settings);
  if (!request) return null;
  try {
    const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > 32_768) return null;
    const raw = await response.text();
    if (raw.length > 32_768) return null;
    const text = decodeLlmAnswer(JSON.parse(raw), settings.transport ?? 'api');
    return text && text.length <= 2_400 ? text : null;
  } catch {
    // Network outage, overload or unsupported model is never a paid/confirmed answer.
    return null;
  }
}
