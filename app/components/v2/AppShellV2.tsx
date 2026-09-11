"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import SideNavV2 from "@/app/components/v2/SideNavV2";
import TopBarV2 from "@/app/components/v2/TopBarV2";
import SupportLauncher from "@/app/components/SupportLauncher";
import AnnouncementBanner from "@/app/components/AnnouncementBanner";
import DeletionBanner from "@/app/components/v2/DeletionBanner";
import { SquircleDefs } from "@/app/components/v2/Squircle";
import { useAppShellSettings } from "@/app/components/v2/AppShellContext";
import styles from "./AppShellV2.module.css";
import appStyles from "./app.module.css";

/*
 * The V2 app chrome — sidebar and top bar — for the rebuilt signed-in pages.
 *
 * This exists ALONGSIDE app/components/layout/AppShell.tsx rather than
 * replacing it. The 35 tool pages, the editor, /help and the admin console are
 * still on the cream/yellow theme and hardcode its hexes in 80-odd files;
 * swapping their chrome without rebuilding their content would leave them
 * half-branded. They keep the old shell until they are rebuilt.
 *
 * The drawer behaviour below is carried over from that shell verbatim. Each
 * piece of it documents a real bug, so it is repeated here rather than
 * simplified.
 */

export interface AppShellV2Props {
  /**
   * Page title, rendered by TopBarV2.
   *
   * Optional when the shell is mounted in a layout: the page declares it with
   * useAppShell() instead, so changing route does not remount the sidebar. A
   * page that still mounts its own shell passes it as a prop as before.
   */
  title?: string;
  children: React.ReactNode;
  /**
   * Extra chrome mounted as a sibling of the nav — in practice <UpgradeGate />,
   * which pages outside /tools must mount themselves because they do not
   * inherit the one in app/tools/layout.tsx.
   */
  slot?: React.ReactNode;
  /** Suppress the announcement banner. Default true (shown). */
  banner?: boolean;
  /**
   * "scroll" — the page scrolls (the common case).
   * "fixed"  — <main> is pinned to the viewport and the page owns its own
   *            scrolling regions. Used by Ask Jo, whose composer is sized
   *            against the viewport.
   */
  variant?: "scroll" | "fixed";
  /** Mount the floating support widget. Default true. */
  launcher?: boolean;
  /** Replaces the default content well, for pages that own their own padding. */
  contentClassName?: string;
}

export default function AppShellV2({
  title,
  children,
  slot,
  banner,
  // No default here: `= "scroll"` would make the prop always defined and so
  // always beat the context, leaving Ask Jo and Help scrolling. The fallback
  // belongs below, after the context has had its say.
  variant,
  launcher,
  contentClassName,
}: AppShellV2Props) {
  const pathname = usePathname();

  // A prop always wins, so a page mounting its own shell behaves exactly as it
  // did. Under the shared layout there are no props and these come from the
  // page's useAppShell() call instead.
  const fromContext = useAppShellSettings();
  const shellTitle = title ?? fromContext?.title ?? "";
  const shellBanner = banner ?? fromContext?.banner ?? true;
  // SHELVED, not removed. The floating bubble reads as a chat assistant rather
  // than a way to reach a person, and /help is now the single entry point for
  // all three of Help, Contact and School enquiry. SupportLauncher.tsx and its
  // QuickCompose are left intact and still imported below, so bringing it back
  // is changing this `false` to `true` and nothing else.
  const shellLauncher = launcher ?? fromContext?.launcher ?? false;
  const shellContentClassName = contentClassName ?? fromContext?.contentClassName;
  const shellVariant = variant ?? fromContext?.variant ?? "scroll";

  // The drawer is open only for the route it was opened on. Storing the
  // pathname rather than a boolean is what closes it on navigation: SideNavV2
  // is a sibling of <main> and so is NOT remounted between routes, which
  // without this would leave the drawer sitting open over the newly rendered
  // page. Derived rather than reset in an effect, so there is no cascading
  // render.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const navOpen = openedAt === pathname;
  const setNavOpen = useCallback(
    (next: boolean) => setOpenedAt(next ? pathname : null),
    [pathname],
  );

  // Focus returns to the hamburger when the drawer closes — but only if the
  // drawer was ever opened. Without this guard every page load would steal
  // focus to the menu button on mount.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpened = useRef(false);

  const closeNav = useCallback(() => setNavOpen(false), [setNavOpen]);

  // The rail is only a drawer below the nav breakpoint; above it the rail is an
  // in-flow sibling and nothing overlays the page. Widening past the breakpoint
  // with the drawer open therefore has to drop the drawer-only behaviour. The
  // backdrop hides itself in CSS, but the scroll lock and the Escape handler
  // are JS and no media query reaches them. Without this, resizing a
  // phone-width window to desktop left `body { overflow: hidden }` stuck and
  // the page could not be scrolled at all.
  //
  // Matches the 900px breakpoint the prototype uses to drop the sidebar.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const drawerOpen = navOpen && isMobile;

  // Scroll lock while the drawer is open.
  //
  // Deliberately the plain `overflow: hidden` version, not the
  // `position: fixed; top: -scrollY` iOS trick: that one destroys and restores
  // scroll position, and ResultPanel calls window.scrollTo while a generation
  // streams. The two would fight. The drawer scrolls internally, so the only
  // cost here is iOS rubber-banding, which is cosmetic.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeNav]);

  useEffect(() => {
    if (drawerOpen) {
      hasOpened.current = true;
    } else if (hasOpened.current) {
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);

  const fixed = shellVariant === "fixed";

  return (
    // `jooma-v2` is load-bearing: every --j-* token is scoped to it in
    // globals.css, so without it on this wrapper the whole tree renders with
    // unresolved variables and no styling at all.
    <div className={`jooma-v2 ${styles.app}`}>
      {/* The squircle clip-path. `url(#jsq)` resolves against the current
          document, so it has to be in this tree — not only on the landing
          page. A square, unclipped tool tile means this is missing. */}
      <SquircleDefs />

      {slot}

      <SideNavV2 mobileOpen={drawerOpen} onMobileClose={closeNav} />

      {/* Backdrop. Rendered here rather than inside SideNavV2 so the stacking
          order reads in one place: backdrop below the drawer. */}
      {drawerOpen && (
        <div onClick={closeNav} aria-hidden="true" className={styles.backdrop} />
      )}

      {shellLauncher && <SupportLauncher />}

      {/* min-w-0 is load-bearing: a flex child refuses to shrink below its
          content's intrinsic width, which is why a wide table used to blow out
          the whole page instead of scrolling inside its own overflow-x box.
          Every table fix downstream depends on it — it is set in the module.

          Do NOT give the scroll variant an overflow-y. Nothing above
          constrains this element's height, so <main> grows to fit its content
          and the WINDOW keeps the real scrollbar. An overflow-y here still
          makes <main> a formal scroll container — one with zero scroll range —
          and scrollIntoView() walks up to the nearest such ancestor, nudges a
          scrollTop that is already 0, and stops. That silently swallowed the
          scroll to a restored generation, the output outline's heading links,
          and the pin-to-bottom during streaming. */}
      <main className={fixed ? styles.mainFixed : styles.main}>
        <TopBarV2
          title={shellTitle}
          onMenuClick={() => setNavOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        {/* Not behind shellBanner: a pending deletion is the state of the
            account, not an announcement, so it shows on every screen that
            carries the chrome including the ones that opt out of banners. */}
        <DeletionBanner />
        {shellBanner && <AnnouncementBanner />}
        <div className={shellContentClassName ?? appStyles.wrap}>{children}</div>
      </main>
    </div>
  );
}
