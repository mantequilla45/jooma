import type { MetadataRoute } from "next";

/**
 * The public sitemap, served at /sitemap.xml.
 *
 * Search Console reported "Temporary processing error" under Discovery because
 * there was no sitemap at all to process. This is that file.
 *
 * ONLY PAGES A STRANGER CAN OPEN AND WOULD WANT TO FIND. That rules out most of
 * the route tree, and the exclusions are the interesting part:
 *
 *   /login, /signup, /verify, /forgot-password, /create-password,
 *   /complete-profile   auth plumbing. Public, but there is nothing to read and
 *                       nothing anybody searches for.
 *   /welcome, /announcements, /admin, and everything under (app)
 *                       behind a session; the proxy bounces a signed-out
 *                       visitor to /login, so listing them advertises URLs that
 *                       cannot be crawled.
 *   /maintenance        a holding page, only meaningful while it is on.
 *   /sentry-example-page  a test fixture.
 *   /pricing            a REDIRECT, not a page (see app/pricing/page.tsx: it
 *                       forwards to /#pricing or /profile). A sitemap that
 *                       lists a redirect is asking Google to report a problem
 *                       we already know about.
 *
 * The host comes from metadataBase in app/layout.tsx, which is www because the
 * apex 307s there. Stated once, so this file cannot drift from the canonicals.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.jooma.ai";

  return [
    {
      url: `${base}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/contact`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // The dates these two carry in their own copy ("Last updated: ...") are the
    // honest lastModified, but they are prose rather than data, so they are not
    // read here. Left off entirely rather than stamped with a build time, which
    // would tell Google every deploy changed the terms.
    {
      url: `${base}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
