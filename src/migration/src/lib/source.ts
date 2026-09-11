import { llms, loader } from 'fumadocs-core/source';
import { pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { z } from 'zod';
import { docsRoute } from './shared';

export const docs = defineDocs({
  // the course content stays at the repo root, shared with the old app
  dir: '../../content',
  docs: {
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // unknown frontmatter keys are dropped silently without an explicit schema
    schema: pageSchema.extend({
      order: z.number().optional(),
      slug: z.string().optional(),
      summary: z.string().optional(),
      draft: z.boolean().optional(),
      theme: z.string().optional(),
      level: z.string().optional(),
      prereq: z.string().optional(),
    }),
  },
  meta: {
    // content/themes.json is a top-level array, not a fumadocs meta file
    files: ['**/meta.json'],
  },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});
