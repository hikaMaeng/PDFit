/**
 * OCR through an OpenAI-compatible vision model. Used only for areas that have no PDF
 * text layer (scanned pages); digital PDFs are read from the text layer instead.
 */
export interface VisionOcrServer {
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
  /** Local reasoning models can need minutes per image. */
  timeoutMs?: number;
}

export type VisionImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const OCR_INSTRUCTION = [
  'Transcribe every piece of text visible in this image exactly as written, in its original language.',
  'Keep the reading order and line breaks. Do not translate, summarize, explain, or add anything.',
  'Output only the transcribed text. If the image contains no text, output nothing.',
].join(' ');

function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString();
}

/** Removes a wrapping code fence some models add around plain output. */
export function cleanOcrOutput(content: string): string {
  return content.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').replace(/\r\n/g, '\n').trim();
}

export async function recognizeImageText(
  server: VisionOcrServer,
  image: { bytes: Buffer; type: VisionImageType },
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(chatCompletionsUrl(server.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...server.headers },
    body: JSON.stringify({
      model: server.model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: OCR_INSTRUCTION },
          { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.bytes.toString('base64')}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(server.timeoutMs ?? 300_000),
  });
  if (!response.ok) throw new Error(`Vision OCR request failed (${response.status}).`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
  const choice = payload.choices?.[0];
  if (!choice || typeof choice.message?.content !== 'string') throw new Error('Vision OCR returned no message.');
  if (choice.finish_reason === 'length' && !choice.message.content.trim()) throw new Error('Vision OCR ran out of tokens before answering.');
  return cleanOcrOutput(choice.message.content);
}
