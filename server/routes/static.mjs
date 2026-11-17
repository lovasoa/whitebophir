import path from "node:path";
import { canonicalizeBoardName } from "../../client-data/js/board_name.js";
import packageJson from "../../package.json" with { type: "json" };
import { STATIC_RESOURCE_EXTENSIONS } from "../http/cache_policy.mjs";
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
  if (!ctx.url.pathname.startsWith("/assets/")) {
    serveStaticFile(ctx);
    return;
  }
  const [, , version = "", ...parts] = ctx.url.pathname.split("/");
  const current = version === packageJson.version;
  if (!current && !/^\d+\.\d+\.\d+$/.test(version)) {
    rejectUnavailableReleaseAsset(ctx.response);
    return;
  }
  const assetPath = `/${parts.join("/")}`;
  if (
    !ctx.runtime.config.IS_DEVELOPMENT &&
    STATIC_RESOURCE_EXTENSIONS.includes(path.extname(assetPath))
  ) {
    ctx.response.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
  }
  if (current) {
    serveStaticFile(ctx, `${assetPath}${ctx.url.search}`);
  } else {
    serveStaticFile(ctx, `${ctx.url.pathname}${ctx.url.search}`, () => {
      rejectUnavailableReleaseAsset(ctx.response);
    });
  }
}

/** @param {import("node:http").ServerResponse} response */
function rejectUnavailableReleaseAsset(response) {
  response.writeHead(409, { "Cache-Control": "no-store" });
  response.end();
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function serveManifest(ctx) {
  const body = ctx.runtime.manifestTemplate.renderForRequest(ctx.request);
  ctx.response.writeHead(200, {
    "Content-Type": "application/manifest+json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": ctx.runtime.config.IS_DEVELOPMENT
      ? "no-store"
      : "public, max-age=3600",
  });
  ctx.response.end(body);
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function serveRulesPage(ctx) {
  ctx.runtime.rulesTemplate.serve(ctx.request, ctx.response);
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
 * @param {(() => void)=} onMissing
 * @returns {void}
 */
function serveStaticFile(ctx, nextUrl, onMissing) {
  ctx.request.url = nextUrl || `${ctx.url.pathname}${ctx.url.search}`;
  const onError = serveError(
    ctx.request,
    ctx.response,
    ctx.runtime.errorPage,
    ctx.observed,
  );
  ctx.runtime.fileserver(ctx.request, ctx.response, (error) => {
    if (onMissing && error === undefined) onMissing();
    else onError(error);
  });
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
  serveManifest,
  serveRulesPage,
  serveStaticAsset,
};
