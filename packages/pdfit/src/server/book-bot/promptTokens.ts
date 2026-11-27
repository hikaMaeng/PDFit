import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

export type BotTextMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type BotPromptMessage = BotTextMessage
  | { role: 'assistant'; content: null; tool_calls: [{ id: string; type: 'function'; function: { name: string; arguments: '{}' } }] }
  | { role: 'tool'; tool_call_id: string; content: string };

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
        const { role, content } = message;
        if (role === 'tool') {
          return `<|im_start|>user\n<tool_response>\n${content.trim()}\n</tool_response><|im_end|>\n`;
        }
        const previousAnswer = role === 'assistant' ? '<think>\n\n</think>\n\n' : '';
        const body = 'tool_calls' in message
          ? `<tool_call>\n<function=${message.tool_calls[0].function.name}>\n</function>\n</tool_call>`
          : message.content.trim();
        return `<|im_start|>${role}\n${previousAnswer}${body}<|im_end|>\n`;
      }).join('') + '<|im_start|>assistant\n<think>\n';
      return tokenizer.encode(prompt, { add_special_tokens: false }).ids.length;
    };
  }).catch(() => {
    console.warn('[book-bot] Qwen tokenizer unavailable. Using the byte estimate.');
    return null;
  });
  return qwenCounter;
}
