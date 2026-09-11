"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MagnifyingGlass,
  DotsThree,
  GridFour,
  List as ListIcon,
  Check,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Stack,
  PencilSimple,
  ShareNetwork,
  TrashSimple,
  CircleNotch,
  DownloadSimple,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { useAppShell } from "@/app/components/v2/AppShellContext";
import ShareModal from "@/app/components/v2/ShareModal";
import SharedResourceModal from "@/app/components/v2/SharedResourceModal";
import { ToolTile } from "@/app/components/v2/Squircle";
import {
  listRecentRuns,
  moveRunToFolder,
  deleteToolRun,
  type ToolRun,
} from "@/app/lib/toolRuns";
import {
  listFolders,
  createFolder,
  renameFolder,
  recolourFolder,
  deleteFolder,
  folderSwatch,
  FOLDER_COLOURS,
  DEFAULT_FOLDER_COLOUR,
  type Folder,
  type FolderColour,
} from "@/app/lib/folders";
import { sharedRunsById, type Share } from "@/app/lib/colleagues";
import { displayName } from "@/app/lib/colleagueDisplay";
import { v2ToolForSlug, toolSolid } from "@/app/lib/tools";
import { typeLabel, formatDate } from "@/app/lib/toolRunDisplay";
import app from "@/app/components/v2/app.module.css";
import styles from "./folders.module.css";

/*
 * Library.
 *
 * Folders are real rows the teacher creates, names and colours (see
 * app/lib/folders.ts and supabase/migrations/20260902000000_folders.sql). A
 * resource sits in at most one, and `folder_id IS NULL` is the permanent
 * Unfiled card rather than an absence of state.
 *
 * This replaced a version that derived one folder per tool from
 * tool_runs.tool_slug. That grouping was not wrong, it was just not a folder:
 * nothing could be created, renamed or moved, so every affordance the prototype
 * specifies had to be left out.
 *
 * Filing is drag and drop, as the prototype has it, AND a Move to folder item
 * in the row menu. The menu is not a fallback for a browser that cannot drag:
 * it is the only route that works with a keyboard, and dragging alone would put
 * the whole feature out of reach.
 *
 * Upload is deliberately absent. The prototype has an Upload button and a drop
 * zone for Word, PowerPoint, PDF and images; that is file storage, with its own
 * quota, scanning and retention questions, and it is a separate piece of work.
 */

/*
 * Three views that are not folders.
 *
 * The default (no selection) is the unfiled pile: folder_id IS NULL, what still
 * needs sorting. That is the useful thing to land on, because it is the only
 * view with anything to do in it, and it empties as the teacher files.
 *
 * ALL is a card in the grid rather than the default, so "show me everything"
 * stays one click away without being what you stare at every visit.
 *
 * None is a row in `folders`. ALL and Unfiled are views over
 * tool_runs.folder_id; SHARED is something different again, below.
 */
const ALL = "all";

/*
 * SHARED IS A FILTER, NOT A FOLDER, and the distinction is the whole design.
 *
 * It holds the resources that arrived from a colleague and were added: the runs
 * whose ids appear as shares.saved_run_id (see indexBySavedRun). So membership
 * is PROVENANCE, which is a fact about where a resource came from, and filing
 * is a CHOICE about where the teacher keeps it. Those are independent, so:
 *
 *   - a shared resource can sit in "Shared with me" AND in Autumn 2 at once;
 *   - filing one moves it out of Unfiled and leaves it here, because being
 *     filed does not make it stop having come from Alice;
 *   - nothing can be dropped ONTO it, because you cannot make a resource
 *     shared by dragging it.
 *
 * The consequence to expect: the card counts no longer sum to the total, unlike
 * ALL / Unfiled / folders, which partition. That is correct for an overlapping
 * view and is not a bug to be fixed by making membership exclusive.
 */
const SHARED = "shared";

/** null means unfiled, which is the default view. */
type Selection = string | null;

interface Draft {
  /** The folder being edited, or null when creating a new one. */
  folder: Folder | null;
  name: string;
  colour: FolderColour;
}

export default function FoldersPage() {
  // useSearchParams needs a Suspense boundary above it, or the whole route
  // opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <Library />
    </Suspense>
  );
}

function Library() {
  useAppShell({ title: "Library" });

  const router = useRouter();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  /** Which runs came from a colleague, keyed by run id. The whole share rather
   *  than a set of ids, so a row can name its sender and open the snapshot. */
  const [sharedBy, setSharedBy] = useState<Map<string, Share>>(new Map());
  const [viewing, setViewing] = useState<Share | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [moving, setMoving] = useState<ToolRun | null>(null);
  const [sharing, setSharing] = useState<ToolRun | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ToolRun | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Selection | undefined>(undefined);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Selection lives in the URL so a refresh, a back button and a shared link
  // all land on the same folder. The grid stays on screen either way: it is
  // what a row is dragged onto, so navigating away from it would break the
  // interaction the page is built around.
  const selected: Selection = searchParams.get("folder");

  const select = useCallback(
    (next: Selection) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("folder", next);
      else params.delete("folder");
      const qs = params.toString();
      router.replace(qs ? `/folders?${qs}` : "/folders", { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listRecentRuns(1000),
      listFolders(),
      // Caught on its own leg so a colleagues problem cannot take the Library
      // down with it. Without this, a missing shares table turns the whole
      // page into "your library could not be loaded", which is both alarming
      // and untrue: the library is fine, one view over it is not available.
      sharedRunsById().catch(() => new Map<string, Share>()),
    ])
      .then(([r, f, shared]) => {
        if (cancelled) return;
        setRuns(r);
        setFolders(f);
        setSharedBy(shared);
      })
      .catch(() => {
        if (!cancelled) setError("Your library could not be loaded. Refresh to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countFor = useCallback(
    (id: Selection) => {
      if (id === ALL) return runs.length;
      // Counted against `runs`, not against the share map, so a resource the
      // teacher has since deleted stops being counted here too.
      if (id === SHARED) return runs.filter((r) => sharedBy.has(r.id)).length;
      if (id === null) return runs.filter((r) => !r.folder_id).length;
      return runs.filter((r) => r.folder_id === id).length;
    },
    [runs, sharedBy],
  );

  const folderName = useCallback(
    (id: string | null) => {
      if (!id) return "No folder";
      return folders.find((f) => f.id === id)?.name ?? "No folder";
    },
    [folders],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((run) => {
      // No selection is the unfiled pile, not everything. ALL is the only view
      // that skips the folder test.
      //
      // SHARED tests provenance INSTEAD of folder, never as well: a shared
      // resource filed into Autumn 2 must still appear here, so asking about
      // folder_id at all would be the bug.
      if (selected === SHARED) {
        if (!sharedBy.has(run.id)) return false;
      } else if (selected === null) {
        if (run.folder_id) return false;
      } else if (selected && selected !== ALL && run.folder_id !== selected) {
        return false;
      }
      if (!q) return true;
      const tool = v2ToolForSlug(run.tool_slug);
      const haystack = [run.title ?? "", tool?.name ?? typeLabel(run.tool_slug)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [runs, selected, query, sharedBy]);

  /* ── Filing ─────────────────────────────────────────────────────────────
   *
   * Optimistic: the row moves the instant it is dropped, and rolls back if the
   * write fails. A folder is not worth a spinner, but a move that silently did
   * not happen is worth catching, which is what the rollback and the message
   * are for. */
  const file = useCallback(
    async (runId: string, target: Selection) => {
      // Dropping on Unfiled clears the folder. ALL is not a drop target, so it
      // never reaches here.
      const folderId = target === null ? null : target;
      const before = runs.find((r) => r.id === runId);
      if (!before || before.folder_id === folderId) return;

      setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, folder_id: folderId } : r)));
      setError(null);
      try {
        await moveRunToFolder(runId, folderId);
      } catch {
        setRuns((prev) =>
          prev.map((r) => (r.id === runId ? { ...r, folder_id: before.folder_id } : r)),
        );
        setError("That resource could not be moved. Try again.");
      }
    },
    [runs],
  );

  /*
   * Deleting asks first.
   *
   * It did not used to: one click on the menu item destroyed the resource with
   * no prompt and no undo. There is no soft delete anywhere in the schema, so
   * "deleted" means gone, and it now also removes the images and audio the
   * resource owned. That is too much to hang on a single click, especially in a
   * menu whose neighbouring item is Edit.
   */
  const remove = useCallback(async () => {
    const run = pendingDelete;
    if (!run) return;
    setDeletingId(run.id);
    setError(null);
    try {
      await deleteToolRun(run.id);
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      setPendingDelete(null);
    } catch {
      // Left in place rather than removed optimistically and reappearing on
      // the next load.
      setError("That resource could not be deleted. Try again.");
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete]);

  const saveDraft = useCallback(
    async (name: string, colour: FolderColour) => {
      const editing = draft?.folder ?? null;
      if (editing) {
        const before = editing;
        setFolders((prev) =>
          prev.map((f) => (f.id === editing.id ? { ...f, name: name.trim(), colour } : f)),
        );
        setDraft(null);
        try {
          if (name.trim() !== before.name) await renameFolder(editing.id, name);
          if (colour !== before.colour) await recolourFolder(editing.id, colour);
        } catch {
          setFolders((prev) => prev.map((f) => (f.id === editing.id ? before : f)));
          setError("That folder could not be updated. Try again.");
        }
        return;
      }

      setDraft(null);
      try {
        const created = await createFolder(name, colour);
        setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        setError("That folder could not be created. Try again.");
      }
    },
    [draft],
  );

  const removeFolder = useCallback(
    async (folder: Folder) => {
      const count = countFor(folder.id);
      const warning =
        count > 0
          ? `Delete "${folder.name}"? The ${count} ${
              count === 1 ? "resource" : "resources"
            } inside will move to Unfiled, not be deleted.`
          : `Delete "${folder.name}"?`;
      if (!window.confirm(warning)) return;

      const before = folders;
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      // Mirrors `on delete set null` on tool_runs.folder_id, so the counts and
      // the Unfiled card are right without a refetch.
      setRuns((prev) =>
        prev.map((r) => (r.folder_id === folder.id ? { ...r, folder_id: null } : r)),
      );
      if (selected === folder.id) select(null);
      setError(null);
      try {
        await deleteFolder(folder.id);
      } catch {
        setFolders(before);
        setError("That folder could not be deleted. Try again.");
      }
    },
    [folders, countFor, selected, select],
  );

  /*
   * One rule: in "Shared with me" a click READS it, everywhere else a click
   * EDITS it. The row menu still carries Open for the editing route, so nothing
   * is taken away.
   *
   * This also sidesteps a real gap for exactly these rows. `open` below is
   * `if (tool) router.push(...)`, and v2ToolForSlug builds its index from
   * href.replace("/tools/", ""), so a slug that does not match its route
   * resolves to undefined and clicking does nothing at all, silently. The modal
   * renders from the snapshot and always works.
   */
  const open = useCallback(
    (run: ToolRun) => {
      const tool = v2ToolForSlug(run.tool_slug);
      if (tool) router.push(`${tool.href}?run=${run.id}`);
    },
    [router],
  );

  const openFrom = useCallback(
    (run: ToolRun) => {
      const share = selected === SHARED ? sharedBy.get(run.id) : undefined;
      if (share) setViewing(share);
      else open(run);
    },
    [selected, sharedBy, open],
  );

  const total = runs.length;
  const heading =
    selected === ALL
      ? "All resources"
      : selected === SHARED
        ? "Shared with me"
        : selected
          ? (folders.find((f) => f.id === selected)?.name ?? "Library")
          : "Unfiled";

  return (
    <>
      <div className={app.hello}>
        <p className={app.helloWhen}>
          {loading ? " " : `${total} ${total === 1 ? "resource" : "resources"}`}
        </p>
        <h1>Library</h1>
        <p className={app.helloSub}>
          Everything you make is filed here. Drag a resource onto a folder to move it.
        </p>
      </div>

      <div className={styles.drivebar}>
        <button
          type="button"
          className={`${app.btn} ${app.btnP}`}
          onClick={() => setDraft({ folder: null, name: "", colour: DEFAULT_FOLDER_COLOUR })}
        >
          <FolderPlus className={app.btnIcon} />
          New folder
        </button>

        <div className={`${app.search} ${styles.drivebarSearch}`}>
          <MagnifyingGlass className={app.searchIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            className={app.searchInput}
          />
        </div>

        <div className={styles.viewToggle}>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label="List view"
            aria-pressed={view === "list"}
            className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnOn : ""}`}
          >
            <ListIcon className={styles.viewIcon} />
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnOn : ""}`}
          >
            <GridFour className={styles.viewIcon} />
          </button>
        </div>
      </div>

      {/* The Library crumb is also the way to unfile something. Removing the
          Unfiled card took the only drop target that clears a folder, and
          dragging a resource back out has to stay possible without opening a
          menu. `Move to folder` still offers Unfiled for keyboard users. */}
      <p className={styles.crumbs}>
        <button
          type="button"
          className={`${styles.crumbLink} ${
            dropTarget === null && draggingId ? styles.crumbDrop : ""
          }`}
          onClick={() => select(null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(null);
          }}
          onDragLeave={() => setDropTarget(undefined)}
          onDrop={(e) => {
            e.preventDefault();
            setDropTarget(undefined);
            const runId = e.dataTransfer.getData("text/plain");
            if (runId) file(runId, null);
          }}
        >
          Library
        </button>
        <span>/</span>
        <span>{heading}</span>
      </p>

      {error && (
        <p className={styles.error} role="status">
          {error}
        </p>
      )}

      {loading ? (
        <p className={styles.quiet}>Loading…</p>
      ) : (
        <>
          <div className={styles.fgrid}>
            {/* First, and not a drop target: dropping a row onto "everything"
                would have no meaning, since every row is already in it. The
                unfiled pile is the default view instead, so it needs no card. */}
            <FolderCard
              id={ALL}
              name="All resources"
              count={countFor(ALL)}
              neutral
              selected={selected === ALL}
              dropping={false}
              onSelect={() => select(selected === ALL ? null : ALL)}
              onDropTarget={() => {}}
            />

            {/* Only once something has actually arrived. A teacher with no
                colleagues should not be given a permanently empty view, in the
                way the incoming requests panel only appears when there are
                requests. Not a drop target: passing no onDropRun is what makes
                it one, so provenance cannot be assigned by dragging. */}
            {sharedBy.size > 0 && (
              <FolderCard
                id={SHARED}
                name="Shared with me"
                count={countFor(SHARED)}
                neutral
                icon={<UsersThree weight="fill" />}
                selected={selected === SHARED}
                dropping={false}
                onSelect={() => select(selected === SHARED ? null : SHARED)}
                onDropTarget={() => {}}
              />
            )}

            {folders.map((folder) => (
              <FolderCard
                key={folder.id}
                id={folder.id}
                name={folder.name}
                colour={folder.colour}
                count={countFor(folder.id)}
                selected={selected === folder.id}
                dropping={dropTarget === folder.id}
                onSelect={() => select(selected === folder.id ? null : folder.id)}
                onRename={() =>
                  setDraft({ folder, name: folder.name, colour: folder.colour })
                }
                onDelete={() => removeFolder(folder)}
                onDropRun={(runId) => file(runId, folder.id)}
                onDropTarget={setDropTarget}
              />
            ))}

            <button
              type="button"
              className={`${styles.folder} ${styles.folderNew}`}
              onClick={() => setDraft({ folder: null, name: "", colour: DEFAULT_FOLDER_COLOUR })}
            >
              <FolderPlus className={styles.folderNewIcon} />
              New folder
            </button>
          </div>

          <div className={app.sh}>
            <div className={app.shTitle}>
              <h2>{heading}</h2>
              <span className={app.shSub}>
                {selected === SHARED
                  ? "These came from colleagues. Filing one keeps it here too."
                  : folders.length === 0
                    ? "Make a folder to start filing"
                    : selected === null
                      ? "Drag any row onto a folder above"
                      : "Drag a row onto Library to unfile it"}
              </span>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className={app.panel}>
              <EmptyState
                hasRuns={total > 0}
                searching={query.trim().length > 0}
                selected={selected}
              />
            </div>
          ) : (
            // Rows sit inside a panel; cards sit on the page and carry their
            // own borders, so a panel behind them would draw a box around a
            // box.
            <div className={view === "list" ? app.panel : undefined}>
              <div className={view === "list" ? styles.rows : styles.filegrid}>
                {visible.map((run) => (
                  <ResourceItem
                    key={run.id}
                    run={run}
                    folderLabel={folderName(run.folder_id)}
                    sharedFrom={
                      selected === SHARED && sharedBy.get(run.id)?.sender
                        ? displayName(sharedBy.get(run.id)!.sender!)
                        : undefined
                    }
                    dragging={draggingId === run.id}
                    deleting={deletingId === run.id}
                    view={view}
                    onDragStart={() => setDraggingId(run.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(undefined);
                    }}
                    onOpen={() => openFrom(run)}
                    onMove={() => setMoving(run)}
                    onShare={() => setSharing(run)}
                    onDelete={() => setPendingDelete(run)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {draft && (
        <FolderModal
          draft={draft}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {moving && (
        <MoveModal
          run={moving}
          folders={folders}
          onCancel={() => setMoving(null)}
          onPick={(target) => {
            setMoving(null);
            file(moving.id, target);
          }}
        />
      )}

      {pendingDelete && (
        <DeleteModal
          run={pendingDelete}
          busy={deletingId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}

      {/* No onAdded: these are already in the library, which is how the modal
          knows to show the confirmation rather than the Add button. */}
      <SharedResourceModal share={viewing} onClose={() => setViewing(null)} />

      <ShareModal
        open={sharing !== null}
        onClose={() => setSharing(null)}
        runId={sharing?.id}
        runTitle={sharing?.title?.trim() || "Untitled"}
      />
    </>
  );
}

/* ── Folder card ─────────────────────────────────────────────────────────── */

function FolderCard({
  id,
  name,
  colour,
  count,
  neutral,
  icon,
  selected,
  dropping,
  onSelect,
  onRename,
  onDelete,
  onDropRun,
  onDropTarget,
}: {
  id: string;
  name: string;
  colour?: FolderColour;
  count: number;
  /** A view rather than a real folder: slate, no menu, no drop target. */
  neutral?: boolean;
  /** Overrides the glyph on a neutral card, for a view whose meaning is not
   *  "a pile of things" — "Shared with me" is about who sent them. */
  icon?: React.ReactNode;
  selected: boolean;
  dropping: boolean;
  onSelect: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onDropRun?: (runId: string) => void;
  onDropTarget: (id: Selection | undefined) => void;
}) {
  // "All resources" has no colour of its own: it is not a choice the teacher
  // made, so it takes the neutral slate rather than borrowing a hue that would
  // read as one more folder among the rest.
  const swatch = neutral
    ? { tint: "var(--j-tint-slate)", solid: "#6D6683" }
    : folderSwatch(colour ?? DEFAULT_FOLDER_COLOUR);

  const droppable = Boolean(onDropRun);

  // Same lift as ResourceItem: a folder card traps its own menu identically.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`${styles.folder} ${dropping ? styles.folderDrop : ""} ${
        selected ? styles.folderOn : ""
      } ${menuOpen ? styles.cardMenuOpen : ""}`}
      onDragOver={
        droppable
          ? (e) => {
              // Without preventDefault the drop never fires: the default action
              // for a dragover is "reject this".
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDropTarget(id);
            }
          : undefined
      }
      onDragLeave={droppable ? () => onDropTarget(undefined) : undefined}
      onDrop={
        droppable
          ? (e) => {
              e.preventDefault();
              onDropTarget(undefined);
              const runId = e.dataTransfer.getData("text/plain");
              if (runId) onDropRun?.(runId);
            }
          : undefined
      }
    >
      {!neutral && onRename && onDelete && (
        <Menu label={`${name} menu`} corner onOpenChange={setMenuOpen}>
          {(close) => (
            <>
              <MenuItem
                icon={<FolderOpen className={styles.menuItemIcon} />}
                onClick={() => {
                  close();
                  onSelect();
                }}
              >
                Open
              </MenuItem>
              <MenuItem
                icon={<PencilSimple className={styles.menuItemIcon} />}
                onClick={() => {
                  close();
                  onRename();
                }}
              >
                Rename and recolour
              </MenuItem>
              <span className={styles.menuSep} />
              <MenuItem
                icon={<TrashSimple className={styles.menuItemIcon} />}
                danger
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                Delete
              </MenuItem>
            </>
          )}
        </Menu>
      )}

      <button
        type="button"
        onClick={onSelect}
        className={styles.folderOpen}
        aria-pressed={selected}
      >
        <span
          className={styles.folderChip}
          style={{ background: swatch.tint, color: swatch.solid }}
          aria-hidden="true"
        >
          {icon ?? (neutral ? <Stack weight="fill" /> : <FolderIcon weight="fill" />)}
        </span>
        <h3 className={styles.folderName}>{name}</h3>
        <span className={styles.folderCount}>
          {count} {count === 1 ? "resource" : "resources"}
        </span>
      </button>
    </div>
  );
}

/* ── Resource, as a row or a card ────────────────────────────────────────── */

function ResourceItem({
  run,
  folderLabel,
  sharedFrom,
  dragging,
  deleting,
  view,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
  onShare,
  onDelete,
}: {
  run: ToolRun;
  folderLabel: string;
  /** Who sent it, in the view where that is the point. Replaces the folder in
   *  the meta line rather than joining it: in "Shared with me" the provenance
   *  is what distinguishes one row from another, and the folder is one click
   *  away in ALL. */
  sharedFrom?: string;
  dragging: boolean;
  deleting: boolean;
  view: "grid" | "list";
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const tool = v2ToolForSlug(run.tool_slug);
  const label = tool?.name ?? typeLabel(run.tool_slug);
  const title = run.title?.trim() || "Untitled";

  /*
   * Download as .docx, reusing the exporter the tool result panel already uses
   * so a resource saved from the Library is byte-identical to one saved from
   * the result screen.
   *
   * Word rather than a format picker: the row menu is not the place for a
   * submenu, and .docx is the one a teacher can actually edit afterwards.
   * `docx` is a heavy dependency, so it is imported on click rather than at
   * module load, keeping it out of the Library's bundle.
   */
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      const { exportToDocx } = await import("@/app/lib/exportUtils");
      await exportToDocx(run.output, title);
    } catch {
      // Deliberately quiet. The row has nowhere to put an error, and a failed
      // download is self-evident: no file appears.
    } finally {
      setDownloading(false);
    }
  };
  // The prototype's second line is "<tool>, <folder>". A card has no date
  // column, so the date joins the meta line there rather than being dropped.
  const where = sharedFrom ? `from ${sharedFrom}` : folderLabel;
  const meta =
    view === "list"
      ? `${label}, ${where}`
      : `${label}, ${where}, ${formatDate(run.created_at)}`;

  // Both layouts drag identically, so the handlers are shared rather than
  // written twice and drifting.
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", run.id);
      e.dataTransfer.effectAllowed = "move";
      onDragStart();
    },
    onDragEnd,
  };

  // Raises this card above the rest of the grid while its menu is open. See the
  // note on `.cardMenuOpen` in folders.module.css for why the panel's own
  // z-index cannot do this.
  const [menuOpen, setMenuOpen] = useState(false);

  const menu = (
    <Menu label={`${title} menu`} onOpenChange={setMenuOpen}>
        {(close) => (
          <>
            <MenuItem
              icon={<PencilSimple className={styles.menuItemIcon} />}
              onClick={() => {
                close();
                onOpen();
              }}
            >
              Edit
            </MenuItem>
            <MenuItem
              icon={<ShareNetwork className={styles.menuItemIcon} />}
              onClick={() => {
                close();
                onShare();
              }}
            >
              Share with colleagues
            </MenuItem>
            <MenuItem
              icon={<FolderIcon className={styles.menuItemIcon} />}
              onClick={() => {
                close();
                onMove();
              }}
            >
              Move to folder
            </MenuItem>
            <MenuItem
              icon={
                downloading ? (
                  <CircleNotch className={`${styles.menuItemIcon} ${styles.spin}`} />
                ) : (
                  <DownloadSimple className={styles.menuItemIcon} />
                )
              }
              disabled={downloading}
              onClick={() => {
                close();
                void download();
              }}
            >
              Download
            </MenuItem>
            <span className={styles.menuSep} />
            <MenuItem
              icon={
                deleting ? (
                  <CircleNotch className={`${styles.menuItemIcon} ${styles.spin}`} />
                ) : (
                  <TrashSimple className={styles.menuItemIcon} />
                )
              }
              danger
              disabled={deleting}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
    </Menu>
  );

  if (view === "grid") {
    return (
      <div
        className={`${styles.filecard} ${dragging ? styles.filerowDragging : ""} ${
          menuOpen ? styles.cardMenuOpen : ""
        }`}
        {...dragProps}
      >
        <span className={styles.filecardMenu}>{menu}</span>
        <button type="button" className={styles.filecardFace} onClick={onOpen}>
          <ToolTile icon={tool?.icon ?? "folder"} solid={toolSolid(tool)} size="md" />
          <span className={`${app.rowTitle} ${styles.filecardTitle}`}>{title}</span>
          <span className={styles.filecardMeta}>{meta}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`${styles.filerow} ${dragging ? styles.filerowDragging : ""} ${
        menuOpen ? styles.cardMenuOpen : ""
      }`}
      {...dragProps}
    >
      <ToolTile icon={tool?.icon ?? "folder"} solid={toolSolid(tool)} size="sm" />

      <button type="button" className={styles.fileMain} onClick={onOpen}>
        <span className={`${app.rowTitle} ${styles.fileTitle}`}>{title}</span>
        <span className={styles.fileMeta}>{meta}</span>
      </button>

      <span className={styles.fileWhen}>{formatDate(run.created_at)}</span>

      {menu}
    </div>
  );
}

/* ── Menu ────────────────────────────────────────────────────────────────── */

function Menu({
  label,
  corner,
  onOpenChange,
  children,
}: {
  label: string;
  corner?: boolean;
  /** Fires when the panel opens or closes, so the owning card can raise itself
   *  above its neighbours for as long as the menu is on screen. */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /*
   * Tell the card whether this menu is open, so it can lift itself above its
   * neighbours while it is. The panel cannot do that for itself: see the note on
   * `.cardMenuOpen` in folders.module.css.
   *
   * In an effect rather than inside setOpen, so the parent is never told to
   * re-render from inside this component's own render or event handler.
   */
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className={corner ? styles.menuCorner : styles.menuInline}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={styles.menuBtn}
      >
        <DotsThree weight="bold" className={styles.menuIcon} />
      </button>
      {open && (
        <div className={styles.menuPanel} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
  soon,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  soon?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={soon || disabled}
      aria-disabled={soon || disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`${styles.menuItem} ${danger ? styles.menuDanger : ""} ${
        soon ? styles.menuItemSoon : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── Modals ──────────────────────────────────────────────────────────────── */

/**
 * Shared modal shell: scrim, Escape to close, focus moved in on open and
 * returned to whatever opened it on close.
 *
 * The prototype has none of this. It closes on a scrim click and nothing else,
 * and its "input" is a styled div. A modal that cannot be dismissed from the
 * keyboard and does not return focus is a trap for anybody not using a mouse.
 */
function ModalShell({
  title,
  sub,
  onCancel,
  children,
}: {
  title: string;
  sub: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
  }, [onCancel]);

  return (
    <div
      className={styles.modalScrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={styles.modalTitle}>{title}</h2>
        <p className={styles.modalSub}>{sub}</p>
        {children}
      </div>
    </div>
  );
}

function FolderModal({
  draft,
  onCancel,
  onSave,
}: {
  draft: Draft;
  onCancel: () => void;
  onSave: (name: string, colour: FolderColour) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [colour, setColour] = useState<FolderColour>(draft.colour);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft.folder !== null;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const valid = name.trim().length > 0 && name.trim().length <= 60;
  const submit = () => {
    if (valid) onSave(name, colour);
  };

  return (
    <ModalShell
      title={editing ? "Rename folder" : "New folder"}
      sub="Resources sit in one folder at a time."
      onCancel={onCancel}
    >
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="folder-name">
          Name
        </label>
        <input
          id="folder-name"
          ref={input}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Autumn 2, Science"
          className={styles.fieldInput}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Colour</span>
        <div className={styles.swatches}>
          {FOLDER_COLOURS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={c.name}
              aria-pressed={colour === c.key}
              onClick={() => setColour(c.key)}
              style={{ background: c.tint, color: c.solid }}
              className={`${styles.sw} ${colour === c.key ? styles.swOn : ""}`}
            >
              {colour === c.key && <Check weight="bold" className={styles.swCheck} />}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.modalFoot}>
        <button type="button" className={styles.modalCancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.modalSave} disabled={!valid} onClick={submit}>
          {editing ? "Save folder" : "Create folder"}
        </button>
      </div>
    </ModalShell>
  );
}

function MoveModal({
  run,
  folders,
  onCancel,
  onPick,
}: {
  run: ToolRun;
  folders: Folder[];
  onCancel: () => void;
  onPick: (target: Selection) => void;
}) {
  return (
    <ModalShell
      title="Move to folder"
      sub="Resources sit in one folder at a time."
      onCancel={onCancel}
    >
      <div className={styles.picklist}>
        {folders.map((folder) => {
          const swatch = folderSwatch(folder.colour);
          return (
            <button
              key={folder.id}
              type="button"
              className={styles.pick}
              onClick={() => onPick(folder.id)}
            >
              <span
                className={styles.pickChip}
                style={{ background: swatch.tint, color: swatch.solid }}
                aria-hidden="true"
              >
                <FolderIcon weight="fill" />
              </span>
              <span className={styles.pickName}>{folder.name}</span>
              {run.folder_id === folder.id && <Check weight="bold" className={styles.pickCheck} />}
            </button>
          );
        })}

        <button type="button" className={styles.pick} onClick={() => onPick(null)}>
          <span
            className={styles.pickChip}
            style={{ background: "var(--j-tint-slate)", color: "#6D6683" }}
            aria-hidden="true"
          >
            <FolderOpen weight="fill" />
          </span>
          <span className={styles.pickName}>Unfiled</span>
          {!run.folder_id && <Check weight="bold" className={styles.pickCheck} />}
        </button>
      </div>

      <div className={styles.modalFoot}>
        <button type="button" className={styles.modalCancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * Confirm before destroying a resource.
 *
 * Deleting used to happen on a single click, straight from a menu whose
 * neighbouring item is Edit. Nothing in the schema is soft deleted, so there is
 * no undo and no trash to fish it back out of, and the delete now also removes
 * the pictures and audio the resource owned.
 *
 * The wording says what actually happens, in the same spirit as the folder
 * delete's promise that the resources inside only move to Unfiled. Naming the
 * resource matters: it is the one check against deleting the row below the one
 * you meant.
 */
function DeleteModal({
  run,
  busy,
  onCancel,
  onConfirm,
}: {
  run: ToolRun;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title = run.title?.trim() || "Untitled";
  return (
    <ModalShell
      title="Delete this resource?"
      sub="This cannot be undone."
      onCancel={onCancel}
    >
      <p className={styles.confirmBody}>
        <strong>{title}</strong> will be deleted for good, along with any pictures or audio
        that belong to it. Anything you have already shared with a colleague stays in their
        library.
      </p>

      <div className={styles.modalFoot}>
        <button type="button" className={styles.modalCancel} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={styles.modalDanger} onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting..." : "Delete"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Empty states ────────────────────────────────────────────────────────── */

function EmptyState({
  hasRuns,
  searching,
  selected,
}: {
  hasRuns: boolean;
  searching: boolean;
  selected: Selection;
}) {
  if (searching) {
    return (
      <div className={app.empty}>
        <span className={app.emptyIcon}>
          <MagnifyingGlass weight="fill" />
        </span>
        <p className={app.emptyTitle}>Nothing matches that search</p>
        <p className={app.emptyBody}>Try a shorter word, or clear the search box.</p>
      </div>
    );
  }

  if (!hasRuns) {
    return (
      <div className={app.empty}>
        <span className={app.emptyIcon}>
          <FolderOpen weight="fill" />
        </span>
        <p className={app.emptyTitle}>Nothing filed yet</p>
        <p className={app.emptyBody}>
          Make something with any tool and it lands here automatically.
        </p>
      </div>
    );
  }

  if (selected === SHARED) {
    return (
      <div className={app.empty}>
        <span className={app.emptyIcon}>
          <UsersThree weight="fill" />
        </span>
        <p className={app.emptyTitle}>Nothing added from colleagues yet</p>
        <p className={app.emptyBody}>
          When a colleague shares something and you add it, it stays here as well as in
          whichever folder you file it in.
        </p>
      </div>
    );
  }

  // The default view, and empty means the teacher has filed everything. That is
  // the finished state of this page rather than a gap in it, so it says so.
  if (selected === null) {
    return (
      <div className={app.empty}>
        <span className={app.emptyIcon}>
          <Check weight="fill" />
        </span>
        <p className={app.emptyTitle}>Everything is filed</p>
        <p className={app.emptyBody}>
          Every resource you have made is in a folder. Open All resources to see them.
        </p>
      </div>
    );
  }

  return (
    <div className={app.empty}>
      <span className={app.emptyIcon}>
        <FolderOpen weight="fill" />
      </span>
      <p className={app.emptyTitle}>Nothing in here yet</p>
      <p className={app.emptyBody}>
        Drag a resource onto this folder, or use Move to folder from its menu.
      </p>
    </div>
  );
}
