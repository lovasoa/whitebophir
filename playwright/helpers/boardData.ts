import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type StoredBoard = Record<string, any>;

export function withToken(url: string, token?: string, tokenQuery?: string) {
  const query = token ? `token=${token}` : tokenQuery;
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

export function boardFile(dataPath: string, name: string) {
  return path.join(dataPath, `board-${encodeURIComponent(name)}.json`);
}

export async function writeBoard(
  dataPath: string,
  name: string,
  storedBoard: StoredBoard,
) {
  await fsp.writeFile(boardFile(dataPath, name), JSON.stringify(storedBoard));
}

export async function readStoredBoard(dataPath: string, name: string) {
  try {
    const content = await fsp.readFile(boardFile(dataPath, name), "utf8");
    return JSON.parse(content) as StoredBoard;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") return {};
    throw err;
  }
}

export async function waitForStoredBoard(
  dataPath: string,
  name: string,
  predicate: (storedBoard: StoredBoard) => boolean | Promise<boolean>,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastStoredBoard = await readStoredBoard(dataPath, name);

  while (!(await predicate(lastStoredBoard))) {
    if (Date.now() >= deadline) {
      const keys = Object.keys(lastStoredBoard).sort();
      const visibleKeys = keys.length > 0 ? keys.join(", ") : "(empty)";
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for stored board "${name}" to satisfy the predicate. Last stored board keys: ${visibleKeys}`,
      );
    }
    await delay(100);
    lastStoredBoard = await readStoredBoard(dataPath, name);
  }

  return lastStoredBoard;
}
