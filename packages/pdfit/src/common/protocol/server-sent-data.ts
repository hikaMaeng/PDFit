const MAX_FRAME_LENGTH = 2 * 1024 * 1024;

/** Reads SSE data fields, including split UTF-8, CRLF and multi-line events. */
export async function* readServerSentData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  let dataLength = 0;
  let ended = false;
  try {
    while (!ended) {
      const chunk = await reader.read();
      ended = chunk.done;
      pending += decoder.decode(chunk.value, { stream: !ended });
      const breaks = /\r\n|\r|\n/g;
      let start = 0;
      for (let match = breaks.exec(pending); match; match = breaks.exec(pending)) {
        // A CR at the end of a chunk may be the first byte of CRLF.
        if (!ended && match[0] === '\r' && breaks.lastIndex === pending.length) break;
        const line = pending.slice(start, match.index);
        start = breaks.lastIndex;
        if (line.length > MAX_FRAME_LENGTH) throw new Error('SSE line exceeds the size limit');
        if (!line) {
          if (data.length) yield data.join('\n');
          data = [];
          dataLength = 0;
        } else if (line === 'data' || line.startsWith('data:')) {
          const value = line.slice(5).replace(/^ /, '');
          dataLength += value.length + 1;
          if (dataLength > MAX_FRAME_LENGTH) throw new Error('SSE frame exceeds the size limit');
          data.push(value);
        }
      }
      pending = pending.slice(start);
      if (pending.length > MAX_FRAME_LENGTH) throw new Error('SSE line exceeds the size limit');
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
