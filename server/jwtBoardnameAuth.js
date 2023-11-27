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

(config = require("./configuration.js")),
  (jsonwebtoken = require("jsonwebtoken"));

/**
 * This function checks if a board name is set in the roles claim.
 * Returns true of the board name is set in the JWT and the board name matches the board name in the URL
 * @param {string} url
 * @param {string} boardNameIn
 @returns {boolean} - True if user does not have the role forbidden false if the user hase the role forbidden
 @throws {Error} - If no boardname match
 */

function checkBoardnameInToken(url, boardNameIn) {
  var token = url.searchParams.get("token");
  if (roleInBoard(token, boardNameIn) === "forbidden") {
    throw new Error("Acess Forbidden");
  }
}

function parse_role(role) {
  let [_, role_name, board_name] = role.match(/^([^:]*):?(.*)$/);
  return { role_name, board_name };
}

/**
 * This function checks if a oard name is set in the roles claim.
 * Returns string depending on the role in the board
 * @param {string} token
 * @param {string} board
 @returns {string}  "moderator"|"editor"|"forbidden"
 */
function roleInBoard(token, board = null) {
  if (config.AUTH_SECRET_KEY != "") {
    if (!token) {
      throw new Error("No token provided");
    }
    var payload = jsonwebtoken.verify(token, config.AUTH_SECRET_KEY);

    var roles = payload.roles;
    var oneHasBoardName = false;
    var oneHasModerator = false;

    if (roles) {
      for (var line of roles) {
        var role = parse_role(line);

        if (role.board_name !== "") {
          oneHasBoardName = true;
        }
        if (role.role_name === "moderator") {
          oneHasModerator = true;
        }
        if (role.board_name === board) {
          return role.role_name;
        }
      }
      if ((!board && oneHasModerator) || !oneHasBoardName) {
        if (oneHasModerator) {
          return "moderator";
        } else {
          return "editor";
        }
      }
      return "forbidden";
    } else {
      return "editor";
    }
  } else {
    return "editor";
  }
}

module.exports = { checkBoardnameInToken, roleInBoard };
