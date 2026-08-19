import { parentPath } from "./store";

export function pathAncestors(path: string): string[] {
  const result = [path];
  let current = path;
  for (let depth = 0; depth < 100; depth += 1) {
    const parent = parentPath(current);
    if (parent === current) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
}

export function isProtectedTreePath(path: string, cwd: string): boolean {
  return pathAncestors(cwd).includes(path);
}

export function expandTreePaths(
  current: Set<string>,
  paths: string[],
): Set<string> {
  if (paths.every((path) => current.has(path))) return current;
  return new Set([...current, ...paths]);
}

export function toggleTreePath(
  current: Set<string>,
  path: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
