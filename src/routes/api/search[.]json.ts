import { createFileRoute } from '@tanstack/react-router';
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

/**
 * The index covers the 16 finished chapters, not all 28.
 *
 * A draft is an outline with no prose yet, so a hit on one sends a reader to a
 * page that cannot answer what they searched for. buildIndex maps a page to an
 * entry and has no way to drop one, so the filter goes on the loader handed to
 * createFromSource. The sidebar still lists drafts, badged.
 */
const published = {
  ...source,
  getPages: () => source.getPages().filter((page) => page.data.draft !== true),
};

const server = createFromSource(published, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});

export const Route = createFileRoute('/api/search.json')({
  server: {
    handlers: {
      // staticGET exports the whole index as json once at build time. GET
      // answers one query per request, which needs a server this site does
      // not ship.
      GET: () => server.staticGET(),
    },
  },
});
