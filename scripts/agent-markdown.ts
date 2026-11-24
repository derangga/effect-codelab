import matter from "gray-matter";

/**
 * Turns a chapter's source into the plain markdown an agent reads at
 * `<chapter>.md`. Returns undefined for a draft, which has no prose yet.
 *
 * Three changes from the source:
 * - frontmatter becomes a title and a one-line summary
 * - a `demo` fence has no text, so it becomes a note saying the demo only runs
 *   in the browser
 * - a site link points at the `.md` of its target, so following it returns
 *   text and not the html page
 *
 * Fences are split out first so a link inside a code sample stays as written.
 */
export function toAgentMarkdown(
  source: string,
  options: { siteUrl: string; pageUrl: string },
): string | undefined {
  const { data, content } = matter(source);
  if (data.draft === true) return undefined;

  const body = content
    .split(/(^```[\s\S]*?^```$)/gm)
    .map((part, index) =>
      index % 2 === 1
        ? rewriteDemo(part, options.pageUrl)
        : part.replace(
            /\]\((\/learn\/[^)\s#]*)(#[^)\s]*)?\)/g,
            (_, path: string, hash = "") =>
              `](${options.siteUrl}${path}.md${hash})`,
          ),
    )
    .join("");

  const summary = data.summary ?? data.description;
  return `# ${data.title}\n\n${summary ? `${summary}\n\n` : ""}${body.trimStart()}`;
}

function rewriteDemo(fence: string, pageUrl: string) {
  const name = /^```demo (\S+)\n```$/.exec(fence)?.[1];
  return name === undefined
    ? fence
    : `> Interactive demo "${name}". It runs only in the browser at ${pageUrl}. You cannot run it, so ask the learner what they see.`;
}
