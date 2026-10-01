import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig } from "fumadocs-mdx/config";
import { transformerTwoslash } from "@shikijs/twoslash";
import ts from "typescript";

// Twoslash compiles snippets against the app's own tsconfig-ish settings.
// Effect needs `strict`. Without it the E/R channels infer wrong and the
// chapters would teach types the reader will never see in their own project.
const twoslashCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
  // vite/client is what makes `import.meta.env` real in snippets. Without it
  // the browser Config chapter renders a red squiggle on the line it teaches.
  types: ["vite/client"],
  baseUrl: ".",
  paths: { "@/*": ["./src/*"] },
};

// Mermaid strips anything that looks like a tag from a label, so a label like
// Effect<A, E, R> renders as "Effect". Its own escape is a numeric entity.
// Rewrite only inside quoted labels, because the > in an arrow like --> must
// survive.
function escapeMermaidLabels(source: string) {
  return source.replace(
    /"([^"]*)"/g,
    (_, label: string) =>
      `"${label.replaceAll("<", "#60;").replaceAll(">", "#62;")}"`,
  );
}

// A .md chapter cannot hold JSX: the compiler leaves <Tabs> as plain text.
// Nodes a plugin creates are fine, which is how the mermaid fence works, so
// tabs are written as a run of "#### Tab: Name" sections instead. Each section
// runs until the next heading of depth 4 or less, and a heading that is not a
// "Tab:" one closes the group. Running before Fumadocs' own plugins keeps the
// "Tab:" headings out of the table of contents.
const textOf = (node: any): string =>
  node.value ?? (node.children ?? []).map(textOf).join("");

const tabLabel = (node: any): string | undefined =>
  node.type === "heading" && node.depth === 4
    ? /^Tab: (.+)$/.exec(textOf(node))?.[1]
    : undefined;

const jsxAttr = (name: string, value: any) => ({
  type: "mdxJsxAttribute",
  name,
  value,
});

const jsxElement = (name: string, attributes: any[], children: any[]) => ({
  type: "mdxJsxFlowElement",
  name,
  attributes,
  children,
});

function remarkTabs() {
  return (tree: any) => {
    const nodes: any[] = tree.children;
    const out: any[] = [];
    for (let i = 0; i < nodes.length; ) {
      if (tabLabel(nodes[i]) === undefined) {
        out.push(nodes[i++]);
        continue;
      }
      const tabs: Array<{ label: string; children: any[] }> = [];
      while (i < nodes.length) {
        const label = tabLabel(nodes[i]);
        if (label !== undefined) tabs.push({ label, children: [] });
        else if (nodes[i].type === "heading" && nodes[i].depth <= 4) break;
        else tabs[tabs.length - 1].children.push(nodes[i]);
        i++;
      }
      const labels = tabs.map((tab) => tab.label);
      const items = {
        type: "mdxJsxAttributeValueExpression",
        value: JSON.stringify(labels),
        data: {
          estree: {
            type: "Program",
            sourceType: "module",
            body: [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "ArrayExpression",
                  elements: labels.map((value) => ({ type: "Literal", value })),
                },
              },
            ],
          },
        },
      };
      out.push(
        jsxElement(
          "Tabs",
          [jsxAttr("items", items)],
          tabs.map((tab) =>
            jsxElement("Tab", [jsxAttr("value", tab.label)], tab.children),
          ),
        ),
      );
    }
    tree.children = out;
  };
}

// rehypeCode is always the first rehype plugin, so a mermaid fence would be
// syntax highlighted before any rehype pass of ours could claim it. Taking it
// at the remark stage gets there first.
function remarkMermaid() {
  const walk = (node: any) => {
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child: any, i: number) => {
      if (child.type === "code" && child.lang === "mermaid") {
        node.children[i] = {
          type: "mdxJsxFlowElement",
          name: "Mermaid",
          attributes: [
            {
              type: "mdxJsxAttribute",
              name: "chart",
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
    if (node.tagName === "pre") node.properties["data-twoslash-popup"] = "";
    for (const child of node.children ?? []) mark(child);
  };
  const walk = (node: any) => {
    // hast spells it className, shiki and twoslash emit a raw class string
    const raw = node.properties?.className ?? node.properties?.class;
    const classes = Array.isArray(raw) ? raw.join(" ") : String(raw ?? "");
    if (classes.split(/\s+/).includes("twoslash-popup-code")) mark(node);
    else for (const child of node.children ?? []) walk(child);
  };
  return (tree: any) => walk(tree);
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [remarkTabs, ...v, remarkMermaid],
    rehypePlugins: (v) => [...v, rehypeMarkTwoslashPopups],
    rehypeCodeOptions: {
      // Catppuccin, matching the site's Latte/Macchiato UI theme.
      themes: { light: "catppuccin-latte", dark: "catppuccin-macchiato" },
      // shiki cannot lazy load languages inside twoslash output, so the ones
      // the chapters use are loaded up front.
      langs: ["js", "jsx", "ts", "tsx"],
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
            filterNode: (node) => node.type !== "hover",
          },
          // `^?` renders as a block under the line instead of an absolutely
          // positioned popup. The popup is clipped by the code block's own
          // horizontal scrolling, and a reader should not have to hover to
          // see the type the chapter is making a point about.
          rendererRich: { queryRendering: "line" },
        }),
      ],
    },
  },
});
