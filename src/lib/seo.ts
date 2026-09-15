import { appName, gitConfig, siteDescription, siteUrl } from "./shared";

/**
 * Head metadata shared by every route: title, description, canonical, OG and
 * twitter tags. The title suffix is built here because this router version
 * has no `template` support, so each route carries its full title.
 *
 * The og image is one site-wide card (public/og.png) rather than per-page
 * images; it is referenced with an absolute URL because OG requires it.
 */
export function pageHead(
  options: {
    title?: string;
    description?: string;
    path?: string;
    ogType?: "website" | "article";
  } = {},
) {
  const title = options.title ? `${options.title} | ${appName}` : appName;
  const description = options.description ?? siteDescription;
  const url = `${siteUrl}${options.path ?? "/"}`;
  const image = `${siteUrl}/og.png`;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: options.ogType ?? "website" },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

const organization = {
  "@type": "Organization",
  name: appName,
  url: siteUrl,
  sameAs: [`https://github.com/${gitConfig.user}/${gitConfig.repo}`],
};

/** WebSite + Organization nodes for the home page. */
export const homeJsonLd = [
  {
    "@type": "WebSite",
    name: appName,
    url: siteUrl,
    description: siteDescription,
    publisher: { "@id": `${siteUrl}/#organization` },
  },
  {
    ...organization,
    "@id": `${siteUrl}/#organization`,
  },
];

/**
 * TechArticle + BreadcrumbList nodes for a chapter page. The breadcrumb walks
 * Home -> track -> chapter, so the track index page must exist; chapters
 * always sit one slug under their track's index.md.
 */
export function chapterJsonLd(options: {
  title: string;
  description: string;
  url: string;
  trackTitle?: string;
  trackUrl?: string;
}) {
  const items = [{ name: appName, url: `${siteUrl}/` }];
  if (options.trackUrl) {
    items.push({
      name: options.trackTitle ?? options.trackUrl,
      url: `${siteUrl}${options.trackUrl}`,
    });
  }
  items.push({ name: options.title, url: `${siteUrl}${options.url}` });

  return [
    {
      "@type": "TechArticle",
      headline: options.title,
      description: options.description,
      url: `${siteUrl}${options.url}`,
      image: `${siteUrl}/og.png`,
      inLanguage: "en",
      author: organization,
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    },
  ];
}

/**
 * A JSON-LD node as a head script. The `<` escape keeps a description that
 * happens to contain markup from closing the script tag early.
 */
export function jsonLdScript(node: Record<string, unknown>) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(node).replace(/</g, "\\u003c"),
  };
}
