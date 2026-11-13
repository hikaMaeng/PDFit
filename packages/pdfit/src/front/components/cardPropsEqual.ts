/**
 * `React.memo` comparator for library rows and cover cards.
 *
 * A library page passes every handler as an inline arrow, so a plain shallow compare
 * never matches and each mounted card re-renders on every parent commit. With a long
 * list that turns list growth into quadratic work — 600 cards took over a second per
 * chunk. The data a card displays does decide what it draws, so two renders with equal
 * data and the same set of handlers produce the same output.
 *
 * A handler is compared by presence, not identity: a card re-renders when a callback
 * appears or disappears (a capability turned on or off), not when the parent rebuilds
 * the same closure. Handlers therefore keep the values captured by the last render that
 * changed the card's data; all of them act on the card's own file plus state setters,
 * so that capture is the same file either way.
 */
export function cardPropsEqual<P extends Record<string, unknown>>(previous: P, next: P): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    if (typeof before === 'function' && typeof after === 'function') continue;
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length && before.every((item, index) => Object.is(item, after[index]))) continue;
    return false;
  }
  return true;
}
