/**
 * A page opened as `https://user:pass@host/` (HTTP Basic credentials in the address) keeps
 * those credentials in `document.baseURI`, although `location.href` drops them. Every
 * relative `fetch('/api/...')` is resolved against that base, and `fetch` rejects any
 * request URL that carries credentials, so no API request is ever sent.
 *
 * Declaring the same URL without credentials as the document base fixes the resolution only:
 * the browser keeps authenticating from its own HTTP auth cache after the first 401 challenge.
 * Pages without credentials in the address are left untouched.
 *
 * Scope: key = the document, lifetime = the page, bound = at most one injected `<base>`,
 * cleared when the page unloads.
 */
export function ensureCredentialFreeBase(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!doc?.head) return false;
  let base: URL;
  try { base = new URL(doc.baseURI); } catch { return false; }
  if (!base.username && !base.password) return false;
  base.username = '';
  base.password = '';
  base.hash = '';
  const element = doc.createElement('base');
  element.setAttribute('href', base.href);
  doc.head.prepend(element);
  return true;
}
