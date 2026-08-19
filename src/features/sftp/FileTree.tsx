import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  File,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  SquarePen,
  TextCursorInput,
  Trash2,
  WifiOff,
} from "lucide-react";

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  LoadingState,
  ScrollArea,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useTabsStore } from "@/workbench/tabs";
import { EntryIcon, InlineNameInput } from "./FileList";
import { visibleFileEntries, type FileSort } from "./file-list-layout";
import {
  expandTreePaths,
  isProtectedTreePath,
  pathAncestors,
  toggleTreePath,
} from "./file-tree";
import {
  MAX_EDIT_BYTES,
  useSftpStore,
  type PaneSide,
  type SftpTab,
} from "./store";

interface TreeRow {
  entry: FileEntry;
  depth: number;
}

function treeRows(
  root: string,
  entriesByPath: Map<string, FileEntry[]>,
  expanded: Set<string>,
  followed: Set<string>,
  showHidden: boolean,
  sort: FileSort,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const append = (path: string, depth: number) => {
    const entries = visibleFileEntries(
      (entriesByPath.get(path) ?? []).filter(
        (entry) =>
          showHidden ||
          !(entry.hidden ?? entry.name.startsWith(".")) ||
          followed.has(entry.path),
      ),
      true,
      "",
      sort,
    );
    for (const entry of entries) {
      rows.push({ entry, depth });
      if (entry.kind === "dir" && expanded.has(entry.path)) {
        append(entry.path, depth + 1);
      }
    }
  };
  append(root, 1);
  return rows;
}

export function FileTree({
  side,
  tab,
  creating,
  onCreate,
  onCancelCreate,
  onRename,
  onDelete,
  onPermissions,
  sort,
}: {
  side: PaneSide;
  tab: SftpTab;
  creating: "file" | "folder" | null;
  onCreate: (name: string) => Promise<boolean>;
  onCancelCreate: () => void;
  onRename: (entry: FileEntry, name: string) => Promise<boolean>;
  onDelete: (entries: FileEntry[]) => void;
  onPermissions: (entry: FileEntry) => void;
  sort: FileSort;
}) {
  const { t } = useI18n();
  const navigate = useSftpStore((state) => state.navigate);
  const reconnectTab = useSftpStore((state) => state.reconnectTab);
  const setSelected = useSftpStore((state) => state.setSelected);
  const showHidden = useSftpStore((state) => state.showHidden);
  const openFile = useTabsStore((state) => state.openFile);
  const ancestors = useMemo(() => pathAncestors(tab.cwd), [tab.cwd]);
  const [entriesByPath, setEntriesByPath] = useState(
    () => new Map<string, FileEntry[]>(),
  );
  const entriesRef = useRef(entriesByPath);
  const [expanded, setExpanded] = useState(() => new Set(ancestors));
  const [loading, setLoading] = useState(() => new Set<string>());
  const [failed, setFailed] = useState(() => new Set<string>());
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const root = ancestors[0] ?? tab.cwd;

  const load = useCallback(
    async (path: string) => {
      if (entriesRef.current.has(path)) return;
      setLoading((current) => new Set(current).add(path));
      setFailed((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      try {
        const entries = await ipc.sftp.list(tab.connectionId, path);
        const next = new Map(entriesRef.current);
        next.set(path, entries);
        entriesRef.current = next;
        setEntriesByPath(next);
      } catch {
        setFailed((current) => new Set(current).add(path));
      } finally {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [tab.connectionId],
  );

  useEffect(() => {
    let cancelled = false;
    const expansionFrame = requestAnimationFrame(() => {
      if (!cancelled) {
        setExpanded((current) => expandTreePaths(current, ancestors));
      }
    });
    void (async () => {
      for (const path of ancestors.slice(0, -1)) {
        if (cancelled) return;
        await load(path);
      }
      if (cancelled) return;
      requestAnimationFrame(() => {
        treeRef.current
          ?.querySelector<HTMLElement>(
            `[data-file-tree-path="${CSS.escape(tab.cwd)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" });
      });
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(expansionFrame);
    };
  }, [ancestors, load, tab.cwd]);

  const visibleEntries = useMemo(() => {
    const next = new Map(entriesByPath);
    next.set(tab.cwd, tab.entries);
    return next;
  }, [entriesByPath, tab.cwd, tab.entries]);

  const rows = useMemo(
    () =>
      treeRows(
        root,
        visibleEntries,
        expanded,
        new Set(ancestors),
        showHidden,
        sort,
      ),
    [ancestors, expanded, root, showHidden, sort, visibleEntries],
  );

  if (tab.loading && !tab.cwd) {
    return <LoadingState label={t("sftp.loading")} fill />;
  }

  if (tab.error) {
    const canReconnect = tab.kind === "remote" && tab.status === "error";
    return (
      <EmptyState
        fill
        icon={tab.kind === "remote" ? WifiOff : CircleAlert}
        iconClassName="border-danger/15 bg-danger/10 text-danger"
        title={tab.error}
        action={
          canReconnect ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => reconnectTab(side, tab.id)}
            >
              {t("terminal.reconnect")}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const openEditor = (entry: FileEntry) => {
    if (entry.size > MAX_EDIT_BYTES) {
      toast.error(t("sftp.editor.tooLarge"));
      return;
    }
    openFile({
      connectionId: tab.connectionId,
      path: entry.path,
      name: entry.name,
    });
  };

  const toggle = (path: string) => {
    setExpanded((current) => toggleTreePath(current, path));
    if (path !== tab.cwd && !entriesRef.current.has(path)) void load(path);
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        ref={treeRef}
        role="tree"
        aria-label={t("sftp.fileTree")}
        className="py-1 text-xs"
      >
        <button
          type="button"
          role="treeitem"
          aria-expanded={expanded.has(root)}
          aria-current={tab.cwd === root ? "location" : undefined}
          data-file-tree-path={root}
          className={cn(
            "flex h-[var(--compact-row-height)] w-full items-center gap-1.5 px-1.5 text-left hover:bg-list-hover",
            tab.cwd === root && "bg-list-active text-list-active-foreground",
          )}
          onClick={() => toggle(root)}
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center"
            onClick={(event) => {
              event.stopPropagation();
              toggle(root);
            }}
          >
            {loading.has(root) ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : failed.has(root) ? (
              <CircleAlert className="size-3.5 text-danger" />
            ) : expanded.has(root) ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
          <FolderOpen className="size-4 shrink-0 text-warning" />
          <span className="truncate">{root}</span>
        </button>
        {expanded.has(root) &&
          rows.map(({ entry, depth }) => {
            const isDirectory = entry.kind === "dir";
            const isExpanded = expanded.has(entry.path);
            const selected = tab.selected.includes(entry.path);
            const current = tab.cwd === entry.path;
            const protectedDirectory = isProtectedTreePath(entry.path, tab.cwd);
            return (
              <ContextMenu key={entry.path}>
                <ContextMenuTrigger asChild>
                  <div
                    role="treeitem"
                    aria-expanded={isDirectory ? isExpanded : undefined}
                    aria-current={current ? "location" : undefined}
                    data-file-tree-path={entry.path}
                    className={cn(
                      "flex h-[var(--compact-row-height)] cursor-pointer select-none items-center gap-1.5 pr-2 hover:bg-list-hover",
                      (selected || current) &&
                        "bg-list-active text-list-active-foreground",
                    )}
                    style={{ paddingLeft: `${depth * 16 + 6}px` }}
                    onClick={() => {
                      setSelected(side, tab.id, [entry.path]);
                      if (isDirectory) toggle(entry.path);
                    }}
                    onDoubleClick={() => {
                      if (isDirectory) {
                        void navigate(side, tab.id, entry.path);
                      } else openEditor(entry);
                    }}
                    onContextMenu={() =>
                      setSelected(side, tab.id, [entry.path])
                    }
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center"
                      onClick={(event) => {
                        if (!isDirectory) return;
                        event.stopPropagation();
                        toggle(entry.path);
                      }}
                    >
                      {isDirectory && loading.has(entry.path) ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : isDirectory && failed.has(entry.path) ? (
                        <CircleAlert className="size-3.5 text-danger" />
                      ) : isDirectory && isExpanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : isDirectory ? (
                        <ChevronRight className="size-3.5" />
                      ) : null}
                    </span>
                    <EntryIcon entry={entry} />
                    {renamePath === entry.path ? (
                      <InlineNameInput
                        initialValue={entry.name}
                        ariaLabel={t("sftp.rename")}
                        onSubmit={async (name) => {
                          const renamed = await onRename(entry, name);
                          if (renamed) setRenamePath(null);
                          return renamed;
                        }}
                        onCancel={() => setRenamePath(null)}
                      />
                    ) : (
                      <span className="truncate">{entry.name}</span>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {isDirectory ? (
                    <ContextMenuItem
                      onSelect={() => void navigate(side, tab.id, entry.path)}
                    >
                      <FolderOpen /> {t("sftp.open")}
                    </ContextMenuItem>
                  ) : (
                    <ContextMenuItem onSelect={() => openEditor(entry)}>
                      <SquarePen /> {t("common.edit")}
                    </ContextMenuItem>
                  )}
                  {!protectedDirectory && <ContextMenuSeparator />}
                  {!protectedDirectory && (
                    <ContextMenuItem onSelect={() => setRenamePath(entry.path)}>
                      <TextCursorInput /> {t("sftp.rename")}
                    </ContextMenuItem>
                  )}
                  {entry.permissions !== null && !entry.isSymlink && (
                    <ContextMenuItem onSelect={() => onPermissions(entry)}>
                      <Lock /> {t("sftp.permissions.action")}
                    </ContextMenuItem>
                  )}
                  {!protectedDirectory && <ContextMenuSeparator />}
                  {!protectedDirectory && (
                    <ContextMenuItem
                      destructive
                      onSelect={() => onDelete([entry])}
                    >
                      <Trash2 /> {t("common.delete")}
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        {creating && (
          <div
            className="flex h-[var(--compact-row-height)] items-center gap-1.5 pr-2"
            style={{
              paddingLeft: `${pathAncestors(tab.cwd).length * 16 + 6}px`,
            }}
          >
            <span className="size-5 shrink-0" />
            {creating === "folder" ? (
              <Folder className="size-4 shrink-0 text-warning" />
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground" />
            )}
            <InlineNameInput
              initialValue=""
              ariaLabel={
                creating === "folder" ? t("sftp.newFolder") : t("sftp.newFile")
              }
              onSubmit={onCreate}
              onCancel={onCancelCreate}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
