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
import { forbidden } from "../http/boundary_errors.mjs";

/** @typedef {{ AUTH_SECRET_KEY: string }} JwtAuthConfig */

/**
 * Checks that the request's JWT grants access to the requested board name.
 * Pure with respect to `config`; does not read `process.env`.
 * @param {JwtAuthConfig} config
 * @param {URL} url
 * @param {string} boardNameIn
 * @throws {Error} - If no boardname match
 */

export function checkBoardnameInToken(config, url, boardNameIn) {
  if (config.AUTH_SECRET_KEY === "") {
    return;
  }
  const token = url.searchParams.get("token");
  if (
    token === null ||
    roleInBoard(config, token, boardNameIn) === "forbidden"
  ) {
    throw forbidden("access_forbidden");
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
 * @param {unknown} roleName
 * @returns {"moderator" | "editor" | "reader" | "forbidden"}
 */
function normalizeGrantedRole(roleName) {
  return roleName === "moderator" ||
    roleName === "editor" ||
    roleName === "reader"
    ? roleName
    : "forbidden";
}

/**
 * @param {string} token
 * @param {string} secret
 * @returns {unknown}
 */
function verifyTokenRoles(token, secret) {
  if (!token) return null;
  try {
    return jsonwebtoken.verify(token, secret).roles;
  } catch {
    return null;
  }
}

/**
 * @param {Iterable<string>} roles
 * @param {string | null} board
 * @returns {{
 *   matchingRole: "moderator" | "editor" | "reader" | "forbidden" | null,
 *   hasBoardName: boolean,
 *   hasModerator: boolean,
 * }}
 */
function summarizeBoardRoles(roles, board) {
  let matchingRole = null;
  let hasBoardName = false;
  let hasModerator = false;

  for (const line of roles) {
    const role = parseRole(line);
    if (role.boardName !== "") hasBoardName = true;
    if (role.roleName === "moderator") hasModerator = true;
    if (role.boardName === board) {
      matchingRole = normalizeGrantedRole(role.roleName);
    }
  }

  return { matchingRole, hasBoardName, hasModerator };
}

/**
 * This function checks if a board name is set in the roles claim.
 * Returns a role name for the requested board.
 * Pure with respect to `config`; does not read `process.env`.
 * @param {JwtAuthConfig} config
 * @param {string} token
 * @param {string | null} board
 * @returns {"moderator" | "editor" | "reader" | "forbidden"}
 */
export function roleInBoard(config, token, board) {
  if (config.AUTH_SECRET_KEY === "") return "editor";

  const roles = verifyTokenRoles(token, config.AUTH_SECRET_KEY);
  if (roles === null) return "forbidden";
  if (!roles) return "editor";

  const summary = summarizeBoardRoles(
    /** @type {Iterable<string>} */ (roles),
    board,
  );
  if (summary.matchingRole !== null) return summary.matchingRole;
  if ((!board && summary.hasModerator) || !summary.hasBoardName) {
    return summary.hasModerator ? "moderator" : "editor";
  }
  return "forbidden";
}
