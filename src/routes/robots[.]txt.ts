import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${siteUrl}/sitemap.xml
`,
          { headers: { "content-type": "text/plain" } },
        ),
    },
  },
});
