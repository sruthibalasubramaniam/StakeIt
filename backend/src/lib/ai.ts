/**
 * Optional AI provider client.
 *
 * Design rules:
 *  - **Optional.** With no `AI_API_KEY` every helper throws `503 AI_UNAVAILABLE`
 *    and no part of the product depends on it.
 *  - **One dialect.** OpenAI, Gemini and Anthropic all expose an
 *    OpenAI-compatible `/chat/completions`, so there is a single request shape
 *    and only the base URL differs.
 *  - **Grounded by construction.** Callers pass the exact source text; nothing
 *    here fetches, browses or invents context.
 *  - **Never leaks the key.** Failures are rethrown as operational errors with
 *    provider status only, never the request headers or body.
 */
import { env } from '../config/env';
import { ApiError } from './errors';

interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
}

const PRESETS: Record<string, ProviderPreset> = {
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-haiku-latest' },
  compatible: { baseUrl: '', defaultModel: '' },
};

export function isAiConfigured(): boolean {
  if (!env.AI_API_KEY) return false;
  const provider = env.AI_PROVIDER ?? 'compatible';
  const preset = PRESETS[provider];
  if (!preset) return false;
  return Boolean(env.AI_BASE_URL ?? preset.baseUrl) && Boolean(env.AI_MODEL ?? preset.defaultModel);
}

function credentials(): { baseUrl: string; model: string } {
  if (!isAiConfigured()) {
    throw new ApiError(
      503,
      'AI_UNAVAILABLE',
      'AI features are not configured on this server.',
      { hint: 'Set AI_PROVIDER, AI_API_KEY, AI_MODEL (and AI_BASE_URL for custom providers).' },
    );
  }
  const provider = env.AI_PROVIDER ?? 'compatible';
  const preset = PRESETS[provider]!;
  return {
    baseUrl: (env.AI_BASE_URL ?? preset.baseUrl).replace(/\/+$/, ''),
    model: env.AI_MODEL ?? preset.defaultModel,
  };
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function chat(messages: ChatMessage[], options: { json: boolean; temperature?: number }): Promise<string> {
  const { baseUrl, model } = credentials();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: env.AI_MAX_OUTPUT_TOKENS,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(503, 'AI_UNAVAILABLE', 'The AI provider rejected the configured credentials.');
    }
    if (response.status === 429) {
      throw new ApiError(503, 'AI_FAILED', 'The AI provider is rate limiting this server. Try again shortly.');
    }
    if (!response.ok) {
      /*
       * Surface a short, sanitised slice of the provider's own message. It makes
       * misconfiguration (wrong model id, unsupported parameter) diagnosable from
       * the API response instead of a bare status code — and it never contains
       * our key, which travels only in the request header.
       */
      const detail = await response.text().catch(() => '');
      throw new ApiError(
        503,
        'AI_FAILED',
        `The AI provider returned an error (${response.status}).`,
        { providerStatus: response.status, providerMessage: detail.slice(0, 300) || null },
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new ApiError(503, 'AI_FAILED', 'The AI provider returned an empty response.');
    }
    return content;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(503, 'AI_FAILED', 'The AI provider did not respond in time.');
    }
    throw new ApiError(503, 'AI_FAILED', 'Could not reach the AI provider.');
  } finally {
    clearTimeout(timer);
  }
}

/** Strips ```json fences some providers add despite JSON mode. */
function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return body.trim();
  return body.slice(start, end + 1);
}

export async function generateJson<T>(messages: ChatMessage[], temperature = 0.2): Promise<T> {
  const raw = await chat(messages, { json: true, temperature });
  try {
    return JSON.parse(unwrapJson(raw)) as T;
  } catch {
    throw new ApiError(503, 'AI_FAILED', 'The AI provider returned a response that was not valid JSON.', {
      rawPreview: raw.slice(0, 240),
      rawLength: raw.length,
    });
  }
}

export async function generateText(messages: ChatMessage[], temperature = 0.3): Promise<string> {
  const raw = await chat(messages, { json: false, temperature });
  return raw.trim();
}

export const AI_PROVIDER_PRESETS = PRESETS;
