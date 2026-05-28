import { BoardPermissions } from "../auth/board_capabilities.mjs";
import { getLoadedBoard } from "../board/registry.mjs";
import { respondWithErrorPage } from "../http/observation.mjs";
import observability from "../observability/index.mjs";
import {
  readBoardDocumentState,
  streamServedBaseline,
} from "../persistence/svg_board_store.mjs";
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

const { tracing } = observability;

/** @import { HttpRouteContext } from "../../types/server-runtime.d.ts" */
/** @import { AppBoardState } from "../../types/app-runtime" */

/**
 * @typedef {{
 *   kind: "redirect",
 *   redirect: string,
 *   boardName: string,
 *   cachedSeqs: number[],
 * }} BoardPageRedirectRequest
 */
/**
 * @typedef {{
 *   kind: "document",
 *   boardName: string,
 *   boardPermissions: ReturnType<typeof BoardPermissions.forBoard>,
 *   cachedSeqs: number[],
 * }} BoardPageDocumentRequest
 */
/** @typedef {BoardPageRedirectRequest | BoardPageDocumentRequest} BoardPageRequest */

/**
 * @param {HttpRouteContext} ctx
 * @returns {void}
 */
function redirectBoardQuery(ctx) {
  const config = ctx.runtime.config;
  const boardName = requireBoardQueryName(ctx.url);
  annotateBoardRequest(ctx.observed, boardName);
  BoardPermissions.forBoard({
    config,
    boardName,
    userInfo: { token: ctx.url.searchParams.get("token") },
  }).requireOpen();
  ctx.response.writeHead(301, {
    Location: boardDocumentLocation(config, boardName),
  });
  ctx.response.end();
}

/**
 * @param {HttpRouteContext} ctx
 * @returns {Promise<void>}
 */
async function serveBoardPage(ctx) {
  const pageRequest = resolveBoardPageRequest(ctx);
  if (pageRequest.kind === "redirect") {
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
  ensureBoardUserSecretCookie(
    ctx.request,
    ctx.response,
    ctx.publicUrl,
    ctx.runtime.config,
  );
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
  const config = ctx.runtime.config;
  const { requestedBoardName, boardName } = requireBoardDocumentNames(
    ctx.params,
  );
  annotateBoardRequest(ctx.observed, boardName);
  if (requestedBoardName !== boardName) {
    return {
      kind: "redirect",
      redirect: boardDocumentLocation(config, boardName, ctx.url.search),
      boardName,
      cachedSeqs: [],
    };
  }
  const boardPermissions = BoardPermissions.forBoard({
    config,
    boardName,
    userInfo: { token: ctx.url.searchParams.get("token") },
  });
  boardPermissions.requireOpen();
  return {
    kind: "document",
    boardName,
    boardPermissions,
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
 * @param {BoardPageDocumentRequest} pageRequest
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
 * @param {BoardPageDocumentRequest} pageRequest
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
 * @param {BoardPageDocumentRequest} pageRequest
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
 * @param {BoardPageDocumentRequest} pageRequest
 * @param {Awaited<ReturnType<typeof readBoardDocumentState>>} document
 * @returns {Promise<void>}
 */
async function renderBoardDocument(ctx, pageRequest, document) {
  const boardState = pageRequest.boardPermissions.boardState({
    name: pageRequest.boardName,
    readonly: document.metadata.readonly,
  });
  const renderOptions = {
    etag: boardPageETag(document.metadata.seq || 0),
    boardState,
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
    boardState.canClear,
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
 * @param {BoardPageDocumentRequest} pageRequest
 * @param {Awaited<ReturnType<typeof readBoardDocumentState>>} document
 * @param {{etag: string, boardState: AppBoardState}} renderOptions
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
    renderOptions.boardState.canClear,
    renderOptions,
  );
  if (encoding !== undefined) {
    ctx.observed.annotate({ http_response_encoding: encoding });
  }
}

export { redirectBoardQuery, serveBoardPage };
