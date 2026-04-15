/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

import jsonwebtoken from "jsonwebtoken";
import { readConfiguration } from "./configuration.mjs";

function getConfig() {
  return readConfiguration();
}

/**
 * This function checks if a board name is set in the roles claim.
 * Returns true if the board name is set in the JWT and the board name matches the board name in the URL.
 * @param {URL} url
 * @param {string} boardNameIn
 * @throws {Error} - If no boardname match
 */

export function checkBoardnameInToken(url, boardNameIn) {
  if (getConfig().AUTH_SECRET_KEY === "") {
    return;
  }
  const token = url.searchParams.get("token");
  if (token === null || roleInBoard(token, boardNameIn) === "forbidden") {
    throw new Error("Acess Forbidden");
  }
}

/**
 * @param {string} role
 * @returns {{roleName: "moderator" | "editor" | "forbidden" | string, boardName: string}}
 */
function parseRole(role) {
  const match = role.match(/^([^:]*):?(.*)$/);
  if (!match) {
    return { roleName: "forbidden", boardName: "" };
  }
  const [, roleName, boardName] = match;
  return { roleName: roleName || "forbidden", boardName: boardName || "" };
}

/**
 * This function checks if a board name is set in the roles claim.
 * Returns a role name for the requested board.
 * @param {string} token
 * @param {string | null} [board]
 * @returns {"moderator" | "editor" | "reader" | "forbidden"}
 */
export function roleInBoard(token, board = null) {
  const config = getConfig();
  if (config.AUTH_SECRET_KEY === "") {
    return "editor";
  }

  if (!token) {
    throw new Error("No token provided");
  }

  const payload = jsonwebtoken.verify(token, config.AUTH_SECRET_KEY);
  const roles = payload.roles;
  let oneHasBoardName = false;
  let oneHasModerator = false;

  if (!roles) {
    return "editor";
  }

  for (const line of roles) {
    const role = parseRole(line);

    if (role.boardName !== "") {
      oneHasBoardName = true;
    }
    if (role.roleName === "moderator") {
      oneHasModerator = true;
    }
    if (role.boardName === board) {
      return role.roleName === "moderator" ||
        role.roleName === "editor" ||
        role.roleName === "reader"
        ? role.roleName
        : "forbidden";
    }
  }

  if ((!board && oneHasModerator) || !oneHasBoardName) {
    return oneHasModerator ? "moderator" : "editor";
  }

  return "forbidden";
}
