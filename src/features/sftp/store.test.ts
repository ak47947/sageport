import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ssh: {
      disconnect: vi.fn(() => Promise.resolve()),
    },
    pty: {
      close: vi.fn(() => Promise.resolve()),
    },
    sftp: {
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => Promise.resolve()),
      home: vi.fn(() => Promise.resolve("/home/test")),
      list: vi.fn(() => Promise.resolve([])),
      transfer: vi.fn(() => Promise.resolve()),
      cancelTransfer: vi.fn(() => Promise.resolve()),
      deleteBatch: vi.fn(() => Promise.resolve()),
      cancelDelete: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.stubGlobal("localStorage", { getItem: vi.fn(() => "en") });

import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";
import { useToastStore } from "@/lib/toast";
import type {
  FileEntry,
  TransferEvent,
  TransferHistoryEntry,
} from "@/types/models";
import { findPane, useTabsStore } from "@/workbench/tabs";
import { transferHistoryKey } from "./api";
import {
  isValidEntryName,
  MAX_SFTP_TABS,
  parentPath,
  pathBaseName,
  useSftpStore,
  type SftpTab,
} from "./store";

const refreshDirectory = useSftpStore.getState().refresh;

afterEach(() => useSftpStore.getState().cancelConflict());

const loadedTab = (): SftpTab => ({
  id: "local-tab",
  kind: "local",
  connectionId: null,
  title: "Local",
  cwd: "/root",
  navigationPath: "/root/1",
  status: "connected",
  entries: [],
  selected: [],
  history: ["/", "/root"],
  historyIndex: 1,
  loading: false,
  error: "Path does not exist: /root/1",
});

describe("SFTP navigation state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.removeQueries({ queryKey: transferHistoryKey });
    useSftpStore.setState({
      panes: {
        left: { tabs: [loadedTab()], activeTabId: "local-tab" },
        right: { tabs: [], activeTabId: null },
      },
      transfers: {},
      deletions: {},
      refresh: refreshDirectory,
    });
  });

  it("returns from a failed path to the last loaded path before using history", () => {
    useSftpStore.getState().restoreLoadedPath("left", "local-tab");

    const tab = useSftpStore.getState().panes.left.tabs[0];
    expect(tab).toMatchObject({
      cwd: "/root",
      history: ["/", "/root"],
      historyIndex: 1,
    });
    expect(tab?.navigationPath).toBeUndefined();
    expect(tab?.error).toBeUndefined();
  });

  it("ignores a slower directory response after a newer navigation wins", async () => {
    let resolveSlow: ((entries: FileEntry[]) => void) | undefined;
    let resolveFast: ((entries: FileEntry[]) => void) | undefined;
    vi.mocked(ipc.sftp.list)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFast = resolve;
          }),
      );

    const slow = useSftpStore.getState().navigate("left", "local-tab", "/slow");
    const fast = useSftpStore.getState().navigate("left", "local-tab", "/fast");
    resolveFast?.([]);
    await fast;
    resolveSlow?.([]);
    await slow;

    const tab = useSftpStore.getState().panes.left.tabs[0];
    expect(tab?.cwd).toBe("/fast");
    expect(tab?.history.at(-1)).toBe("/fast");
  });

  it("invalidates tree caches when the current directory is refreshed", async () => {
    await useSftpStore
      .getState()
      .navigate("left", "local-tab", "/root/projects");
    expect(
      useSftpStore.getState().panes.left.tabs[0]?.treeRevision,
    ).toBeUndefined();

    await useSftpStore.getState().refresh("left", "local-tab");

    expect(useSftpStore.getState().panes.left.tabs[0]?.treeRevision).toBe(1);
  });
});

describe("SFTP path and name helpers", () => {
  it("finds parent folders without escaping POSIX, drive, or UNC roots", () => {
    expect(parentPath("/home/test/")).toBe("/home");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("C:\\Users\\test")).toBe("C:\\Users");
    expect(parentPath("C:\\")).toBe("C:\\");
    expect(parentPath("\\\\server\\share\\folder")).toBe("\\\\server\\share\\");
    expect(parentPath("\\\\server\\share\\")).toBe("\\\\server\\share\\");
  });

  it("derives bookmark labels from POSIX and Windows paths", () => {
    expect(pathBaseName("/home/test/")).toBe("test");
    expect(pathBaseName("C:\\Users\\test\\")).toBe("test");
  });

  it("rejects path traversal and overlong inline names", () => {
    expect(isValidEntryName("report.txt")).toBe(true);
    expect(isValidEntryName("..")).toBe(false);
    expect(isValidEntryName("nested/file")).toBe(false);
    expect(isValidEntryName("nested\\file")).toBe(false);
    expect(isValidEntryName("x".repeat(256))).toBe(false);
  });
});

describe("SFTP file toolbar visibility", () => {
  it("starts in tree view", () => {
    expect(useSftpStore.getInitialState().viewMode).toBe("tree");
  });

  it("starts hidden and toggles from the panel header", () => {
    expect(useSftpStore.getInitialState().showFileToolbar).toBe(false);
    useSftpStore.setState({ showFileToolbar: false });

    useSftpStore.getState().toggleFileToolbar();
    expect(useSftpStore.getState().showFileToolbar).toBe(true);

    useSftpStore.getState().toggleFileToolbar();
    expect(useSftpStore.getState().showFileToolbar).toBe(false);
  });
});

describe("SFTP terminal following", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSftpStore.setState({
      panes: {
        left: { tabs: [], activeTabId: null },
        right: { tabs: [], activeTabId: null },
      },
      transfers: {},
      deletions: {},
    });
    useTabsStore.setState({
      tabs: [],
      activeId: null,
      lastPaneId: null,
      pendingCloseId: null,
      pendingWindowClose: false,
    });
  });

  it("opens the current server instead of a local tab", () => {
    useSftpStore.getState().followTerminal("left", {
      id: "terminal-1",
      hostId: "host-1",
      title: "Production",
      cwd: "/srv/app",
      cwdConfirmed: true,
    });

    const pane = useSftpStore.getState().panes.left;
    expect(pane.tabs).toHaveLength(1);
    expect(pane.tabs[0]).toMatchObject({
      kind: "remote",
      hostId: "host-1",
      title: "Production",
      followedPaneId: "terminal-1",
      followPath: "/srv/app",
    });
    expect(pane.activeTabId).toBe(pane.tabs[0]?.id);
    expect(ipc.sftp.connect).toHaveBeenCalledWith(
      pane.tabs[0]?.connectionId,
      "host-1",
    );
    expect(ipc.sftp.home).not.toHaveBeenCalled();
  });

  it("closes the followed remote tab when its terminal closes", () => {
    const terminalId = useTabsStore
      .getState()
      .openTerminal({ id: "host-1", label: "Production" });
    expect(terminalId).not.toBeNull();
    const remote = transferTab("remote-1", "connection-1", "/srv/app");
    remote.hostId = "host-1";
    remote.followedPaneId = terminalId!;
    useSftpStore.setState({
      panes: {
        left: { tabs: [remote], activeTabId: remote.id },
        right: { tabs: [], activeTabId: null },
      },
    });

    useTabsStore.getState().close(terminalId!);

    expect(useSftpStore.getState().panes.left).toEqual({
      tabs: [],
      activeTabId: null,
    });
    expect(ipc.sftp.disconnect).toHaveBeenCalledWith("connection-1");
  });

  it("keeps remote tabs that are not following the closed terminal", () => {
    const terminalId = useTabsStore
      .getState()
      .openTerminal({ id: "host-1", label: "Production" });
    expect(terminalId).not.toBeNull();
    const remote = transferTab("remote-1", "connection-1", "/srv/app");
    remote.hostId = "host-1";
    useSftpStore.setState({
      panes: {
        left: { tabs: [remote], activeTabId: remote.id },
        right: { tabs: [], activeTabId: null },
      },
    });

    useTabsStore.getState().close(terminalId!);

    expect(useSftpStore.getState().panes.left.tabs).toEqual([remote]);
    expect(ipc.sftp.disconnect).not.toHaveBeenCalled();
  });

  it("reuses the server tab and navigates to the terminal directory", async () => {
    const remote = transferTab("remote-1", "connection-1", "/home/test");
    remote.hostId = "host-1";
    remote.followedPaneId = "terminal-1";
    useSftpStore.setState({
      panes: {
        left: { tabs: [remote], activeTabId: remote.id },
        right: { tabs: [], activeTabId: null },
      },
    });

    useSftpStore.getState().followTerminal("left", {
      id: "terminal-1",
      hostId: "host-1",
      title: "Production",
      cwd: "/srv/app",
      cwdConfirmed: false,
    });

    await vi.waitFor(() =>
      expect(useSftpStore.getState().panes.left.tabs[0]?.cwd).toBe("/srv/app"),
    );
    expect(useSftpStore.getState().panes.left.tabs).toHaveLength(1);
    expect(ipc.sftp.list).toHaveBeenCalledWith("connection-1", "/srv/app");
  });

  it("confirms an inferred terminal directory after SFTP loads it", async () => {
    const terminalId = useTabsStore
      .getState()
      .openTerminal({ id: "host-1", label: "Production" });
    expect(terminalId).not.toBeNull();
    useTabsStore
      .getState()
      .setTerminalCwd(terminalId!, "/srv/app", "/home/test", false);

    const remote = transferTab("remote-1", "connection-1", "/home/test");
    remote.hostId = "host-1";
    remote.followedPaneId = terminalId!;
    useSftpStore.setState({
      panes: {
        left: { tabs: [remote], activeTabId: remote.id },
        right: { tabs: [], activeTabId: null },
      },
    });

    useSftpStore.getState().followTerminal("left", {
      id: terminalId!,
      hostId: "host-1",
      title: "Production",
      cwd: "/srv/app",
      cwdConfirmed: false,
    });

    await vi.waitFor(() =>
      expect(
        findPane(useTabsStore.getState().tabs, terminalId!)?.cwdConfirmed,
      ).toBe(true),
    );
  });

  it("restores the previous directory when an inferred path does not exist", async () => {
    const terminalId = useTabsStore
      .getState()
      .openTerminal({ id: "host-1", label: "Production" });
    expect(terminalId).not.toBeNull();
    useTabsStore
      .getState()
      .setTerminalCwd(terminalId!, "/missing", "/home/test", false);

    const remote = transferTab("remote-1", "connection-1", "/home/test");
    remote.hostId = "host-1";
    remote.followedPaneId = terminalId!;
    useSftpStore.setState({
      panes: {
        left: { tabs: [remote], activeTabId: remote.id },
        right: { tabs: [], activeTabId: null },
      },
    });
    vi.mocked(ipc.sftp.list).mockRejectedValueOnce({
      code: "not_found",
      message: "missing",
    });

    useSftpStore.getState().followTerminal("left", {
      id: terminalId!,
      hostId: "host-1",
      title: "Production",
      cwd: "/missing",
      cwdConfirmed: false,
    });

    await vi.waitFor(() =>
      expect(findPane(useTabsStore.getState().tabs, terminalId!)).toMatchObject(
        {
          cwd: "/home/test",
          cwdConfirmed: true,
        },
      ),
    );
    expect(useSftpStore.getState().panes.left.tabs[0]).toMatchObject({
      cwd: "/home/test",
      error: undefined,
      navigationPath: undefined,
    });
  });
});

describe("SFTP tab ordering", () => {
  beforeEach(() => {
    const leftTabs = [
      transferTab("left-a", null, "/a"),
      transferTab("left-b", null, "/b"),
      transferTab("left-c", null, "/c"),
    ];
    useSftpStore.setState({
      panes: {
        left: { tabs: leftTabs, activeTabId: "left-b" },
        right: {
          tabs: [transferTab("right-a", null, "/right")],
          activeTabId: "right-a",
        },
      },
      transfers: {},
      deletions: {},
    });
  });

  it("reorders tabs only within the requested pane", () => {
    const originalActive = useSftpStore.getState().panes.left.tabs[1];

    useSftpStore.getState().moveTab("left", "left-a", 2);

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.map((tab) => tab.id)).toEqual([
      "left-b",
      "left-c",
      "left-a",
    ]);
    expect(left.activeTabId).toBe("left-b");
    expect(left.tabs[0]).toBe(originalActive);
    expect(right.tabs.map((tab) => tab.id)).toEqual(["right-a"]);
  });

  it("clamps the destination and ignores unknown tabs", () => {
    useSftpStore.getState().moveTab("left", "left-a", 100);
    expect(
      useSftpStore.getState().panes.left.tabs.map((tab) => tab.id),
    ).toEqual(["left-b", "left-c", "left-a"]);

    useSftpStore.getState().moveTab("left", "missing", 0);
    expect(
      useSftpStore.getState().panes.left.tabs.map((tab) => tab.id),
    ).toEqual(["left-b", "left-c", "left-a"]);
  });
});

describe("SFTP tab limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useSftpStore.setState({
      panes: {
        left: {
          tabs: Array.from({ length: MAX_SFTP_TABS - 1 }, (_, i) =>
            transferTab(`left-${i}`, null, `/left-${i}`),
          ),
          activeTabId: "left-0",
        },
        right: {
          tabs: [transferTab("right-0", "remote-0", "/right")],
          activeTabId: "right-0",
        },
      },
      transfers: {},
      deletions: {},
    });
  });

  it("counts tabs across both panes and rejects tabs over the limit", async () => {
    await useSftpStore.getState().addLocalTab("right");

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.length + right.tabs.length).toBe(MAX_SFTP_TABS);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("allows another tab after one is closed", async () => {
    useSftpStore.getState().closeTab("left", "left-0");
    await useSftpStore.getState().addLocalTab("left");

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.length + right.tabs.length).toBe(MAX_SFTP_TABS);
  });

  it("silently skips repeated automatic initialization at the limit", async () => {
    useSftpStore.setState({
      panes: {
        left: { tabs: [], activeTabId: null },
        right: {
          tabs: Array.from({ length: MAX_SFTP_TABS }, (_, i) =>
            transferTab(`right-${i}`, `remote-${i}`, `/right-${i}`),
          ),
          activeTabId: "right-0",
        },
      },
    });

    await Promise.all([
      useSftpStore.getState().ensureLocalTab("left"),
      useSftpStore.getState().ensureLocalTab("left"),
    ]);

    expect(useSftpStore.getState().panes.left.tabs).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(ipc.sftp.home).not.toHaveBeenCalled();
  });
});

function transferTab(
  id: string,
  connectionId: string | null,
  cwd: string,
): SftpTab {
  return {
    id,
    kind: connectionId ? "remote" : "local",
    connectionId,
    title: id,
    cwd,
    status: "connected",
    entries: [],
    selected: [],
    history: [cwd],
    historyIndex: 0,
    loading: false,
  };
}

describe("SFTP transfer refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSftpStore.setState({
      panes: {
        left: {
          tabs: [
            transferTab("left-target", null, "/downloads"),
            transferTab("left-other", null, "/documents"),
          ],
          activeTabId: "left-target",
        },
        right: {
          tabs: [transferTab("right-source", "remote-1", "/uploads")],
          activeTabId: "right-source",
        },
      },
      transfers: {},
      deletions: {},
      refresh: refreshDirectory,
    });
  });

  it("refreshes only the original destination tab after a right-to-left transfer", async () => {
    const entry: FileEntry = {
      name: "report.pdf",
      path: "/uploads/report.pdf",
      kind: "file",
      size: 42,
      modified: null,
      permissions: null,
      isSymlink: false,
    };

    await useSftpStore.getState().transfer("right", [entry]);

    expect(ipc.sftp.transfer).toHaveBeenCalledOnce();
    const [transferId] = vi.mocked(ipc.sftp.transfer).mock.calls[0];
    useSftpStore.getState().setActive("left", "left-other");
    const refresh = vi.fn(() => Promise.resolve());
    useSftpStore.setState({ refresh });

    const completed: TransferEvent = {
      transferId,
      transferred: entry.size,
      total: entry.size,
      file: entry.name,
      status: "done",
    };
    useSftpStore.getState().applyTransfer(completed);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith("left", "left-target");
  });

  it("updates active transfer byte counts in the history cache", () => {
    const entry: TransferHistoryEntry = {
      id: "transfer-1",
      sourceLabel: "report.pdf",
      sourcePath: "/uploads/report.pdf",
      sourceConnectionId: "remote-1",
      sourceHostLabel: "Production",
      destPath: "/downloads",
      destConnectionId: null,
      destHostLabel: null,
      totalBytes: 0,
      transferredBytes: 0,
      status: "active",
      startedAt: "2026-07-23T08:00:00Z",
      finishedAt: null,
    };
    queryClient.setQueryData(transferHistoryKey, [entry]);

    useSftpStore.getState().applyTransfer({
      transferId: entry.id,
      transferred: 512,
      total: 1024,
      file: entry.sourceLabel,
      status: "active",
      phase: "transferring",
    });

    expect(
      queryClient.getQueryData<TransferHistoryEntry[]>(transferHistoryKey)?.[0],
    ).toMatchObject({
      transferredBytes: 512,
      totalBytes: 1024,
      status: "active",
    });
  });
});

describe("SFTP connection races", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSftpStore.setState({
      panes: {
        left: {
          tabs: [transferTab("remote", "connection-1", "")],
          activeTabId: "remote",
        },
        right: { tabs: [], activeTabId: null },
      },
      transfers: {},
      deletions: {},
      pendingConflict: null,
    });
    useSftpStore.setState((state) => ({
      panes: {
        ...state.panes,
        left: {
          ...state.panes.left,
          tabs: state.panes.left.tabs.map((tab) => ({
            ...tab,
            hostId: "host-1",
            status: "connecting" as const,
          })),
        },
      },
    }));
  });

  it("does not reconnect a tab after it is closed", async () => {
    let finishDisconnect: (() => void) | undefined;
    vi.mocked(ipc.sftp.disconnect).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
        }),
    );

    useSftpStore.getState().reconnectTab("left", "remote");
    useSftpStore.getState().closeTab("left", "remote");
    finishDisconnect?.();

    await Promise.resolve();
    await Promise.resolve();
    expect(ipc.sftp.connect).not.toHaveBeenCalled();
  });

  it("ignores home directory recovery from an earlier connection", async () => {
    let finishHome: ((path: string) => void) | undefined;
    vi.mocked(ipc.sftp.home).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishHome = resolve;
        }),
    );

    useSftpStore.getState().applyStatus("connection-1", "connected");
    useSftpStore.getState().reconnectTab("left", "remote");
    finishHome?.("/stale-home");

    await vi.waitFor(() => expect(ipc.sftp.home).toHaveBeenCalled());
    expect(ipc.sftp.list).not.toHaveBeenCalled();
    expect(useSftpStore.getState().panes.left.tabs[0]?.cwd).toBe("");
  });
});

describe("SFTP conflict lifecycle", () => {
  it("cancels a waiting transfer when an involved tab closes", async () => {
    const entry: FileEntry = {
      name: "report.txt",
      path: "/source/report.txt",
      kind: "file",
      size: 10,
      modified: null,
      permissions: null,
      isSymlink: false,
    };
    const destination = { ...entry, path: "/destination/report.txt" };
    useSftpStore.setState({
      panes: {
        left: {
          tabs: [
            { ...transferTab("source", null, "/source"), entries: [entry] },
          ],
          activeTabId: "source",
        },
        right: {
          tabs: [
            {
              ...transferTab("destination", null, "/destination"),
              entries: [destination],
            },
          ],
          activeTabId: "destination",
        },
      },
      transfers: {},
      deletions: {},
      pendingConflict: null,
    });

    const transfer = useSftpStore.getState().transfer("left", [entry]);
    await vi.waitFor(() =>
      expect(useSftpStore.getState().pendingConflict).not.toBeNull(),
    );
    useSftpStore.getState().closeTab("right", "destination");
    await transfer;

    expect(useSftpStore.getState().pendingConflict).toBeNull();
    expect(ipc.sftp.transfer).not.toHaveBeenCalled();
  });
});

describe("SFTP delete operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useSftpStore.setState({
      panes: {
        left: {
          tabs: [transferTab("left-source", "remote-1", "/uploads")],
          activeTabId: "left-source",
        },
        right: { tabs: [], activeTabId: null },
      },
      transfers: {},
      deletions: {},
      refresh: refreshDirectory,
    });
  });

  it("starts one background operation for a batch and tracks item progress", async () => {
    const entries: FileEntry[] = [
      {
        name: "logs",
        path: "/uploads/logs",
        kind: "dir",
        size: 0,
        modified: null,
        permissions: null,
        isSymlink: false,
      },
      {
        name: "report.txt",
        path: "/uploads/report.txt",
        kind: "file",
        size: 42,
        modified: null,
        permissions: null,
        isSymlink: false,
      },
    ];

    await useSftpStore.getState().deleteEntries("left", "left-source", entries);

    expect(ipc.sftp.deleteBatch).toHaveBeenCalledOnce();
    const [operationId, connectionId, requested] = vi.mocked(
      ipc.sftp.deleteBatch,
    ).mock.calls[0];
    expect(connectionId).toBe("remote-1");
    expect(requested).toEqual(entries.map(({ path }) => ({ path })));
    expect(useSftpStore.getState().deletions[operationId]).toMatchObject({
      label: "2 items",
      phase: "scanning",
      completed: 0,
    });

    useSftpStore.getState().applyDelete({
      operationId,
      connectionId,
      completed: 3,
      total: 8,
      currentPath: "/uploads/logs/app.log",
      status: "active",
      phase: "deleting",
    });

    expect(useSftpStore.getState().deletions[operationId]).toMatchObject({
      completed: 3,
      total: 8,
      phase: "deleting",
    });
  });

  it("reloads the tab and tree parents when deletion finishes", async () => {
    const entry: FileEntry = {
      name: "logs",
      path: "/uploads/logs",
      kind: "dir",
      size: 0,
      modified: null,
      permissions: null,
      isSymlink: false,
    };
    await useSftpStore.getState().deleteEntries("left", "left-source", [entry]);
    const [operationId] = vi.mocked(ipc.sftp.deleteBatch).mock.calls[0];
    const reloadEntries = vi.fn(() => Promise.resolve());
    const refreshTreePaths = vi.fn();
    useSftpStore.setState({ reloadEntries, refreshTreePaths });

    useSftpStore.getState().applyDelete({
      operationId,
      connectionId: "remote-1",
      completed: 4,
      total: 4,
      currentPath: entry.path,
      status: "done",
    });

    expect(useSftpStore.getState().deletions[operationId]).toBeUndefined();
    expect(reloadEntries).toHaveBeenCalledWith("left", "left-source");
    expect(refreshTreePaths).toHaveBeenCalledWith("left", "left-source", []);
  });

  it("marks deletion as cancelling before requesting cancellation", async () => {
    const entry: FileEntry = {
      name: "report.txt",
      path: "/uploads/report.txt",
      kind: "file",
      size: 42,
      modified: null,
      permissions: null,
      isSymlink: false,
    };
    await useSftpStore.getState().deleteEntries("left", "left-source", [entry]);
    const [operationId] = vi.mocked(ipc.sftp.deleteBatch).mock.calls[0];

    useSftpStore.getState().cancelDelete(operationId);

    expect(
      useSftpStore.getState().deletions[operationId]?.cancelRequested,
    ).toBe(true);
    expect(ipc.sftp.cancelDelete).toHaveBeenCalledWith(operationId);
  });
});
