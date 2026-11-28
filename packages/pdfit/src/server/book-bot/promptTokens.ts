import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

export type BotPromptMessage = { role: 'system' | 'user'; content: string };

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
      const prompt = messages.map(({ role, content }) => `<|im_start|>${role}\n${content.trim()}<|im_end|>\n`)
        .join('') + '<|im_start|>assistant\n<think>\n';
      return tokenizer.encode(prompt, { add_special_tokens: false }).ids.length;
    };
  }).catch(() => {
    console.warn('[book-bot] Qwen tokenizer unavailable. Using the byte estimate.');
    return null;
  });
  return qwenCounter;
}
