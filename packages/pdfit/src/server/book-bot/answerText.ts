const CONTROL_MARKERS = ['<tool_call>', '</tool_call>', '<function='];

export function hasBookBotControlText(text: string): boolean {
  const lower = text.toLowerCase();
  return CONTROL_MARKERS.some((marker) => lower.includes(marker));
}

export function assertBookBotAnswerText(text: string): void {
  if (hasBookBotControlText(text)) {
    throw Object.assign(new Error('The model returned tool markup in the book reply.'), { code: 'unexpected_tool_markup' });
  }
}

export function filterBookBotAnswerDeltas(emit: (text: string) => void) {
  let pending = '';
  return {
    write(chunk: string): void {
      const text = pending + chunk;
      assertBookBotAnswerText(text);
      const lastOpening = text.lastIndexOf('<');
      const suffix = lastOpening < 0 ? '' : text.slice(lastOpening).toLowerCase();
      const cut = suffix && CONTROL_MARKERS.some((marker) => marker.startsWith(suffix)) ? lastOpening : text.length;
      pending = text.slice(cut);
      if (cut) emit(text.slice(0, cut));
    },
    flush(): void {
      if (pending) emit(pending);
      pending = '';
    },
  };
}
