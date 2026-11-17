import { badRequest } from "../http/boundary_errors.mjs";
import { boardSvgCacheControl, CSP } from "../http/cache_policy.mjs";
import { startCompressedResponse } from "../http/compression.mjs";
import { errorCode, serveError } from "../http/observation.mjs";
import observability from "../observability/index.mjs";
import {
  boardExists,
  readServedBaseline,
  readStoredSvgSeq,
} from "../persistence/svg_board_store.mjs";
import {
  annotateBoardRequest,
  boardPermissionsForRequest,
  boardOperationTraceAttributes,
  boardPageETag,
  matchesIfNoneMatch,
  openBoardBaselineStream,
  pinServedBoardBaseline,
  requireBoardPathName,
} from "./board_http_helpers.mjs";

const { tracing } = observability;

/** @import { HttpRouteContext, ServerConfig } from "../../types/server-runtime.d.ts" */

/**
 * @returns {never}
 */
function rejectMissingBoardName() {
  throw badRequest("invalid_board_name");
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function serveBoardSvg(ctx) {
  const boardName = requireBoardPathName(ctx.params);
  annotateBoardRequest(ctx.observed, boardName);
  boardPermissionsForRequest(ctx, boardName).requireOpen();
  const persistedSeq = await readStoredSvgSeq(boardName, {
    historyDir: ctx.runtime.config.HISTORY_DIR,
  });
  const etag = boardPageETag(persistedSeq);
  pinServedBoardBaseline(boardName, persistedSeq, ctx.runtime.config);
  if (matchesIfNoneMatch(ctx.request.headers["if-none-match"], etag)) {
    ctx.response.writeHead(304, {
      "Cache-Control": boardSvgCacheControl(ctx.runtime.config),
      ETag: etag,
    });
    ctx.response.end();
    return;
  }
  const svgStream = await openBoardBaselineStream(ctx, boardName, {
    "wbo.board.seq": persistedSeq,
  });
  const compressedResponse = startCompressedResponse(
    ctx.response,
    ctx.request.headers["accept-encoding"],
    {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy": CSP,
      "Cache-Control": boardSvgCacheControl(ctx.runtime.config),
      ETag: etag,
    },
  );
  if (compressedResponse.encoding !== undefined) {
    ctx.observed.annotate({
      http_response_encoding: compressedResponse.encoding,
    });
  }
  svgStream.pipe(compressedResponse.stream);
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function downloadBoard(ctx) {
  const boardName = requireBoardPathName(ctx.params);
  annotateBoardRequest(ctx.observed, boardName);
  boardPermissionsForRequest(ctx, boardName).requireOpen();
  const data = await tracing.withActiveSpan(
    "board.download_read",
    {
      attributes: boardOperationTraceAttributes(boardName, "download_read"),
    },
    function readBoardBaseline() {
      return readServedBaseline(boardName, {
        historyDir: ctx.runtime.config.HISTORY_DIR,
      });
    },
  );
  const filename = `${boardName}.svg`;
  const fallbackFilename = filename.replace(/[^\w.~()-]/g, "_");
  ctx.response.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Content-Disposition": `attachment; filename="${fallbackFilename}"`,
    "Content-Length": Buffer.byteLength(data),
  });
  ctx.response.end(data);
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function serveBoardPreview(ctx) {
  const boardName = requireBoardPathName(ctx.params);
  annotateBoardRequest(ctx.observed, boardName);
  boardPermissionsForRequest(ctx, boardName).requireOpen();
  const startedAt = Date.now();
  let svg;
  try {
    svg = await renderPreviewSvg(boardName, ctx.runtime.config);
  } finally {
    recordPreviewDuration(ctx, startedAt);
  }
  if (svg === null) {
    serveError(
      ctx.request,
      ctx.response,
      ctx.runtime.errorPage,
      ctx.observed,
    )();
    return;
  }
  const compressedResponse = startCompressedResponse(
    ctx.response,
    ctx.request.headers["accept-encoding"],
    {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy": CSP,
      "Cache-Control": boardSvgCacheControl(ctx.runtime.config),
    },
  );
  if (compressedResponse.encoding !== undefined) {
    ctx.observed.annotate({
      http_response_encoding: compressedResponse.encoding,
    });
  }
  compressedResponse.stream.end(svg);
}

/**
 * @param {HttpRouteContext} ctx
 * @param {number} startedAt
 * @returns {number}
 */
function recordPreviewDuration(ctx, startedAt) {
  const renderDurationMs = Date.now() - startedAt;
  ctx.observed.annotate({
    render_duration_ms: renderDurationMs,
  });
  ctx.observed.setTraceAttributes({
    render_duration_ms: renderDurationMs,
  });
  return renderDurationMs;
}

/**
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {Promise<string | null>}
 */
async function renderPreviewSvg(boardName, config) {
  return tracing.withActiveSpan(
    "preview.render",
    {
      attributes: boardOperationTraceAttributes(boardName, "preview_render"),
    },
    async function renderPreview() {
      try {
        if (!(await boardExists(boardName, config))) {
          markPreviewNotFound(boardName);
          return null;
        }
        return await readServedBaseline(boardName, {
          historyDir: config.HISTORY_DIR,
        });
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          markPreviewNotFound(boardName);
          return null;
        }
        throw error;
      }
    },
  );
}

/**
 * @param {string} boardName
 * @returns {void}
 */
function markPreviewNotFound(boardName) {
  tracing.setActiveSpanAttributes({
    ...boardOperationTraceAttributes(boardName, "preview_render"),
    "wbo.board.result": "not_found",
  });
}

export {
  downloadBoard,
  rejectMissingBoardName,
  serveBoardPreview,
  serveBoardSvg,
};
