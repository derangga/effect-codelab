import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { basicEffectRedirects } from "../src/lib/basic-effect-redirects.ts";

const clientDir = join(import.meta.dirname, "..", "dist", "client");

/**
 * The old basic-effect urls, as both a meta-refresh page and a `_redirects`
 * rule. The rule is what Cloudflare serves; the html is the fallback for
 * anything serving this directory without reading `_redirects`.
 */
const rules: Array<string> = [];

for (const [fromSlug, toSlug] of Object.entries(basicEffectRedirects)) {
  const from = `/learn/basic-effect/${fromSlug}`;
  const to = `/learn/basic-effect/${toSlug}`;
  const outputDir = join(clientDir, "learn", "basic-effect", fromSlug);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${to}">
  <link rel="canonical" href="${to}">
  <title>Moved</title>
</head>
<body>
  <p>This chapter moved to <a href="${to}">${to}</a>.</p>
</body>
</html>
`,
  );

  rules.push(`${from} ${to} 301`);
  rules.push(`${from}/ ${to} 301`);
}

await writeFile(join(clientDir, "_redirects"), `${rules.join("\n")}\n`);

/**
 * The prerenderer writes /404 as `404/index.html`, but Cloudflare's
 * `not_found_handling: "404-page"` looks for `404.html` at the root. One copy
 * is cheaper than teaching the prerenderer a special case.
 */
await copyFile(
  join(clientDir, "404", "index.html"),
  join(clientDir, "404.html"),
);
