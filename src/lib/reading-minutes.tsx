import type { LoaderPlugin } from 'fumadocs-core/source';

/**
 * Estimate reading time from raw file content: prose at 200 words a minute,
 * fenced code at 15 lines a minute, never less than one minute.
 *
 * This runs in the collection schema, which is handed the file before
 * frontmatter is parsed, so the frontmatter block is stripped here.
 */
export function readingMinutes(source: string) {
  const markdown = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const fences = [...markdown.matchAll(/^```[\s\S]*?^```$/gm)];
  const codeLines = fences.reduce(
    (total, [block]) => total + block.split('\n').length,
    0,
  );
  const prose = markdown.replace(/^```[\s\S]*?^```$/gm, ' ');
  const words = prose.split(/\s+/).filter(Boolean).length;

  return Math.max(1, Math.ceil(words / 200 + codeLines / 15));
}

/**
 * Show each chapter's reading time on its sidebar item.
 *
 * Shaped like Fumadocs' own statusBadgesPlugin: the `file` hook appends to
 * `node.name`, and serializePageTree renders that to HTML, so the time is in
 * the server-rendered sidebar rather than appearing on hydration.
 *
 * index.md is skipped. Those are the 4 track rows, and their minutes count
 * only the track's own prose, which next to a chapter count reads as wrong.
 */
export function readingTimePlugin(): LoaderPlugin {
  return {
    name: 'reading-time',
    transformPageTree: {
      file(node, filePath) {
        if (!filePath || filePath.endsWith('index.md')) return node;
        const file = this.storage.read(filePath);
        if (file?.format !== 'page') return node;

        const { minutes } = file.data as { minutes?: number };
        if (typeof minutes !== 'number') return node;

        node.name = (
          <>
            {node.name}
            <span data-minutes="">{`${minutes} min`}</span>
          </>
        );
        return node;
      },
    },
  };
}
