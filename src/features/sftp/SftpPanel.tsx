import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  History,
  Loader2,
  List,
  FolderTree,
  Search,
  SearchX,
  X,
} from "lucide-react";

import {
  Button,
  ConfirmDialog,
  ResizeHandle,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import type { DeletePhase, TransferPhase } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { activePane, findPane, useTabsStore } from "@/workbench/tabs";
import {
  PanelHeader,
  PANEL_HEADER_ACTION_CLASS,
} from "@/workbench/PanelHeader";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { FilePane } from "./FilePane";
import { useSftpStore } from "./store";
import { TransferHistoryDialog } from "./TransferHistoryDialog";
import { formatEta } from "./transfer-progress";

const PANE_MIN_W = 200;

export function SftpPanel({ height }: { height: number }) {
  const { t } = useI18n();
  const ratio = useSftpStore((s) => s.ratio);
  const setRatio = useSftpStore((s) => s.setRatio);
  const followTerminal = useSftpStore((s) => s.followTerminal);
  const panes = useSftpStore((s) => s.panes);
  const showHidden = useSftpStore((s) => s.showHidden);
  const toggleHidden = useSftpStore((s) => s.toggleHidden);
  const showFileToolbar = useSftpStore((s) => s.showFileToolbar);
  const toggleFileToolbar = useSftpStore((s) => s.toggleFileToolbar);
  const viewMode = useSftpStore((s) => s.viewMode);
  const setViewMode = useSftpStore((s) => s.setViewMode);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const lastPaneId = useTabsStore((s) => s.lastPaneId);
  const setTerminalCwd = useTabsStore((s) => s.setTerminalCwd);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pendingConflict = useSftpStore((s) => s.pendingConflict);
  const resolveConflict = useSftpStore((s) => s.resolveConflict);
  const cancelConflict = useSftpStore((s) => s.cancelConflict);
  const setConflictApplyToRemaining = useSftpStore(
    (s) => s.setConflictApplyToRemaining,
  );

  const bodyRef = useRef<HTMLDivElement>(null);

  const activeEditor = tabs.find((tab) => tab.id === activeId);
  const currentTerminal =
    activeEditor?.kind === "terminal"
      ? activePane(activeEditor)
      : findPane(tabs, lastPaneId);

  useEffect(() => {
    if (
      currentTerminal?.target !== "ssh" ||
      currentTerminal.status !== "connected"
    ) {
      return;
    }
    followTerminal("left", {
      id: currentTerminal.id,
      hostId: currentTerminal.hostId,
      title: currentTerminal.title,
      cwd: currentTerminal.cwd,
      cwdConfirmed: currentTerminal.cwdConfirmed,
    });
  }, [currentTerminal, followTerminal]);

  useEffect(() => {
    if (!currentTerminal || (currentTerminal.cwd && currentTerminal.home)) {
      return;
    }
    const followed = [...panes.left.tabs, ...panes.right.tabs].find(
      (tab) =>
        tab.followedPaneId === currentTerminal.id &&
        tab.status === "connected" &&
        tab.home &&
        (tab.cwd || currentTerminal.cwd),
    );
    if (followed) {
      setTerminalCwd(
        currentTerminal.id,
        currentTerminal.cwd || followed.cwd,
        followed.home,
      );
    }
  }, [currentTerminal, panes, setTerminalCwd]);

  useEffect(() => () => cancelConflict(), [cancelConflict]);

  const bodyWidth = () => bodyRef.current?.getBoundingClientRect().width ?? 0;

  const splitLimits = () => {
    const width = bodyWidth();
    const min = Math.min(
      PANE_MIN_W * zoomFactor(useZoomStore.getState().level),
      width / 2,
    );
    return { min, max: width - min };
  };

  const setSplit = (px: number) => {
    const width = bodyWidth();
    if (width === 0) return;
    const { min, max } = splitLimits();
    setRatio(Math.max(min, Math.min(px, max)) / width);
  };

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden border-t border-border-subtle bg-surface"
      style={{ height }}
    >
      <PanelHeader
        title={t("sftp.panelTitle")}
        actions={
          <>
            <Tooltip
              content={t(
                viewMode === "list" ? "sftp.viewAsTree" : "sftp.viewAsList",
              )}
            >
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                aria-label={t(
                  viewMode === "list" ? "sftp.viewAsTree" : "sftp.viewAsList",
                )}
                onClick={() =>
                  setViewMode(viewMode === "list" ? "tree" : "list")
                }
              >
                {viewMode === "list" ? (
                  <FolderTree className="size-4" />
                ) : (
                  <List className="size-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.toggleHidden")}>
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  PANEL_HEADER_ACTION_CLASS,
                  showHidden && "text-foreground",
                )}
                onClick={toggleHidden}
              >
                {showHidden ? (
                  <Eye className="size-4" />
                ) : (
                  <EyeOff className="size-4" />
                )}
              </Button>
            </Tooltip>
            {viewMode === "list" && (
              <Tooltip
                content={t(
                  showFileToolbar
                    ? "sftp.hideSearchToolbar"
                    : "sftp.showSearchToolbar",
                )}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    PANEL_HEADER_ACTION_CLASS,
                    showFileToolbar && "text-foreground",
                  )}
                  aria-label={t(
                    showFileToolbar
                      ? "sftp.hideSearchToolbar"
                      : "sftp.showSearchToolbar",
                  )}
                  aria-pressed={showFileToolbar}
                  onClick={toggleFileToolbar}
                >
                  {showFileToolbar ? (
                    <Search className="size-4" />
                  ) : (
                    <SearchX className="size-4" />
                  )}
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t("sftp.history.title")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.hidePanel")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                onClick={() => setPanelVisible(false)}
              >
                <X className="size-4" />
              </Button>
            </Tooltip>
          </>
        }
      />

      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${ratio * 100}%` }} className="flex min-w-0">
          <FilePane side="left" />
        </div>
        <ResizeHandle
          axis="x"
          getSize={() => ratio * bodyWidth()}
          onResize={setSplit}
          limits={splitLimits}
        />
        <div className="flex min-w-0 flex-1">
          <FilePane side="right" />
        </div>
      </div>

      <OperationStrip />

      <TransferHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <ConfirmDialog
        state={
          pendingConflict
            ? ({
                title: t("sftp.conflict.title"),
                description: (
                  <span className="flex flex-col gap-3">
                    <span>
                      {t("sftp.conflict.description", {
                        name: pendingConflict.name,
                      })}
                    </span>
                    {pendingConflict.remaining > 0 && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          checked={pendingConflict.applyToRemaining}
                          onChange={(event) =>
                            setConflictApplyToRemaining(event.target.checked)
                          }
                        />
                        {t("sftp.conflict.applyToRemaining", {
                          count: pendingConflict.remaining,
                        })}
                      </label>
                    )}
                  </span>
                ),
                cancelLabel: t("sftp.conflict.skip"),
                actions: [
                  {
                    label: t("sftp.conflict.keepBoth"),
                    variant: "primary",
                    onSelect: () => resolveConflict("rename"),
                  },
                  {
                    label: t("sftp.conflict.overwrite"),
                    variant: "destructive",
                    onSelect: () => resolveConflict("overwrite"),
                  },
                ],
              } satisfies ConfirmState)
            : null
        }
        onClose={() => resolveConflict("skip")}
      />
    </div>
  );
}

interface DisplayOperation {
  id: string;
  kind: "transfer" | "delete";
  label: string;
  currentPath?: string;
  completed: number;
  total: number;
  phase?: DeletePhase | TransferPhase;
  cancelRequested: boolean;
  speedBps: number;
  etaSeconds: number | null;
  onCancel: () => void;
  queued?: boolean;
}

function OperationStrip() {
  const { t } = useI18n();
  const transfers = useSftpStore((s) => s.transfers);
  const transferQueue = useSftpStore((s) => s.transferQueue);
  const deletions = useSftpStore((s) => s.deletions);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const moveQueuedTransfer = useSftpStore((s) => s.moveQueuedTransfer);
  const cancelDelete = useSftpStore((s) => s.cancelDelete);
  const queuePositions = new Map(
    transferQueue.map((transferId, index) => [transferId, index]),
  );

  const active: DisplayOperation[] = [
    ...Object.values(transfers)
      .sort((left, right) => {
        if (left.queued !== right.queued) return left.queued ? 1 : -1;
        if (!left.queued) return 0;
        return (
          (queuePositions.get(left.transferId) ?? 0) -
          (queuePositions.get(right.transferId) ?? 0)
        );
      })
      .map((operation) => ({
        id: operation.transferId,
        kind: "transfer" as const,
        label: operation.file,
        completed: operation.transferred,
        total: operation.total,
        phase: operation.phase,
        cancelRequested: operation.cancelRequested,
        speedBps: operation.speedBps,
        etaSeconds: operation.etaSeconds,
        onCancel: () => cancelTransfer(operation.transferId),
        queued: operation.queued,
      })),
    ...Object.values(deletions).map((operation) => ({
      id: operation.operationId,
      kind: "delete" as const,
      label: operation.label,
      currentPath: operation.currentPath,
      completed: operation.completed,
      total: operation.total,
      phase: operation.phase,
      cancelRequested: operation.cancelRequested,
      speedBps: 0,
      etaSeconds: null,
      onCancel: () => cancelDelete(operation.operationId),
    })),
  ];
  if (active.length === 0) return null;

  return (
    <div className="flex max-h-28 flex-col overflow-y-auto border-t border-border-subtle bg-surface px-2.5">
      {active.map((item) => {
        const pct =
          item.total > 0
            ? Math.max(
                0,
                Math.min(100, Math.round((item.completed / item.total) * 100)),
              )
            : 0;

        const indeterminate =
          item.kind === "delete"
            ? item.phase === "scanning" || item.total === 0
            : item.phase === "preparing" ||
              item.phase === "compressing" ||
              item.phase === "extracting";
        const speed =
          item.kind === "transfer" &&
          item.phase === "transferring" &&
          item.speedBps > 0
            ? `${formatBytes(item.speedBps)}/s`
            : "—";
        return (
          <div
            key={item.id}
            className="flex h-[var(--control-height-sm)] items-center gap-2 text-xs"
          >
            <span
              className="min-w-0 shrink truncate"
              title={item.currentPath || item.label}
            >
              {item.label}
            </span>
            {item.cancelRequested ? (
              <span className="shrink-0 text-2xs text-warning">
                {t("sftp.cancelling")}
              </span>
            ) : item.queued ? (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {t("sftp.queued")}
              </span>
            ) : item.phase ? (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {t(`sftp.phase.${item.phase}`)}
              </span>
            ) : null}
            <div
              role="progressbar"
              aria-label={item.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={indeterminate ? undefined : pct}
              className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "ui-progress-fill bg-primary",
                  indeterminate && "animate-pulse",
                )}
                style={{
                  transform: `scaleX(${indeterminate ? 1 : Math.max(0, Math.min(pct, 100)) / 100})`,
                }}
              />
            </div>
            {item.queued && (
              <div className="flex shrink-0 items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 rounded-md text-muted-foreground"
                  disabled={transferQueue.indexOf(item.id) <= 0}
                  aria-label={t("sftp.moveTransferUp")}
                  onClick={() => moveQueuedTransfer(item.id, -1)}
                >
                  <ArrowUp className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 rounded-md text-muted-foreground"
                  disabled={
                    transferQueue.indexOf(item.id) === -1 ||
                    transferQueue.indexOf(item.id) === transferQueue.length - 1
                  }
                  aria-label={t("sftp.moveTransferDown")}
                  onClick={() => moveQueuedTransfer(item.id, 1)}
                >
                  <ArrowDown className="size-3" />
                </Button>
              </div>
            )}
            {item.kind === "delete" && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.phase === "scanning"
                  ? t("sftp.operation.found", { count: item.completed })
                  : t("sftp.operation.itemProgress", {
                      completed: item.completed,
                      total: item.total,
                    })}
              </span>
            )}
            {item.kind === "transfer" && !indeterminate && (
              <>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(item.completed)}
                  {item.total > 0 && ` / ${formatBytes(item.total)}`}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {pct}%
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {speed}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {item.etaSeconds !== null && item.speedBps > 0
                    ? t("sftp.remaining", {
                        time: formatEta(item.etaSeconds),
                      })
                    : ""}
                </span>
              </>
            )}
            <Tooltip content={t("sftp.cancelOperation")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-5 shrink-0 rounded-md text-muted-foreground hover:text-danger"
                disabled={item.cancelRequested}
                aria-label={t("sftp.cancelOperation")}
                onClick={item.onCancel}
              >
                {item.cancelRequested ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </Button>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
