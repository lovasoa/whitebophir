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

config = require("./configuration.js"),
    jsonwebtoken = require("jsonwebtoken");

/**
 * Validates jwt and returns whether board name fits to the board name given in the JWT
 * @param {URL} url
 * @param {string} boardNameIn
 * @returns {boolean} - True if user is a moderator, else false
 * @throws {Error} - If no token is provided when it should be or when the board name is incorrect
 */
function checkBoardName(url, boardNameIn) {
    var roomIsCorrect = true;
    if (config.AUTH_SECRET_KEY != "") {
        var token = url.searchParams.get("token");
        if (token) {
            roomIsCorrect = getBoardnamefromToken(token, boardNameIn);
        } else {
            throw new Error("No token provided");
        }
    }
    return roomIsCorrect;
}

/**
 * Check if user is a moderator
 * @param {string} token
 * @param {string} boardNameIn
 */

function getBoardnamefromToken(token, boardNameIn) {
    if (config.AUTH_SECRET_KEY != "") {
        var payload = jsonwebtoken.verify(token, config.AUTH_SECRET_KEY);
        var roles = payload.roles;
        var oneHasBoardName = false;
        var oneHasCorretBoardname = false;

        var regex = new RegExp(":\ *"+boardNameIn+"$","gm");
        console.log(regex);
        if (roles) {
            for (var r in roles) {
                var role = roles[r]

                console.log(role);
                if (role.includes(':')) {
                    console.log('found :')
                    oneHasBoardName = true;
                }
                if (role.match(regex)) {
                    console.log('found Boardname')
                    return true;
                }
            }
            if (!oneHasBoardName) {
                return true;
            }

            throw new Error("No board name match");

        } else {
            throw new Error("No board name provided");
        }
    }
}

module.exports = {checkBoardName};
