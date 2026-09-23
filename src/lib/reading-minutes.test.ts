import { expect, test } from 'vitest';
import { readingMinutes } from './reading-minutes';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
const fence = (lines: number) =>
  ['```ts', ...Array.from({ length: lines - 2 }, () => 'const a = 1'), '```'].join('\n');

test('prose counts at 200 words a minute', () => {
  expect(readingMinutes(words(400))).toBe(2);
});

test('code counts by the line, not by the word', () => {
  // 30 lines at 15 a minute, and each line is 4 words, which as prose would
  // round to a single minute instead
  expect(readingMinutes(fence(30))).toBe(2);
});

test('a page is never less than a minute', () => {
  expect(readingMinutes('')).toBe(1);
  expect(readingMinutes('One short line.')).toBe(1);
});

test('frontmatter is not part of the reading', () => {
  const page = `---\nsummary: ${words(400)}\n---\n\nOne short line.\n`;
  expect(readingMinutes(page)).toBe(1);
});

test('hidden twoslash setup above a cut is not read', () => {
  const hidden = Array.from({ length: 60 }, () => 'const a = 1');
  const block = ['```ts twoslash', ...hidden, '// ---cut---', 'const b = 2', '```'].join('\n');
  expect(readingMinutes(block)).toBe(1);
});
