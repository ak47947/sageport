import { describe, expect, it } from "vitest";

import {
  expandTreePaths,
  isProtectedTreePath,
  pathAncestors,
  toggleTreePath,
} from "./file-tree";

describe("pathAncestors", () => {
  it("returns Unix paths from root to the selected directory", () => {
    expect(pathAncestors("/home/me/project")).toEqual([
      "/",
      "/home",
      "/home/me",
      "/home/me/project",
    ]);
  });

  it("returns Windows paths from drive root to the selected directory", () => {
    expect(pathAncestors("C:\\Users\\me")).toEqual([
      "C:\\",
      "C:\\Users",
      "C:\\Users\\me",
    ]);
  });
});

describe("isProtectedTreePath", () => {
  it("protects the current directory and its ancestors", () => {
    expect(isProtectedTreePath("/home", "/home/me/project")).toBe(true);
    expect(isProtectedTreePath("/home/me/project", "/home/me/project")).toBe(
      true,
    );
  });

  it("allows operations on children and sibling directories", () => {
    expect(
      isProtectedTreePath("/home/me/project/src", "/home/me/project"),
    ).toBe(false);
    expect(isProtectedTreePath("/home/other", "/home/me/project")).toBe(false);
  });
});

describe("tree expansion", () => {
  it("expands the followed path without discarding manually expanded paths", () => {
    expect([
      ...expandTreePaths(new Set(["/var"]), ["/", "/home", "/home/me"]),
    ]).toEqual(["/var", "/", "/home", "/home/me"]);
  });

  it("returns the existing set when every followed path is expanded", () => {
    const expanded = new Set(["/", "/home"]);
    expect(expandTreePaths(expanded, ["/", "/home"])).toBe(expanded);
  });

  it("collapses an expanded path and reopens a collapsed path", () => {
    const collapsed = toggleTreePath(new Set(["/home"]), "/home");
    expect(collapsed.has("/home")).toBe(false);
    expect(toggleTreePath(collapsed, "/home").has("/home")).toBe(true);
  });
});
