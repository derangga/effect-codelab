/**
 * Estimate reading time from raw file content: prose at 200 words a minute,
 * fenced code at 15 lines a minute, never less than one minute.
 *
 * This runs in the collection schema, which is handed the file before
 * frontmatter is parsed, so the frontmatter block is stripped here.
 */
export function readingMinutes(source: string) {
 const markdown = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
 const fences = [...markdown.matchAll(/^```[\s\S]*?^```$/gm)];
 const codeLines = fences.reduce(
  (total, [block]) => total + block.split("\n").length,
  0,
 );
 const prose = markdown.replace(/^```[\s\S]*?^```$/gm, " ");
 const words = prose.split(/\s+/).filter(Boolean).length;

 return Math.max(1, Math.ceil(words / 200 + codeLines / 15));
}
