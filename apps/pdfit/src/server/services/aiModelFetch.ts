import { AI_MODEL_REQUEST_TIMEOUT_MS } from '@pdfit/pdfit/server';
import { Agent, fetch as undiciFetch } from 'undici';

// See packages/pdfit/docs/api.md#ai-model-requests.
const dispatcher = new Agent({
  headersTimeout: AI_MODEL_REQUEST_TIMEOUT_MS,
  bodyTimeout: AI_MODEL_REQUEST_TIMEOUT_MS,
});

// The Fetch types differ between Node and the pinned Undici release. AI callers use URL strings and JSON bodies.
const modelFetch = undiciFetch as unknown as (
  input: Parameters<typeof fetch>[0], init: RequestInit & { dispatcher: Agent },
) => ReturnType<typeof fetch>;

export const fetchAiModel: typeof fetch = (input, init) => modelFetch(input, { ...init, dispatcher });
