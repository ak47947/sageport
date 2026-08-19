import { describe, expect, it } from "vitest";

import { cwdFromCdCommand, cwdFromOsc7 } from "./working-directory";

describe("cwdFromOsc7", () => {
  it("reads encoded paths from file URLs", () => {
    expect(cwdFromOsc7("file://server/home/me/My%20Project")).toBe(
      "/home/me/My Project",
    );
  });

  it("accepts absolute paths and rejects invalid values", () => {
    expect(cwdFromOsc7("/srv/app")).toBe("/srv/app");
    expect(cwdFromOsc7("relative/path")).toBeNull();
    expect(cwdFromOsc7("file://server/%E0%A4%A")).toBeNull();
  });
});

describe("cwdFromCdCommand", () => {
  it("resolves absolute, relative, parent, and home paths", () => {
    expect(cwdFromCdCommand("cd /srv/app", "/home/me", "/home/me")).toBe(
      "/srv/app",
    );
    expect(cwdFromCdCommand("cd ../api", "/srv/web", "/home/me")).toBe(
      "/srv/api",
    );
    expect(cwdFromCdCommand("cd", "/srv/web", "/home/me")).toBe("/home/me");
    expect(cwdFromCdCommand("cd ~/src", "/srv/web", "/home/me")).toBe(
      "/home/me/src",
    );
  });

  it("supports quoted directory names", () => {
    expect(cwdFromCdCommand('cd "My Project"', "/home/me", "/home/me")).toBe(
      "/home/me/My Project",
    );
  });

  it("ignores compound and unsupported directory commands", () => {
    expect(
      cwdFromCdCommand("cd /srv && ls", "/home/me", "/home/me"),
    ).toBeNull();
    expect(cwdFromCdCommand("cd -", "/home/me", "/home/me")).toBeNull();
    expect(cwdFromCdCommand("pushd /srv", "/home/me", "/home/me")).toBeNull();
  });
});
