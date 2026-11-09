import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Create the root .env from .env.example on first run. Docker Compose rejects
// the whole file when any line is not a comment, blank, or KEY=VALUE, so such
// lines are dropped (and reported) instead of being copied verbatim.
if (!existsSync('.env')) {
  const lines = readFileSync('.env.example', 'utf8').split(/\r?\n/);
  const valid = lines.filter((line) => /^\s*(#.*)?$/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(line));
  writeFileSync('.env', valid.join('\n'), 'utf8');
  console.log('created root .env from .env.example');
  const dropped = lines.length - valid.length;
  if (dropped > 0) console.warn(`[pdfit] skipped ${dropped} invalid line(s) from .env.example`);
}
