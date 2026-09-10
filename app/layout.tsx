import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Geist_Mono,
  Lora,
  Playfair_Display,
  Inter,
  Archivo_Black,
  Plus_Jakarta_Sans,
} from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["200","300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The Jooma V2 brand face, used by the marketing landing page. Three weights
// only — 400, 600, 800 — per the brand bible; there is no 500 or 700 and no
// italic outside a pull quote. `next/font` self-hosts it at build time, which
// is what the handover asks for (speed, and no Google Fonts CDN request from a
// visitor's browser).
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "600", "800"],
});

// Slideshow theme fonts — referenced by name in the slide renderers
// (`makeText` picks `theme.fonts.heading` / `theme.fonts.body` as the CSS
// font-family). Without these `next/font` imports the browser silently
// falls back to the same system serif/sans for every theme and theme
// switching has no visible font effect.
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin"],
  weight: ["400"],
});

/* metadataBase is what makes every relative URL below resolve absolutely, which
 * is what a crawler and a social card need. Without it Next emits paths and
 * Google is left to guess the host.
 *
 * The icons here are the same files Next already picks up by convention from
 * app/favicon.ico and app/apple-icon.png. Declaring them changes nothing a
 * browser does; it states the intent, and it is the hook for anything that
 * needs an explicit apple-touch-icon.
 *
 * The site icon Google shows in a search result comes from its own crawl and
 * cache, not from this file, so a stale icon there outlives a deploy. The
 * Organization block on the landing page is the signal that actually names our
 * logo; see app/page.tsx. */
export const metadata: Metadata = {
  metadataBase: new URL("https://www.jooma.ai"),
  title: "Jooma",
  description: "Teaching resources, made in about a minute",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Jooma",
    url: "/",
    title: "Jooma",
    description: "Teaching resources, made in about a minute",
    images: [{ url: "/logo/Jooma-logo-v2-round-light-1024.png", width: 1024, height: 1024, alt: "Jooma" }],
  },
};

/* Without this, mobile browsers render at a ~980px virtual viewport and zoom
 * out — so every sm:/md:/lg: class in the app resolved to its DESKTOP branch on
 * a phone, and the whole product rendered as a shrunken desktop page rather
 * than a mobile one. This is what makes the breakpoints real.
 *
 * No maximumScale/userScalable: pinch-zoom is an accessibility requirement,
 * not a layout bug to suppress. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${bricolage.variable} ${geistMono.variable} ${lora.variable} ${playfair.variable} ${inter.variable} ${archivoBlack.variable} ${jakarta.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col" style={{ backgroundColor: "var(--j-bg)" }} suppressHydrationWarning>
        <NextTopLoader color="#5B2ED6" showSpinner={false} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
