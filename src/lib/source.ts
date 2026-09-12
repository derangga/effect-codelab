import { llms, loader } from 'fumadocs-core/source';
import { pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { statusBadgesPlugin } from 'fumadocs-core/source/plugins/status-badges';
import { z } from 'zod';
import { readingMinutes } from './reading-minutes';
import { themeGroupingPlugin } from './theme-tree';
import { docsRoute } from './shared';

export const docs = defineDocs({
  dir: 'content',
  docs: {
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // The schema is handed the raw file, so reading time is computed here
    // rather than from compiled output. This keeps the estimate available to
    // page headers and catalog cards without compiling every chapter first.
    //
    // unknown frontmatter keys are dropped silently without an explicit schema
    schema: ({ source }) =>
      pageSchema.extend({
        order: z.number().optional(),
        slug: z.string().optional(),
        summary: z.string().optional(),
        draft: z.boolean().optional(),
        theme: z.string().optional(),
        level: z.string().optional(),
        prereq: z.string().optional(),
      }).transform((frontmatter) => ({
        ...frontmatter,
        minutes: readingMinutes(source),
        // The chapters spell it `summary`. Fumadocs renders `description`
        // under the title and indexes it for search, so without this the 32
        // authored summaries are dead data and every page has a blank
        // subtitle.
        description: frontmatter.description ?? frontmatter.summary,
        // statusBadgesPlugin badges any page whose data carries a `status`
        // string. The chapters spell it `draft: true`, so the mapping happens
        // here rather than across 12 frontmatter blocks.
        status: frontmatter.draft ? 'Draft' : undefined,
      })),
  },
  meta: {
    // content/themes.json is a top-level array, not a fumadocs meta file
    files: ['**/meta.json'],
  },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  // statusBadgesPlugin wraps the sidebar label in JSX. serializePageTree runs
  // every `name` through renderToString, so the badge crosses the server
  // boundary as HTML and the client re-inflates it. Styled in app.css off the
  // `data-status` attribute the default badge writes.
  plugins: [
    lucideIconsPlugin(),
    themeGroupingPlugin(),
    statusBadgesPlugin(),
  ],
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});
