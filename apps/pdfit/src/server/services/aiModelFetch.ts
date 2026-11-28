import { Agent, fetch as undiciFetch } from 'undici';

// streamAiCompletion supplies one deadline for the headers and the full response body.
const dispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

// The Fetch types differ between Node and the pinned Undici release. AI callers use URL strings and JSON bodies.
const modelFetch = undiciFetch as unknown as (
  input: Parameters<typeof fetch>[0], init: RequestInit & { dispatcher: Agent },
) => ReturnType<typeof fetch>;

export const fetchAiModel: typeof fetch = (input, init) => modelFetch(input, { ...init, dispatcher });
