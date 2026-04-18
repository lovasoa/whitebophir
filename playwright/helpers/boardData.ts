import * as fsp from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  boardJsonPath,
  parseLegacyStoredBoard,
} from "../../server/legacy_json_board_source.mjs";
import { parseStoredSvgItem } from "../../server/stored_svg_item_codec.mjs";
import { boardSvgPath } from "../../server/svg_board_store.mjs";
import {
  parseStoredSvgEnvelope,
  parseStoredSvgItems,
} from "../../server/svg_envelope.mjs";

export type StoredBoard = Record<string, any>;

export function withToken(url: string, token?: string, tokenQuery?: string) {
  const query = token ? `token=${token}` : tokenQuery;
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function parseStoredSvgBoard(svg: string): StoredBoard {
  const envelope = parseStoredSvgEnvelope(svg);
  const board: StoredBoard = {};
  for (const itemEntry of parseStoredSvgItems(envelope.drawingAreaContent)) {
    const item = parseStoredSvgItem(itemEntry);
    if (item?.id) {
      board[item.id] = item;
    }
  }
  return board;
}

export async function writeBoard(
  dataPath: string,
  name: string,
  storedBoard: StoredBoard,
) {
  await fsp.writeFile(
    boardJsonPath(name, dataPath),
    JSON.stringify(storedBoard),
  );
}

export async function readStoredBoard(dataPath: string, name: string) {
  try {
    return parseStoredSvgBoard(
      await fsp.readFile(boardSvgPath(name, dataPath), "utf8"),
    );
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    return parseLegacyStoredBoard(
      JSON.parse(await fsp.readFile(boardJsonPath(name, dataPath), "utf8")),
    ).board as StoredBoard;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  return {};
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
