import {
  annotateBoardRequest,
  boardOperationTraceAttributes,
  boardPageETag,
  matchesIfNoneMatch,
  pinServedBoardBaseline,
  requireBoardPathName,
} from "./board_http_helpers.mjs";
import { badRequest } from "./boundary_errors.mjs";
import { CSP, boardSvgCacheControl } from "./http_cache_policy.mjs";
import { startCompressedResponse } from "./http_compression.mjs";
import {
  errorCode,
  respondWithErrorPage,
  serveError,
} from "./http_observation.mjs";
import * as jwtBoardName from "./jwtBoardnameAuth.mjs";
import observability from "./observability.mjs";
import {
  boardExists,
  readServedBaseline,
  readStoredSvgSeq,
  streamServedBaseline,
} from "./svg_board_store.mjs";

const { tracing } = observability;

/** @import { HttpRouteContext, ServerConfig } from "../types/server-runtime.d.ts" */

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
  jwtBoardName.checkBoardnameInToken(ctx.runtime.config, ctx.url, boardName);
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
  const svgStream = await tracing.withRecordingActiveSpan(
    "board.baseline_stream_open",
    {
      attributes: boardOperationTraceAttributes(
        boardName,
        "baseline_stream_open",
        {
          "wbo.board.seq": persistedSeq,
        },
      ),
    },
    function traceBoardBaselineStreamOpen() {
      return streamServedBaseline(boardName, {
        historyDir: ctx.runtime.config.HISTORY_DIR,
      });
    },
  );
  svgStream.on("error", (/** @type {Error} */ error) => {
    ctx.observed.noteError(error);
    if (!ctx.response.headersSent) {
      respondWithErrorPage(ctx.response, 500, ctx.runtime.errorPage);
    } else {
      ctx.response.destroy(error);
    }
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
 * @returns {void}
 */
function downloadBoard(ctx) {
  const boardName = requireBoardPathName(ctx.params);
  annotateBoardRequest(ctx.observed, boardName);
  jwtBoardName.checkBoardnameInToken(ctx.runtime.config, ctx.url, boardName);
  void respondWithBoardDownload(ctx, boardName).catch(
    serveError(ctx.response, ctx.runtime.errorPage, ctx.observed),
  );
}

/**
 * @param {HttpRouteContext} ctx
 * @param {string} boardName
 * @returns {Promise<void>}
 */
async function respondWithBoardDownload(ctx, boardName) {
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
  ctx.response.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Content-Disposition": `attachment; filename="${boardName}.svg"`,
    "Content-Length": data.length,
  });
  ctx.response.end(data);
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function serveBoardPreview(ctx) {
  const boardName = requireBoardPathName(ctx.params);
  annotateBoardRequest(ctx.observed, boardName);
  jwtBoardName.checkBoardnameInToken(ctx.runtime.config, ctx.url, boardName);
  const startedAt = Date.now();
  void respondWithBoardPreview(ctx, boardName, startedAt).catch((error) => {
    recordPreviewDuration(ctx, startedAt);
    serveError(ctx.response, ctx.runtime.errorPage, ctx.observed)(error);
  });
}

/**
 * @param {HttpRouteContext} ctx
 * @param {string} boardName
 * @param {number} startedAt
 * @returns {Promise<void>}
 */
async function respondWithBoardPreview(ctx, boardName, startedAt) {
  const svg = await renderPreviewSvg(boardName, ctx.runtime.config);
  recordPreviewDuration(ctx, startedAt);
  if (svg === null) {
    serveError(ctx.response, ctx.runtime.errorPage, ctx.observed)();
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
        if (isNotFoundError(error)) {
          markPreviewNotFound(boardName);
          return null;
        }
        throw error;
      }
    },
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFoundError(error) {
  return errorCode(error) === "ENOENT";
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
