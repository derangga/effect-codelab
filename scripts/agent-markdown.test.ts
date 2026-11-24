import { expect, test } from "vitest";
import { toAgentMarkdown } from "./agent-markdown";

const options = {
  siteUrl: "https://example.test",
  pageUrl: "https://example.test/learn/t/01-a",
};

const page = (body: string, frontmatter = "title: Chapter\nsummary: One line.") =>
  `---\n${frontmatter}\n---\n\n${body}\n`;

test("frontmatter becomes a title and a summary line", () => {
  expect(toAgentMarkdown(page("Body."), options)).toBe(
    "# Chapter\n\nOne line.\n\nBody.\n",
  );
});

test("a draft has no output", () => {
  expect(
    toAgentMarkdown(page("Body.", "title: X\ndraft: true"), options),
  ).toBeUndefined();
});

test("a demo fence becomes a note that names the demo and the page", () => {
  const out = toAgentMarkdown(page("```demo lock\n```"), options)!;
  expect(out).not.toContain("```");
  expect(out).toContain('Interactive demo "lock"');
  expect(out).toContain(options.pageUrl);
});

test("a site link points at the md, and keeps its fragment", () => {
  const out = toAgentMarkdown(
    page("See [a](/learn/t/02-b) and [c](/learn/t/03-c#why) and [d](https://x.test/y)."),
    options,
  )!;
  expect(out).toContain("[a](https://example.test/learn/t/02-b.md)");
  expect(out).toContain("[c](https://example.test/learn/t/03-c.md#why)");
  expect(out).toContain("[d](https://x.test/y)");
});

test("a link inside a code fence is left as written", () => {
  const fence = "```md\n[a](/learn/t/02-b)\n```";
  expect(toAgentMarkdown(page(fence), options)).toContain(fence);
});
