"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { Undo2, Redo2, Download, ArrowLeft, Palette, Check, Play, Pencil, ChevronDown } from "lucide-react";
import DropdownMenu from "@/app/components/ui/DropdownMenu";
import Wordmark from "@/app/components/v2/Wordmark";
import { SLIDESHOW_THEMES, THEME_CATEGORIES, getThemesByCategory, ART_STYLES, getThemeArt, type ArtStyleId } from "@/app/lib/slideshowThemes";

interface Props {
  title: string;
  onTitleChange: (v: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Export the deck. PPTX rebuilds each shape natively; PDF rasterises slides. */
  onExport: (format: "pptx" | "pdf") => void;
  onPresent: () => void;
  isExporting: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** When set, shows an "Edit prompt" button (re-open the original prompt and
   *  regenerate). Omitted for decks with no saved generation params. */
  onEditPrompt?: () => void;
  disableHistory?: boolean;
  themeId?: string;
  onThemeChange?: (id: string) => void;
  artStyle?: ArtStyleId;
  onArtStyleChange?: (style: ArtStyleId) => void;
}

const iconBtn = "p-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40";

export default function EditorTopBar({
  title,
  onTitleChange,
  onUndo,
  onRedo,
  onExport,
  onPresent,
  isExporting,
  saveStatus,
  onEditPrompt,
  disableHistory,
  themeId,
  onThemeChange,
  artStyle,
  onArtStyleChange,
}: Props) {
  const [themeOpen, setThemeOpen] = useState(false);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const activeTheme = SLIDESHOW_THEMES.find((t) => t.id === themeId) ?? SLIDESHOW_THEMES[0];

  useEffect(() => {
    if (!themeOpen) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (themeMenuRef.current?.contains(t)) return;
      if (themeBtnRef.current?.contains(t)) return;
      setThemeOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [themeOpen]);

  return (
    <div
      className="h-14 shrink-0 flex items-center justify-between px-4 border-b"
      style={{ borderColor: "#EAE6F5", backgroundColor: "#F7F5FC" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/tools/slideshow"
          className="p-2 -ml-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          title="Back to slideshows"
          aria-label="Back to slideshows"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Link
          href="/tools/slideshow"
          className="hover:opacity-70 transition-opacity"
          style={{ color: "var(--j-purple)" }}
        >
          <Wordmark height={22} />
        </Link>
        <span className="text-gray-400">/</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Slideshow"
          className="bg-transparent text-sm text-gray-800 focus:outline-none focus:bg-white focus:px-2 focus:py-1 focus:rounded-lg transition-all min-w-56"
        />
        <span className="text-xs text-gray-400">
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Save failed"}
        </span>
        {onEditPrompt && (
          <button
            type="button"
            onClick={onEditPrompt}
            disabled={disableHistory}
            className="ml-1 inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border px-2.5 py-1.5 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40"
            style={{ borderColor: "#EAE6F5" }}
            title="Edit the original prompt and regenerate"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit prompt
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={disableHistory}
          className={iconBtn}
          title={disableHistory ? "Undo unavailable while generating" : "Undo"}
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={disableHistory}
          className={iconBtn}
          title={disableHistory ? "Redo unavailable while generating" : "Redo"}
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-2" />
        {onThemeChange && (
          <div className="relative">
            <button
              ref={themeBtnRef}
              type="button"
              onClick={() => setThemeOpen((v) => !v)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              title="Switch theme"
            >
              <Palette className="w-3.5 h-3.5" />
              <span
                className="inline-block w-3 h-3 rounded-sm border bg-cover bg-center"
                style={{
                  backgroundColor: activeTheme.palette.background,
                  backgroundImage: (() => {
                    const a = getThemeArt(activeTheme, artStyle ?? "watercolor");
                    return a ? `url(${a.src})` : undefined;
                  })(),
                  borderColor: "#EAE6F5",
                }}
              />
              <span>{activeTheme.name}</span>
            </button>
            {themeOpen && (
              <div
                ref={themeMenuRef}
                className="absolute right-0 top-full mt-1 w-80 max-h-[80vh] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-50"
              >
                {THEME_CATEGORIES.map((cat) => {
                  const themes = getThemesByCategory(cat.id);
                  if (themes.length === 0) return null;
                  return (
                    <Fragment key={cat.id}>
                      <div className="px-2 pt-2 pb-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {cat.label}
                        </span>
                        {/* Watercolor/Illustration toggle only on the categories
                            that actually have both variants (Classic & Scenic). */}
                        {onArtStyleChange && (cat.id === "classic" || cat.id === "scenic") && (
                          <div className="flex gap-0.5 p-0.5 rounded-md bg-gray-100 shrink-0">
                            {ART_STYLES.map((s) => {
                              const active = (artStyle ?? "watercolor") === s.id;
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onArtStyleChange(s.id); }}
                                  className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${
                                    active ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                                  }`}
                                >
                                  {s.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {themes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { onThemeChange(t.id); setThemeOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded-md hover:bg-gray-50"
                  >
                    <span
                      className="inline-block w-5 h-5 rounded-md border shrink-0 bg-cover bg-center"
                      style={{
                        backgroundColor: t.palette.background,
                        backgroundImage: (() => {
                          const a = getThemeArt(t, artStyle ?? "watercolor");
                          return a ? `url(${a.src})` : undefined;
                        })(),
                        borderColor: "#EAE6F5",
                      }}
                    />
                    <span
                      className="inline-block w-1.5 h-5 rounded-sm shrink-0"
                      style={{ backgroundColor: t.palette.accent }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-gray-800 truncate">{t.name}</span>
                      <span className="block text-[10px] text-gray-500 truncate">{t.description}</span>
                    </span>
                    {t.id === activeTheme.id && <Check className="w-3.5 h-3.5 text-violet-600 shrink-0" />}
                  </button>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="w-px h-6 bg-gray-300 mx-2" />
        <button
          onClick={onPresent}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          style={{ backgroundColor: "#1D1730", color: "#fff" }}
          title="Present"
        >
          <Play className="w-4 h-4" />
          Present
        </button>
        <DropdownMenu
          ariaLabel="Export options"
          disabled={isExporting}
          triggerClassName="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          menuClassName="w-56"
          trigger={
            <>
              <Download className="w-4 h-4" />
              {isExporting ? "Exporting..." : "Export"}
              <ChevronDown className="w-4 h-4" />
            </>
          }
          items={[
            { label: "Download PowerPoint (PPTX)", onSelect: () => onExport("pptx") },
            { label: "Download PDF", onSelect: () => onExport("pdf") },
            {
              // Needs Google OAuth and the Slides API.
              label: "Save to Google Slides",
              disabled: true,
              note: "coming soon",
            },
          ]}
        />
      </div>
    </div>
  );
}
