const PAGE_TARGET = '#pdfit-bot-page-';
const PDF_CITATION = /\[\s*(?:PDF\s+)?p{1,2}\.\s*(\d+)(?:\s*[-–—]\s*\d+)?\s*\]|(?<![A-Za-z0-9_])(?:PDF\s+)?p{1,2}\.\s*(\d+)(?![A-Za-z0-9_]|\.\d)|\bPDF\s+(?:pages?\s*(\d+)|(\d+)\s*(?:페이지|쪽))/gi;

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

/** Link explicit PDF page citations in Markdown prose, including lists and emphasized text. */
export function remarkPdfPageCitations() {
  function replaceCitations(node: MarkdownNode): void {
    if (!node.children || /^(link|linkReference|image|imageReference)$/.test(node.type)) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || child.value === undefined) {
        replaceCitations(child);
        return [child];
      }
      const text = child.value;
      const parts: MarkdownNode[] = [];
      let consumed = 0;
      for (const match of text.matchAll(PDF_CITATION)) {
        const page = Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
        if (!Number.isSafeInteger(page) || page < 1 || page > 2_147_483_647) continue;
        const start = match.index;
        if (start > consumed) parts.push({ type: 'text', value: text.slice(consumed, start) });
        parts.push({ type: 'link', url: `${PAGE_TARGET}${page}`, children: [{ type: 'text', value: match[0] }] });
        consumed = start + match[0].length;
      }
      if (!parts.length) return [child];
      if (consumed < text.length) parts.push({ type: 'text', value: text.slice(consumed) });
      return parts;
    });
  }
  return replaceCitations;
}

export function pdfPageFromCitation(href: string | undefined): number | null {
  if (!href?.startsWith(PAGE_TARGET)) return null;
  const value = href.slice(PAGE_TARGET.length);
  const page = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(page) ? page : null;
}
