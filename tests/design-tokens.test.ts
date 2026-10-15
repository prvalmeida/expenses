import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Dark mode follows the device, which is only safe while every surface paints a design
// token. A single raw palette class (`bg-white`, `text-gray-500`, `bg-blue-500`) renders
// the same in both palettes, so in dark mode it reproduces the bug this app once shipped:
// a white card whose inherited text has turned near-white. This test is the guard — use
// the tokens (`bg-surface-1`, `text-ink-muted`, `bg-accent`, …) from app/globals.css.

const ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components'];

const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const RAW_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|divide|outline|from|via|to|fill|stroke|placeholder|decoration|caret|accent|shadow)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
  'g'
);

// The camera overlay draws on top of a live video feed, not on an app surface: white on
// near-black is correct in both palettes.
const ALLOWED: Record<string, RegExp> = {
  'components/QrScannerModal.tsx': /^(?:bg-black\/90|border-white|text-white)$/,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'api' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('UI code uses design tokens, never raw Tailwind palette classes', () => {
  const offenders: string[] = [];
  for (const file of SCANNED.flatMap(d => sourceFiles(join(ROOT, d)))) {
    const rel = relative(ROOT, file);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const [match] of line.matchAll(RAW_CLASS)) {
        const bare = match.replace(/^(?:[a-z-]+:)+/, '');
        if (ALLOWED[rel]?.test(bare)) continue;
        offenders.push(`${rel}:${i + 1} ${match}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `Raw palette classes found — use the tokens in app/globals.css:\n${offenders.join('\n')}`);
});

test('no dark: variants — the palette switches through the tokens, not per class', () => {
  const offenders: string[] = [];
  for (const file of SCANNED.flatMap(d => sourceFiles(join(ROOT, d)))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/(?<![\w-])dark:[a-z]/.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
