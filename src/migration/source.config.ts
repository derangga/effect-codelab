import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { defineConfig } from 'fumadocs-mdx/config';
import { transformerTwoslash } from '@shikijs/twoslash';
import ts from 'typescript';

// Twoslash compiles snippets against the app's own tsconfig-ish settings.
// Effect needs `strict`. Without it the E/R channels infer wrong and the
// chapters would teach types the reader will never see in their own project.
const twoslashCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  // vite/client is what makes `import.meta.env` real in snippets. Without it
  // the browser Config chapter renders a red squiggle on the line it teaches.
  types: ['vite/client'],
};

// Mermaid strips anything that looks like a tag from a label, so a label like
// Effect<A, E, R> renders as "Effect". Its own escape is a numeric entity.
// Rewrite only inside quoted labels, because the > in an arrow like --> must
// survive.
function escapeMermaidLabels(source: string) {
  return source.replace(
    /"([^"]*)"/g,
    (_, label: string) =>
      `"${label.replaceAll('<', '#60;').replaceAll('>', '#62;')}"`,
  );
}

// rehypeCode is always the first rehype plugin, so a mermaid fence would be
// syntax highlighted before any rehype pass of ours could claim it. Taking it
// at the remark stage gets there first.
function remarkMermaid() {
  const walk = (node: any) => {
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child: any, i: number) => {
      if (child.type === 'code' && child.lang === 'mermaid') {
        node.children[i] = {
          type: 'mdxJsxFlowElement',
          name: 'Mermaid',
          attributes: [
            {
              type: 'mdxJsxAttribute',
              name: 'chart',
              value: escapeMermaidLabels(child.value),
            },
          ],
          children: [],
        };
      } else walk(child);
    });
  };
  return (tree: any) => walk(tree);
}

// Twoslash renders a type reveal as its own <pre> inside the popup. Fumadocs
// maps every <pre> to a CodeBlock, which would put a bordered figure and a
// copy button inside the reveal. Mark those so the MDX `pre` component can
// render them bare.
function rehypeMarkTwoslashPopups() {
  const mark = (node: any) => {
    if (node.tagName === 'pre') node.properties['data-twoslash-popup'] = '';
    for (const child of node.children ?? []) mark(child);
  };
  const walk = (node: any) => {
    // hast spells it className, shiki and twoslash emit a raw class string
    const raw = node.properties?.className ?? node.properties?.class;
    const classes = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '');
    if (classes.split(/\s+/).includes('twoslash-popup-code')) mark(node);
    else for (const child of node.children ?? []) walk(child);
  };
  return (tree: any) => walk(tree);
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [...v, remarkMermaid],
    rehypePlugins: (v) => [...v, rehypeMarkTwoslashPopups],
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark' },
      // shiki cannot lazy load languages inside twoslash output, so the ones
      // the chapters use are loaded up front.
      langs: ['js', 'jsx', 'ts', 'tsx'],
      transformers: [
        // appended rather than replacing: the defaults carry notation
        // highlight, word highlight, diff and focus.
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash({
          // Only blocks tagged ```ts twoslash are compiled. Not every snippet
          // is standalone-compilable; opting in per block keeps the build
          // honest instead of forcing every example to be a whole file.
          explicitTrigger: true,
          twoslashOptions: {
            compilerOptions: twoslashCompilerOptions,
            // Drop hover popups. They are a twoslash default, not something
            // this course needs: the popup is absolutely positioned and gets
            // clipped by the code block it lives in, and a type worth teaching
            // should be pinned with `^?` rather than hidden behind a hover.
            // Filtering the nodes also removes the dotted underlines, which
            // otherwise advertise an interaction that no longer does anything.
            filterNode: (node) => node.type !== 'hover',
          },
          // `^?` renders as a block under the line instead of an absolutely
          // positioned popup. The popup is clipped by the code block's own
          // horizontal scrolling, and a reader should not have to hover to
          // see the type the chapter is making a point about.
          rendererRich: { queryRendering: 'line' },
        }),
      ],
    },
  },
});
