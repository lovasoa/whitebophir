import {
  canonicalizeBoardName,
  decodeAndValidateBoardName,
  decodeBoardName,
  isValidBoardName,
} from "../../client-data/js/board_name.js";
import { BoardPermissions } from "../auth/board_capabilities.mjs";
import {
  appendSetCookieHeader,
  generateUserSecret,
  getUserSecretCookiePath,
  getUserSecretFromCookieHeader,
  serializeUserSecretCookie,
} from "../auth/user_secret_cookie.mjs";
import { pinReplayBaseline } from "../board/registry.mjs";
import { badRequest } from "../http/boundary_errors.mjs";
import { requestScheme } from "../http/observation.mjs";
import { publicPath } from "../http/request_url.mjs";
import { isEditBanned } from "../socket/bans.mjs";
import { resolveRequestClientIpSafe } from "../socket/policy.mjs";

/** @import { HttpRequest, HttpResponse, ObservedHttpRequest, ServerConfig } from "../../types/server-runtime.d.ts" */

/**
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
function parseIfNoneMatch(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {string | string[] | undefined} ifNoneMatch
 * @param {string} etag
 * @returns {boolean}
 */
function matchesIfNoneMatch(ifNoneMatch, etag) {
  if (ifNoneMatch === undefined) return false;
  const values = parseIfNoneMatch(ifNoneMatch);
  return values.includes("*") || values.includes(etag);
}

/**
 * @param {number | string} seq
 * @returns {string}
 */
function boardPageETag(seq) {
  return `W/"wbo-seq-${Number(seq) || 0}"`;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function parseBoardPageETag(value) {
  const match =
    /^W\/"wbo-seq-(\d+)"$/.exec(value) || /^"wbo-seq-(\d+)"$/.exec(value);
  if (!match?.[1]) return null;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

/**
 * Converts If-None-Match into board seq candidates for weak board-page ETags.
 *
 * @param {string | string[] | undefined} value
 * @returns {number[]}
 */
function parseBoardPageETagCandidates(value) {
  return parseIfNoneMatch(value)
    .map(parseBoardPageETag)
    .filter((seq) => seq !== null);
}

/**
 * Pins the served seq so the subsequent socket handshake can replay from this
 * baseline.
 *
 * @param {string} boardName
 * @param {number} baselineSeq
 * @param {ServerConfig} config
 * @returns {void}
 */
function pinServedBoardBaseline(boardName, baselineSeq, config) {
  pinReplayBaseline(
    boardName,
    baselineSeq,
    Date.now() + Math.max(0, config.MAX_SAVE_DELAY),
  );
}

/**
 * @param {ObservedHttpRequest} observed
 * @param {string} boardName
 * @returns {void}
 */
function annotateBoardRequest(observed, boardName) {
  observed.annotate({ board: boardName });
  observed.setTraceAttributes({ board: boardName });
}

/**
 * @param {string} boardName
 * @param {string} operation
 * @param {{[key: string]: unknown}=} extras
 * @returns {{[key: string]: unknown}}
 */
function boardOperationTraceAttributes(boardName, operation, extras) {
  return {
    "wbo.board": boardName,
    "wbo.board.operation": operation,
    ...(extras || {}),
  };
}

/**
 * @param {URL} parsedUrl
 * @returns {string}
 */
function requireBoardQueryName(parsedUrl) {
  const boardName = parsedUrl.searchParams.get("board") || "anonymous";
  if (!isValidBoardName(boardName)) throw badRequest("invalid_board_name");
  return boardName;
}

/**
 * @param {Record<string, string>} params
 * @param {string} [name]
 * @returns {string}
 */
function requireBoardPathName(params, name = "board") {
  const boardName = decodeAndValidateBoardName(params[name]);
  if (boardName === null) throw badRequest("invalid_board_name");
  return boardName;
}

/**
 * @param {Record<string, string>} params
 * @param {string} [name]
 * @returns {{requestedBoardName: string, boardName: string}}
 */
function requireBoardDocumentNames(params, name = "board") {
  const requestedBoardName = decodeBoardName(params[name]);
  if (requestedBoardName === null) throw badRequest("invalid_board_name");
  const boardName = canonicalizeBoardName(requestedBoardName);
  if (!isValidBoardName(boardName)) throw badRequest("invalid_board_name");
  return { requestedBoardName, boardName };
}

/**
 * @param {ServerConfig} config
 * @param {string} boardName
 * @param {string} [search]
 * @returns {string}
 */
function boardDocumentLocation(config, boardName, search = "") {
  return `${publicPath(config, `/boards/${encodeURIComponent(boardName)}`)}${search}`;
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {ServerConfig} config
 * @returns {void}
 */
function ensureBoardUserSecretCookie(request, response, parsedUrl, config) {
  const existingUserSecret = getUserSecretFromCookieHeader(
    request.headers.cookie,
  );
  if (existingUserSecret !== "") return;
  appendSetCookieHeader(
    response,
    serializeUserSecretCookie(generateUserSecret(), {
      path: getUserSecretCookiePath(parsedUrl.pathname),
      secure: requestScheme(request, config) === "https",
    }),
  );
}

/**
 * Resolves board permissions from the common HTTP token and user-secret cookie
 * inputs. Routes should use this helper rather than re-reading auth inputs in
 * each endpoint.
 *
 * @param {import("../../types/server-runtime.d.ts").HttpRouteContext} ctx
 * @param {string} boardName
 * @returns {ReturnType<typeof BoardPermissions.forBoard>}
 */
function boardPermissionsForRequest(ctx, boardName) {
  const config = ctx.runtime.config;
  const userSecret = getUserSecretFromCookieHeader(ctx.request.headers.cookie);
  return BoardPermissions.forBoard({
    config,
    boardName,
    userInfo: { token: ctx.url.searchParams.get("token"), userSecret },
    // Render the served board state ban-aware too, so a banned user's HTML
    // (board-state script + toolbar) is read-only from first paint, matching
    // the socket. Same live predicate the socket path injects.
    isBanned: () =>
      isEditBanned(
        boardName,
        userSecret,
        resolveRequestClientIpSafe(config, ctx.request),
        Date.now(),
      ),
  });
}

export {
  annotateBoardRequest,
  boardDocumentLocation,
  boardOperationTraceAttributes,
  boardPermissionsForRequest,
  boardPageETag,
  ensureBoardUserSecretCookie,
  matchesIfNoneMatch,
  parseBoardPageETagCandidates,
  pinServedBoardBaseline,
  requireBoardDocumentNames,
  requireBoardPathName,
  requireBoardQueryName,
};
