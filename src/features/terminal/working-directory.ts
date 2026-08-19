function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function cwdFromOsc7(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      return decodePath(url.pathname);
    } catch {
      return null;
    }
  }
  return trimmed.startsWith("/") ? decodePath(trimmed) : null;
}

function shellWord(value: string): string | null {
  let result = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else result += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character) || /[;&|<>`$(){}]/.test(character)) return null;
    result += character;
  }

  return !quote && !escaped && result ? result : null;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function cwdFromCdCommand(
  command: string,
  currentCwd?: string,
  home?: string,
): string | null {
  const match = command.match(
    /^\s*(?:builtin\s+)?cd(?:\s+(?:--\s+)?(.+?))?\s*$/,
  );
  if (!match) return null;
  const argument = match[1] ? shellWord(match[1]) : "~";
  if (!argument || argument === "-") return null;

  let path: string;
  if (argument === "~") {
    if (!home) return null;
    path = home;
  } else if (argument.startsWith("~/")) {
    if (!home) return null;
    path = `${home.replace(/\/+$/, "")}/${argument.slice(2)}`;
  } else if (argument.startsWith("/")) {
    path = argument;
  } else {
    if (!currentCwd) return null;
    path = `${currentCwd.replace(/\/+$/, "")}/${argument}`;
  }

  return normalizePath(path);
}
