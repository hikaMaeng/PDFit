import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { AiChatToolCall } from '../services/aiModelRequest.js';

export type BotPromptMessage = { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: AiChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

type CountPromptTokens = (messages: BotPromptMessage[]) => number;
let qwenCounter: Promise<CountPromptTokens | null> | undefined;

// See docs/book-bot.md#answer-context. An alias can select either Qwen3.6 or ToolSpace.
export async function bookBotPromptTokenCounter(model: string): Promise<CountPromptTokens | null> {
  if (!/(?:^|[/_:-])(?:qwen3\.?6\b|toolspace-35b-a3b\b)/i.test(model)) return null;
  qwenCounter ??= Promise.all([
    import('@huggingface/tokenizers'),
    readFile(new URL('./assets/qwen3.6-tokenizer.json.gz', import.meta.url)).then(promisify(gunzip)),
  ]).then(([{ Tokenizer }, bytes]): CountPromptTokens => {
    const tokenizer = new Tokenizer(JSON.parse(bytes.toString('utf8')), {});
    return (messages) => {
      const prompt = messages.map((message) => {
        const content = message.content?.trim() ?? '';
        if (message.role === 'tool') return `<|im_start|>user\n<tool_response>\n${content}\n</tool_response><|im_end|>\n`;
        const calls = message.role === 'assistant'
          ? '\n' + message.tool_calls.map((call) => `<tool_call>\n${JSON.stringify(call)}\n</tool_call>`).join('\n') : '';
        return `<|im_start|>${message.role}\n${content}${calls}<|im_end|>\n`;
      }).join('') + '<|im_start|>assistant\n<think>\n';
      return tokenizer.encode(prompt, { add_special_tokens: false }).ids.length;
    };
  }).catch(() => {
    console.warn('[book-bot] Qwen tokenizer unavailable. Using the byte estimate.');
    return null;
  });
  return qwenCounter;
}
