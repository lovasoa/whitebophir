import { getLoadedBoard } from "./board_registry.mjs";
import {
  annotateBoardRequest,
  boardDocumentLocation,
  boardOperationTraceAttributes,
  boardPageETag,
  ensureBoardUserSecretCookie,
  matchesIfNoneMatch,
  parseBoardPageETagCandidates,
  pinServedBoardBaseline,
  requireBoardDocumentNames,
  requireBoardQueryName,
} from "./board_http_helpers.mjs";
import { respondWithErrorPage } from "./http_observation.mjs";
import * as jwtBoardName from "./jwtBoardnameAuth.mjs";
import observability from "./observability.mjs";
import {
  readBoardDocumentState,
  streamServedBaseline,
} from "./svg_board_store.mjs";

const { tracing } = observability;

/** @import { HttpRouteContext } from "../types/server-runtime.d.ts" */

/**
 * @typedef {{
 *   redirect?: string,
 *   boardName: string,
 *   boardRole: string,
 *   cachedSeqs: number[],
 * }} BoardPageRequest
 */

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function redirectBoardQuery(ctx) {
  const boardName = requireBoardQueryName(ctx.url);
  annotateBoardRequest(ctx.observed, boardName);
  jwtBoardName.checkBoardnameInToken(ctx.runtime.config, ctx.url, boardName);
  ctx.response.writeHead(301, {
    Location: boardDocumentLocation(boardName),
  });
  ctx.response.end();
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function serveBoardPage(ctx) {
  const pageRequest = resolveBoardPageRequest(ctx);
  if (pageRequest.redirect) {
    ctx.response.writeHead(301, { Location: pageRequest.redirect });
    ctx.response.end();
    return;
  }

  if (await serveLoadedBoardCacheHit(ctx, pageRequest)) return;

  const document = await readBoardDocumentForPage(ctx, pageRequest);
  ctx.observed.annotate({
    board_source: document.source,
    board_bytes: document.byteLength,
  });
  if (serveBoardDocumentCacheHit(ctx, pageRequest, document)) return;

  pinServedBoardBaseline(
    pageRequest.boardName,
    document.metadata.seq || 0,
    ctx.runtime.config,
  );
  ensureBoardUserSecretCookie(ctx.request, ctx.response, ctx.url);
  await renderBoardDocument(ctx, pageRequest, document);
}

/**
 * Resolves canonical board identity and checks board-token access before any
 * board bytes are read.
 *
 * @param {HttpRouteContext} ctx
 * @returns {BoardPageRequest}
 */
function resolveBoardPageRequest(ctx) {
  const { requestedBoardName, boardName } = requireBoardDocumentNames(
    ctx.params,
  );
  annotateBoardRequest(ctx.observed, boardName);
  if (requestedBoardName !== boardName) {
    return {
      redirect: boardDocumentLocation(boardName, ctx.url.search),
      boardName,
      boardRole: "",
      cachedSeqs: [],
    };
  }
  jwtBoardName.checkBoardnameInToken(ctx.runtime.config, ctx.url, boardName);
  const token = ctx.url.searchParams.get("token");
  return {
    boardName,
    boardRole: jwtBoardName.roleInBoard(
      ctx.runtime.config,
      token || "",
      boardName,
    ),
    cachedSeqs: parseBoardPageETagCandidates(
      ctx.request.headers["if-none-match"],
    ),
  };
}

/**
 * Returns 304 from an already-loaded board when its persisted seq satisfies
 * If-None-Match.
 *
 * @param {HttpRouteContext} ctx
 * @param {BoardPageRequest} pageRequest
 * @returns {Promise<boolean>}
 */
async function serveLoadedBoardCacheHit(ctx, pageRequest) {
  const loadedBoardPromise = getLoadedBoard(pageRequest.boardName);
  if (!loadedBoardPromise || pageRequest.cachedSeqs.length === 0) return false;
  const loadedBoard = await loadedBoardPromise;
  const persistedSeq = loadedBoard.getPersistedSeq();
  if (!pageRequest.cachedSeqs.includes(persistedSeq)) return false;

  respondWithBoardPageNotModified(ctx, pageRequest.boardName, persistedSeq);
  return true;
}

/**
 * @param {HttpRouteContext} ctx
 * @param {BoardPageRequest} pageRequest
 * @returns {ReturnType<typeof readBoardDocumentState>}
 */
function readBoardDocumentForPage(ctx, pageRequest) {
  return tracing.withRecordingActiveSpan(
    "board.document_state_read",
    {
      attributes: boardOperationTraceAttributes(
        pageRequest.boardName,
        "document_state_read",
      ),
    },
    async function traceBoardDocumentStateRead(span) {
      const state = await readBoardDocumentState(pageRequest.boardName, {
        historyDir: ctx.runtime.config.HISTORY_DIR,
      });
      if (span) {
        tracing.setSpanAttributes(
          span,
          boardOperationTraceAttributes(
            pageRequest.boardName,
            "document_state_read",
            {
              "wbo.board.load_source": state.source,
              "file.size": state.byteLength,
              ...(state.metadata.seq === undefined
                ? {}
                : { "wbo.board.seq": state.metadata.seq }),
            },
          ),
        );
      }
      return state;
    },
  );
}

/**
 * @param {HttpRouteContext} ctx
 * @param {BoardPageRequest} pageRequest
 * @param {Awaited<ReturnType<typeof readBoardDocumentState>>} document
 * @returns {boolean}
 */
function serveBoardDocumentCacheHit(ctx, pageRequest, document) {
  const etag = boardPageETag(document.metadata.seq || 0);
  if (!matchesIfNoneMatch(ctx.request.headers["if-none-match"], etag)) {
    return false;
  }
  respondWithBoardPageNotModified(
    ctx,
    pageRequest.boardName,
    document.metadata.seq || 0,
    etag,
  );
  return true;
}

/**
 * @param {HttpRouteContext} ctx
 * @param {string} boardName
 * @param {number} seq
 * @param {string=} etag
 * @returns {void}
 */
function respondWithBoardPageNotModified(ctx, boardName, seq, etag) {
  pinServedBoardBaseline(boardName, seq, ctx.runtime.config);
  ctx.response.writeHead(304, {
    "Cache-Control": ctx.runtime.boardTemplate.cacheControl(),
    ETag: etag || boardPageETag(seq),
  });
  ctx.response.end();
}

/**
 * @param {HttpRouteContext} ctx
 * @param {BoardPageRequest} pageRequest
 * @param {Awaited<ReturnType<typeof readBoardDocumentState>>} document
 * @returns {Promise<void>}
 */
async function renderBoardDocument(ctx, pageRequest, document) {
  const renderOptions = {
    etag: boardPageETag(document.metadata.seq || 0),
    boardState: {
      readonly: document.metadata.readonly,
      canWrite:
        !document.metadata.readonly ||
        (ctx.runtime.config.AUTH_SECRET_KEY &&
          ["editor", "moderator"].includes(pageRequest.boardRole)),
    },
  };

  if (document.source === "svg" || document.source === "svg_backup") {
    await streamStoredSvgBoardDocument(
      ctx,
      pageRequest,
      document,
      renderOptions,
    );
    return;
  }

  const { encoding } = ctx.runtime.boardTemplate.serve(
    ctx.request,
    ctx.response,
    pageRequest.boardRole === "moderator",
    {
      ...renderOptions,
      inlineBoardSvg: document.inlineBoardSvg || "",
    },
  );
  if (encoding !== undefined) {
    ctx.observed.annotate({ http_response_encoding: encoding });
  }
}

/**
 * Streams stored SVG through the board HTML shell; the SVG body is not
 * materialized in JS.
 *
 * @param {HttpRouteContext} ctx
 * @param {BoardPageRequest} pageRequest
 * @param {Awaited<ReturnType<typeof readBoardDocumentState>>} document
 * @param {{etag: string, boardState: {readonly: boolean, canWrite: boolean | string}}} renderOptions
 * @returns {Promise<void>}
 */
async function streamStoredSvgBoardDocument(
  ctx,
  pageRequest,
  document,
  renderOptions,
) {
  const svgStream = await tracing.withRecordingActiveSpan(
    "board.baseline_stream_open",
    {
      attributes: boardOperationTraceAttributes(
        pageRequest.boardName,
        "baseline_stream_open",
        {
          "wbo.board.load_source": document.source,
          "file.size": document.byteLength,
          ...(document.metadata.seq === undefined
            ? {}
            : { "wbo.board.seq": document.metadata.seq }),
        },
      ),
    },
    function traceBoardBaselineStreamOpen() {
      return streamServedBaseline(pageRequest.boardName, {
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
  const { encoding } = ctx.runtime.boardTemplate.serveStream(
    ctx.request,
    ctx.response,
    svgStream,
    pageRequest.boardRole === "moderator",
    renderOptions,
  );
  if (encoding !== undefined) {
    ctx.observed.annotate({ http_response_encoding: encoding });
  }
}

export { redirectBoardQuery, serveBoardPage };
