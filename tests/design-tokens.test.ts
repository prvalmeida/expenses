import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Dark mode follows the device, which is only safe while every surface paints a design
// token. A single raw palette class (`bg-white`, `text-gray-500`, `bg-blue-500`) renders
// the same in both palettes, so in dark mode it reproduces the bug this app once shipped:
// a white card whose inherited text has turned near-white. This test is the guard — use
// the tokens (`bg-surface-1`, `text-ink-muted`, `bg-accent`, …) from app/globals.css.

const ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components'];
// Route handlers render no UI. Anchored to app/api so a UI folder named `api` is scanned.
const SKIPPED = new Set(['app/api']);
const SOURCE = /\.(?:[cm]?[jt]sx?|mdx|css)$/;

const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY = 'bg|text|border(?:-[trblxy])?|ring|ring-offset|divide|outline|from|via|to|fill|stroke|placeholder|decoration|caret|accent|shadow';
const RAW_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:${UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
  'g'
);
// A colour written into the class itself (`bg-[#fff]`, `text-[color:white]`,
// `shadow-[0_0_0_1px_rgb(0,0,0)]`) is just as fixed as a palette class. No `\b` before the
// function: `_` is a word character, so it would miss `1px_rgb(`.
const CSS_COLOUR = `#[0-9a-fA-F]{3,8}\\b|(?<![a-zA-Z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\\(|color:(?:${PALETTE}|grey)\\b`;
const ARBITRARY_CLASS = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTILITY})-\\[[^\\]\\s]*?(?:${CSS_COLOUR})[^\\]\\s]*\\]`, 'g');
// Outside a class: inline styles and SVG attributes (`style={{ background: '#fff' }}`,
// `fill="white"`, `color: 'rgb(0 0 0)'`).
const COLOUR_LITERAL = new RegExp(
  `['"\`]\\s*(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\()` +
    `|\\b(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left)?Color|outlineColor|caretColor|accentColor|stopColor|fill|stroke)\\s*[:=]\\s*\\{?\\s*['"](?:${PALETTE}|grey)['"]`,
  'g'
);
const DARK_VARIANT = /(?<![\w-])dark:[a-z]/;

// Fixed colours are allowed only between `design-tokens: allow` and `design-tokens: end`
// comments, and only in the files listed here, so each exception is a few marked lines
// rather than a whole file.
const ALLOWED_REGIONS = new Set([
  // The camera overlay draws on top of a live video feed, not on an app surface: white
  // on near-black is correct in both palettes.
  'components/QrScannerModal.tsx',
  // The theme-color meta tag cannot read a CSS variable; it repeats surface-0 per scheme.
  'app/layout.tsx',
]);
const ALLOW_START = /design-tokens: allow\b/;
const ALLOW_END = /design-tokens: end\b/;

type Line = { at: string; text: string; allowed: boolean };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIPPED.has(posix(path)) ? [] : sourceFiles(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

// Reported and allowlisted by POSIX path; on Windows `relative` returns backslashes.
function posix(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

// In CSS only `@apply` lines carry classes; the rest of globals.css is where the token
// values themselves are defined.
function scannedLines(rel: string, text: string): string[] {
  const lines = text.split(/\r?\n/);
  return rel.endsWith('.css') ? lines.map(line => (/@apply\b/.test(line) ? line : '')) : lines;
}

// Walked and read once, shared by every test below.
const FILES = SCANNED.flatMap(d => sourceFiles(join(ROOT, d))).map(file => {
  const rel = posix(file);
  const region = { open: null as number | null, markers: 0 };
  const lines: Line[] = scannedLines(rel, readFileSync(file, 'utf8')).map((text, i) => {
    const at = `${rel}:${i + 1}`;
    if (ALLOW_START.test(text) || ALLOW_END.test(text)) {
      region.open = ALLOW_START.test(text) ? i + 1 : null;
      region.markers++;
      return { at, text: '', allowed: true };
    }
    return { at, text, allowed: region.open !== null };
  });
  return { rel, lines, ...region };
});
const LINES = FILES.flatMap(f => f.lines);

test('UI code uses design tokens, never raw Tailwind palette classes', () => {
  const offenders = LINES.filter(l => !l.allowed).flatMap(l =>
    [...l.text.matchAll(RAW_CLASS)].map(([match]) => `${l.at} ${match}`)
  );
  assert.deepEqual(offenders, [], `Raw palette classes found — use the tokens in app/globals.css:\n${offenders.join('\n')}`);
});

test('no fixed colours in arbitrary classes, inline styles or SVG attributes', () => {
  const offenders = LINES.filter(l => !l.allowed).flatMap(l =>
    [...l.text.matchAll(ARBITRARY_CLASS), ...l.text.matchAll(COLOUR_LITERAL)].map(([match]) => `${l.at} ${match}`)
  );
  assert.deepEqual(offenders, [], `Fixed colours found — use the tokens in app/globals.css:\n${offenders.join('\n')}`);
});

test('no dark: variants — the palette switches through the tokens, not per class', () => {
  const offenders = LINES.filter(l => DARK_VARIANT.test(l.text)).map(l => l.at);
  assert.deepEqual(offenders, []);
});

test('allow regions are closed and only appear in the listed files', () => {
  const problems = FILES.flatMap(({ rel, open, markers }) => [
    ...(markers > 0 && !ALLOWED_REGIONS.has(rel) ? [`${rel}: allow region in a file not in ALLOWED_REGIONS`] : []),
    ...(open !== null ? [`${rel}:${open}: allow region never closed`] : []),
  ]);
  assert.deepEqual(problems, []);
});
