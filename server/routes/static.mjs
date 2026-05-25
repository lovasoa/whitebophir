import { canonicalizeBoardName } from "../../client-data/js/board_name.js";
import { serveError } from "../http/observation.mjs";
import { boardExists } from "../persistence/svg_board_store.mjs";
import { buildRandomBoardName } from "../shared/pronounceable_name.mjs";
import {
  annotateBoardRequest,
  boardDocumentLocation,
} from "./board_http_helpers.mjs";

/** @import { HttpRouteContext, ServerConfig } from "../../types/server-runtime.d.ts" */

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function serveStaticAsset(ctx) {
  serveStaticFile(ctx);
}

/**
 * Keeps legacy /boards/<asset> static URLs working by serving them from the
 * web root without the /boards prefix.
 *
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function serveBoardStaticAsset(ctx) {
  serveStaticFile(ctx, `/${ctx.params.asset}`);
}

/**
 * @param {HttpRouteContext} ctx
 * @param {string=} nextUrl
 * @returns {void}
 */
function serveStaticFile(ctx, nextUrl) {
  ctx.request.url = nextUrl || `${ctx.url.pathname}${ctx.url.search}`;
  ctx.runtime.fileserver(
    ctx.request,
    ctx.response,
    serveError(ctx.response, ctx.runtime.errorPage, ctx.observed),
  );
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function redirectToRandomBoard(ctx) {
  const boardName = await allocateRandomBoardName(ctx.runtime.config);
  annotateBoardRequest(ctx.observed, boardName);
  ctx.response.writeHead(307, {
    Location: boardDocumentLocation(ctx.runtime.config, boardName),
  });
  ctx.response.end(boardName);
}

/**
 * @param {ServerConfig} config
 * @returns {Promise<string>}
 */
async function allocateRandomBoardName(config) {
  while (true) {
    const boardName = buildRandomBoardName();
    if (!(await boardExists(boardName, config))) return boardName;
  }
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function redirectToDefaultBoard(ctx) {
  const defaultBoard = canonicalizeBoardName(ctx.runtime.config.DEFAULT_BOARD);
  if (defaultBoard !== "") {
    annotateBoardRequest(ctx.observed, defaultBoard);
    ctx.response.writeHead(302, {
      Location: boardDocumentLocation(ctx.runtime.config, defaultBoard),
    });
    ctx.response.end(defaultBoard);
    return;
  }
  ctx.runtime.indexTemplate.serve(ctx.request, ctx.response);
}

export {
  redirectToDefaultBoard,
  redirectToRandomBoard,
  serveBoardStaticAsset,
  serveStaticAsset,
};
