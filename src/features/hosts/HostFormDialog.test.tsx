// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { I18nProvider } from "@/i18n";
import { ipc } from "@/lib/ipc";
import type { Group, Host, Identity, SshKey } from "@/types/models";
import { HostFormDialog } from "./HostFormDialog";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
}));

const group: Group = {
  id: "group-1",
  name: "Production",
  parentId: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  revision: 1,
};

const host: Host = {
  id: "host-1",
  label: "web",
  address: "10.0.0.4",
  port: 22,
  groupId: "group-1",
  identityId: null,
  username: "root",
  authType: "password",
  keyId: null,
  osHint: null,
  notes: null,
  jumpHostId: null,
  startupCommand: null,
  hasPassword: true,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  revision: 1,
};

vi.mock("@/lib/ipc", () => ({
  ipc: {
    groups: { list: vi.fn(async () => [group]) },
    hosts: {
      list: vi.fn(async () => [host]),
      get: vi.fn(async () => host),
      update: vi.fn(async () => host),
      create: vi.fn(async () => host),
    },
    ssh: {
      testConnection: vi.fn(async () => undefined),
      cancelConnectionTest: vi.fn(async () => undefined),
    },
    keys: { list: vi.fn(async (): Promise<SshKey[]> => []) },
    identities: { list: vi.fn(async (): Promise<Identity[]> => []) },
    settings: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    },
  },
}));

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <HostFormDialog
          open
          hostId="host-1"
          initialGroupId={null}
          onClose={() => undefined}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("HostFormDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the host group when editing a grouped host", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByDisplayValue("web")).toBeTruthy();
    });

    const groupTrigger = screen
      .getAllByRole("combobox")
      .find((element) => element.textContent === "Production");
    expect(groupTrigger).toBeTruthy();
    expect(
      screen
        .queryAllByRole("combobox")
        .some((element) => element.textContent === "No group"),
    ).toBe(false);
  });

  it("tests the current form values without saving the host", async () => {
    renderDialog();

    const address = await screen.findByDisplayValue("10.0.0.4");
    fireEvent.change(address, { target: { value: "10.0.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(vi.mocked(ipc.ssh.testConnection)).toHaveBeenCalledWith(
        expect.any(String),
        "host-1",
        expect.objectContaining({
          address: "10.0.0.5",
          port: 22,
          username: "root",
          authType: "password",
          password: undefined,
        }),
      );
    });
    expect(vi.mocked(ipc.hosts.update)).not.toHaveBeenCalled();
  });

  it("cancels an active connection test when the editor closes", async () => {
    vi.mocked(ipc.ssh.testConnection).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const view = renderDialog();

    await screen.findByDisplayValue("10.0.0.4");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(vi.mocked(ipc.ssh.testConnection)).toHaveBeenCalled();
    });
    const requestId = vi.mocked(ipc.ssh.testConnection).mock.calls[0]?.[0];

    view.unmount();

    await waitFor(() => {
      expect(vi.mocked(ipc.ssh.cancelConnectionTest)).toHaveBeenCalledWith(
        requestId,
      );
    });
  });
});
