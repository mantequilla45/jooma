import type { MetadataRoute } from "next";

/**
 * Served at /robots.txt.
 *
 * There was no robots.txt at all, so that path fell through to the catch-all
 * and returned the app's HTML. A crawler asking what it may fetch was handed a
 * login page.
 *
 * The `disallow` list is the private half of the route tree. None of it is
 * reachable signed out anyway (the proxy bounces to /login), so this changes no
 * permissions; it stops crawlers spending requests on URLs that can only
 * redirect, and keeps them out of the API surface.
 *
 * `sitemap` is how the sitemap gets discovered without anybody submitting it by
 * hand, which matters here because the Search Console property was only just
 * verified.
 */
export default function robots(): MetadataRoute.Robots {
  const base = "https://www.jooma.ai";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        // Auth plumbing: nothing to read, and several of these carry
        // single-use tokens in the query string that have no business in a
        // search index.
        "/auth/",
        "/verify",
        "/create-password",
        "/complete-profile",
        // Behind a session.
        "/admin",
        "/dashboard",
        "/profile",
        "/tools/",
        "/editor",
        "/library",
        "/colleagues",
        "/assistant",
        "/welcome",
        "/announcements",
        // A redirect, not a page. See app/pricing/page.tsx.
        "/pricing",
        // A test fixture, and the holding page.
        "/sentry-example-page",
        "/maintenance",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
