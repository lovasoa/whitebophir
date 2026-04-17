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

import { readConfiguration } from "./configuration.mjs";
import { forbidden } from "./boundary_errors.mjs";
import { roleInBoard } from "./jwtBoardnameAuth.mjs";

/**
 * Validates jwt and returns whether user is a moderator
 * @param {URL} url
 * @returns {boolean} - True if user is a moderator, else false
 * @throws {Error} - If no token is provided when it should be
 */
export function checkUserPermission(url) {
  const { AUTH_SECRET_KEY } = readConfiguration();
  if (AUTH_SECRET_KEY === "") {
    return false;
  }

  const token = url.searchParams.get("token");
  if (!token) {
    throw forbidden("missing_token");
  }

  const role = roleInBoard(token);
  if (role === "forbidden") {
    throw forbidden("invalid_token");
  }
  return role === "moderator";
}
