import * as path from "node:path";

import {
  canonicalizeBoardName,
  decodeBoardName,
  decodeAndValidateBoardName,
  isValidBoardName,
} from "../client-data/js/board_name.js";
import { getLoadedBoard, pinReplayBaseline } from "./board_registry.mjs";
import { badRequest } from "./boundary_errors.mjs";
import {
  CSP,
  STATIC_RESOURCE_EXTENSIONS,
  boardSvgCacheControl,
} from "./http_cache_policy.mjs";
import { startCompressedResponse } from "./http_compression.mjs";
import {
  errorCode,
  observeRequest,
  requestErrorStatusCode,
  requestScheme,
  respondWithErrorPage,
  serveError,
} from "./http_observation.mjs";
import * as jwtauth from "./jwtauth.mjs";
import * as jwtBoardName from "./jwtBoardnameAuth.mjs";
import observability from "./observability.mjs";
import { buildRandomBoardName } from "./pronounceable_name.mjs";
import { validateRequestUrl } from "./request_url.mjs";
import {
  boardExists,
  readBoardDocumentState,
  readServedBaseline,
  readStoredSvgSeq,
  streamServedBaseline,
} from "./svg_board_store.mjs";
import {
  appendSetCookieHeader,
  generateUserSecret,
  getUserSecretCookiePath,
  getUserSecretFromCookieHeader,
  serializeUserSecretCookie,
} from "./user_secret_cookie.mjs";

const { logger, tracing } = observability;

const BOARD_SCOPED_ROUTES = new Set(["boards", "preview", "download"]);

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @import { ServerConfig } from "../types/server-runtime.d.ts" */
/** @typedef {(request: HttpRequest, response: HttpResponse, next: (error?: unknown) => void) => void} StaticFileServer */
/** @typedef {{
 *   config: ServerConfig,
 *   fileserver: StaticFileServer,
 *   errorPage: string,
 *   boardTemplate: import("./templating.mjs").BoardTemplate,
 *   indexTemplate: import("./templating.mjs").Template,
 * }} ServerRuntime */
/** @typedef {{
 *   requestId?: string,
 *   setRoute: (route: string) => void,
 *   noteError: (error: unknown) => void,
 *   annotate: (fields: {[key: string]: unknown}) => void,
 *   setTraceAttributes: (fields: {[key: string]: unknown}) => void,
 * }} RequestContext */

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
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @returns {void}
 */
function ensureBoardUserSecretCookie(request, response, parsedUrl) {
  const existingUserSecret = getUserSecretFromCookieHeader(
    request.headers.cookie,
  );
  if (existingUserSecret !== "") return;
  appendSetCookieHeader(
    response,
    serializeUserSecretCookie(generateUserSecret(), {
      path: getUserSecretCookiePath(parsedUrl.pathname),
      secure: requestScheme(request) === "https",
    }),
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
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @returns {boolean}
 */
function shouldCheckUserPermissions(parsedUrl, parts) {
  return (
    !STATIC_RESOURCE_EXTENSIONS.includes(path.extname(parsedUrl.pathname)) &&
    !BOARD_SCOPED_ROUTES.has(parts[0] || "")
  );
}

/**
 * @param {RequestContext} requestContext
 * @param {string} boardName
 * @returns {void}
 */
function annotateBoardRequest(requestContext, boardName) {
  requestContext.annotate({ board: boardName });
  requestContext.setTraceAttributes({ board: boardName });
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
 * @param {string[]} parts
 * @param {number} [index]
 * @returns {string}
 */
function requireBoardPathName(parts, index = 1) {
  const boardName = decodeAndValidateBoardName(parts[index]);
  if (boardName === null) throw badRequest("invalid_board_name");
  return boardName;
}

/**
 * @param {string[]} parts
 * @param {number} [index]
 * @returns {string}
 */
function requireBoardSvgPathName(parts, index = 1) {
  const boardPath = parts[index];
  if (!boardPath || !boardPath.endsWith(".svg")) {
    throw badRequest("invalid_board_name");
  }
  const boardName = decodeAndValidateBoardName(boardPath.slice(0, -4));
  if (boardName === null) throw badRequest("invalid_board_name");
  return boardName;
}

/**
 * @param {string[]} parts
 * @param {number} [index]
 * @returns {{requestedBoardName: string, boardName: string}}
 */
function requireBoardDocumentNames(parts, index = 1) {
  const requestedBoardName = decodeBoardName(parts[index]);
  if (requestedBoardName === null) throw badRequest("invalid_board_name");
  const boardName = canonicalizeBoardName(requestedBoardName);
  if (boardName === "") throw badRequest("invalid_board_name");
  return { requestedBoardName, boardName };
}

/**
 * @param {string} boardName
 * @param {string} [search]
 * @returns {string}
 */
function boardDocumentLocation(boardName, search = "") {
  return `/boards/${encodeURIComponent(boardName)}${search}`;
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @param {string=} nextUrl
 * @returns {void}
 */
function serveStaticFile(request, response, runtime, requestContext, nextUrl) {
  requestContext.setRoute("static_file");
  if (nextUrl !== undefined) request.url = nextUrl;
  runtime.fileserver(
    request,
    response,
    serveError(response, runtime.errorPage, requestContext),
  );
}

/**
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {ServerConfig} config
 * @param {RequestContext} requestContext
 * @returns {void}
 */
function handleBoardRedirectRoute(response, parsedUrl, config, requestContext) {
  const boardName = requireBoardQueryName(parsedUrl);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(config, parsedUrl, boardName);
  response.writeHead(301, {
    Location: boardDocumentLocation(boardName),
  });
  response.end();
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {Promise<void>}
 */
async function handleBoardDocumentRoute(
  request,
  response,
  parsedUrl,
  parts,
  runtime,
  requestContext,
) {
  const { requestedBoardName, boardName } = requireBoardDocumentNames(parts);
  if (requestedBoardName !== boardName) {
    annotateBoardRequest(requestContext, boardName);
    response.writeHead(301, {
      Location: boardDocumentLocation(boardName, parsedUrl.search),
    });
    response.end();
    return;
  }
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(runtime.config, parsedUrl, boardName);
  const token = parsedUrl.searchParams.get("token");
  const boardRole = jwtBoardName.roleInBoard(
    runtime.config,
    token || "",
    boardName,
  );
  const cachedSeqs = parseIfNoneMatch(request.headers["if-none-match"])
    .map(parseBoardPageETag)
    .filter((seq) => seq !== null);
  const loadedBoardPromise = getLoadedBoard(boardName);
  if (loadedBoardPromise && cachedSeqs.length > 0) {
    const loadedBoard = await loadedBoardPromise;
    const persistedSeq = loadedBoard.getPersistedSeq();
    if (cachedSeqs.includes(persistedSeq)) {
      pinServedBoardBaseline(boardName, persistedSeq, runtime.config);
      response.writeHead(304, {
        "Cache-Control": runtime.boardTemplate.cacheControl(),
        ETag: boardPageETag(persistedSeq),
      });
      response.end();
      return;
    }
  }
  const {
    metadata: boardMetadata,
    inlineBoardSvg,
    source,
    byteLength,
  } = await tracing.withRecordingActiveSpan(
    "board.document_state_read",
    {
      attributes: boardOperationTraceAttributes(
        boardName,
        "document_state_read",
      ),
    },
    async function traceBoardDocumentStateRead(span) {
      const state = await readBoardDocumentState(boardName, {
        historyDir: runtime.config.HISTORY_DIR,
      });
      if (span) {
        tracing.setSpanAttributes(
          span,
          boardOperationTraceAttributes(boardName, "document_state_read", {
            "wbo.board.load_source": state.source,
            "file.size": state.byteLength,
            ...(state.metadata.seq === undefined
              ? {}
              : { "wbo.board.seq": state.metadata.seq }),
          }),
        );
      }
      return state;
    },
  );
  requestContext.annotate({
    board_source: source,
    board_bytes: byteLength,
  });
  const canWrite =
    !boardMetadata.readonly ||
    (runtime.config.AUTH_SECRET_KEY &&
      ["editor", "moderator"].includes(boardRole));
  const etag = boardPageETag(boardMetadata.seq || 0);
  if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
    pinServedBoardBaseline(boardName, boardMetadata.seq || 0, runtime.config);
    response.writeHead(304, {
      "Cache-Control": runtime.boardTemplate.cacheControl(),
      ETag: etag,
    });
    response.end();
    return;
  }
  pinServedBoardBaseline(boardName, boardMetadata.seq || 0, runtime.config);
  ensureBoardUserSecretCookie(request, response, parsedUrl);
  if (source === "svg" || source === "svg_backup") {
    const svgStream = await tracing.withRecordingActiveSpan(
      "board.baseline_stream_open",
      {
        attributes: boardOperationTraceAttributes(
          boardName,
          "baseline_stream_open",
          {
            "wbo.board.load_source": source,
            "file.size": byteLength,
            ...(boardMetadata.seq === undefined
              ? {}
              : { "wbo.board.seq": boardMetadata.seq }),
          },
        ),
      },
      function traceBoardBaselineStreamOpen() {
        return streamServedBaseline(boardName, {
          historyDir: runtime.config.HISTORY_DIR,
        });
      },
    );
    svgStream.on(
      "error",
      /**
       * @param {Error} error
       */
      function handleBoardDocumentSvgStreamError(error) {
        requestContext.noteError(error);
        if (!response.headersSent) {
          respondWithErrorPage(response, 500, runtime.errorPage);
        } else {
          response.destroy(error);
        }
      },
    );
    const { encoding } = runtime.boardTemplate.serveStream(
      request,
      response,
      svgStream,
      boardRole === "moderator",
      {
        etag,
        boardState: {
          readonly: boardMetadata.readonly,
          canWrite,
        },
      },
    );
    if (encoding !== undefined) {
      requestContext.annotate({ http_response_encoding: encoding });
    }
    return;
  }
  const { encoding } = runtime.boardTemplate.serve(
    request,
    response,
    boardRole === "moderator",
    {
      etag,
      inlineBoardSvg: inlineBoardSvg || "",
      boardState: {
        readonly: boardMetadata.readonly,
        canWrite,
      },
    },
  );
  if (encoding !== undefined) {
    requestContext.annotate({ http_response_encoding: encoding });
  }
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {Promise<void>}
 */
async function handleBoardSvgRoute(
  request,
  response,
  parsedUrl,
  parts,
  runtime,
  requestContext,
) {
  const boardName = requireBoardSvgPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(runtime.config, parsedUrl, boardName);
  const persistedSeq = await readStoredSvgSeq(boardName, {
    historyDir: runtime.config.HISTORY_DIR,
  });
  const etag = boardPageETag(persistedSeq);
  pinServedBoardBaseline(boardName, persistedSeq, runtime.config);
  if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
    response.writeHead(304, {
      "Cache-Control": boardSvgCacheControl(runtime.config),
      ETag: etag,
    });
    response.end();
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
        historyDir: runtime.config.HISTORY_DIR,
      });
    },
  );
  svgStream.on(
    "error",
    /**
     * @param {Error} error
     */
    function handleBoardSvgStreamError(error) {
      requestContext.noteError(error);
      if (!response.headersSent) {
        respondWithErrorPage(response, 500, runtime.errorPage);
      } else {
        response.destroy(error);
      }
    },
  );
  const compressedResponse = startCompressedResponse(
    response,
    request.headers["accept-encoding"],
    {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy": CSP,
      "Cache-Control": boardSvgCacheControl(runtime.config),
      ETag: etag,
    },
  );
  if (compressedResponse.encoding !== undefined) {
    requestContext.annotate({
      http_response_encoding: compressedResponse.encoding,
    });
  }
  svgStream.pipe(compressedResponse.stream);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {void | Promise<void>}
 */
function handleBoardsRoute(
  request,
  response,
  parsedUrl,
  parts,
  runtime,
  requestContext,
) {
  requestContext.setRoute(
    parts.length === 1 ? "boards_redirect" : "board_page",
  );
  if (parts.length === 1) {
    handleBoardRedirectRoute(
      response,
      parsedUrl,
      runtime.config,
      requestContext,
    );
    return;
  }
  if (parts.length === 2 && parts[1]?.endsWith(".svg")) {
    requestContext.setRoute("board_svg");
    return handleBoardSvgRoute(
      request,
      response,
      parsedUrl,
      parts,
      runtime,
      requestContext,
    );
  }
  if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
    return handleBoardDocumentRoute(
      request,
      response,
      parsedUrl,
      parts,
      runtime,
      requestContext,
    );
  }
  serveStaticFile(
    request,
    response,
    runtime,
    requestContext,
    `/${parts.slice(1).join("/")}`,
  );
}

/**
 * @param {HttpResponse} response
 * @param {string} boardName
 * @param {ServerConfig} config
 * @returns {Promise<void>}
 */
async function respondWithBoardDownload(response, boardName, config) {
  const data = await tracing.withActiveSpan(
    "board.download_read",
    {
      attributes: {
        "wbo.board": boardName,
        "wbo.board.operation": "download_read",
      },
    },
    function readBoardBaseline() {
      return readServedBaseline(boardName, {
        historyDir: config.HISTORY_DIR,
      });
    },
  );
  response.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Content-Disposition": `attachment; filename="${boardName}.svg"`,
    "Content-Length": data.length,
  });
  response.end(data);
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {void}
 */
function handleDownloadRoute(
  parsedUrl,
  parts,
  response,
  runtime,
  requestContext,
) {
  requestContext.setRoute("download_board");
  const boardName = requireBoardPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(runtime.config, parsedUrl, boardName);
  void respondWithBoardDownload(response, boardName, runtime.config).catch(
    serveError(response, runtime.errorPage, requestContext),
  );
}

/**
 * @param {RequestContext} requestContext
 * @param {number} startedAt
 * @returns {number}
 */
function recordPreviewDuration(requestContext, startedAt) {
  const renderDurationMs = Date.now() - startedAt;
  requestContext.annotate({
    render_duration_ms: renderDurationMs,
  });
  requestContext.setTraceAttributes({
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
      attributes: {
        "wbo.board": boardName,
        "wbo.board.operation": "preview_render",
      },
    },
    async function renderPreview() {
      try {
        if (!(await boardExists(boardName, config))) {
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.operation": "preview_render",
            "wbo.board.result": "not_found",
          });
          return null;
        }
        return await readServedBaseline(boardName, {
          historyDir: config.HISTORY_DIR,
        });
      } catch (err) {
        if (isNotFoundError(err)) {
          tracing.setActiveSpanAttributes({
            "wbo.board": boardName,
            "wbo.board.operation": "preview_render",
            "wbo.board.result": "not_found",
          });
          return null;
        }
        throw err;
      }
    },
  );
}

/**
 * @param {HttpResponse} response
 * @param {string} boardName
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @param {number} startedAt
 * @param {string | string[] | undefined} acceptEncoding
 * @returns {Promise<void>}
 */
async function respondWithBoardPreview(
  response,
  boardName,
  runtime,
  requestContext,
  startedAt,
  acceptEncoding,
) {
  const svg = await renderPreviewSvg(boardName, runtime.config);
  recordPreviewDuration(requestContext, startedAt);
  if (svg === null) {
    serveError(response, runtime.errorPage, requestContext)();
    return;
  }
  const compressedResponse = startCompressedResponse(response, acceptEncoding, {
    "Content-Type": "image/svg+xml",
    "Content-Security-Policy": CSP,
    "Cache-Control": boardSvgCacheControl(runtime.config),
  });
  if (compressedResponse.encoding !== undefined) {
    requestContext.annotate({
      http_response_encoding: compressedResponse.encoding,
    });
  }
  compressedResponse.stream.end(svg);
}

/**
 * @param {URL} parsedUrl
 * @param {string[]} parts
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {void}
 */
function handlePreviewRoute(
  parsedUrl,
  parts,
  request,
  response,
  runtime,
  requestContext,
) {
  requestContext.setRoute("preview_board");
  const boardName = requireBoardPathName(parts);
  annotateBoardRequest(requestContext, boardName);
  jwtBoardName.checkBoardnameInToken(runtime.config, parsedUrl, boardName);
  const startedAt = Date.now();
  void respondWithBoardPreview(
    response,
    boardName,
    runtime,
    requestContext,
    startedAt,
    request.headers["accept-encoding"],
  ).catch((err) => {
    recordPreviewDuration(requestContext, startedAt);
    serveError(response, runtime.errorPage, requestContext)(err);
  });
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
 * @param {HttpResponse} response
 * @param {ServerConfig} config
 * @param {RequestContext} requestContext
 * @returns {Promise<void>}
 */
async function handleRandomRoute(response, config, requestContext) {
  const name = await allocateRandomBoardName(config);
  annotateBoardRequest(requestContext, name);
  response.writeHead(307, { Location: boardDocumentLocation(name) });
  response.end(name);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {void}
 */
function handleIndexRoute(request, response, runtime, requestContext) {
  const defaultBoard = canonicalizeBoardName(runtime.config.DEFAULT_BOARD);
  if (defaultBoard !== "") {
    annotateBoardRequest(requestContext, defaultBoard);
    response.writeHead(302, {
      Location: boardDocumentLocation(defaultBoard),
    });
    response.end(defaultBoard);
    return;
  }
  runtime.indexTemplate.serve(request, response);
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @param {RequestContext} requestContext
 * @returns {void | Promise<void>}
 */
function handleRequest(request, response, runtime, requestContext) {
  const parsedUrlResult = validateRequestUrl(request.url);
  if (parsedUrlResult.ok === false) throw badRequest(parsedUrlResult.reason);

  const parsedUrl = parsedUrlResult.value;
  const parts = parsedUrl.pathname.split("/");
  if (parts[0] === "") parts.shift();

  if (shouldCheckUserPermissions(parsedUrl, parts)) {
    jwtauth.checkUserPermission(parsedUrl, runtime.config);
  }

  switch (parts[0]) {
    case "boards":
      return handleBoardsRoute(
        request,
        response,
        parsedUrl,
        parts,
        runtime,
        requestContext,
      );
    case "download":
      return handleDownloadRoute(
        parsedUrl,
        parts,
        response,
        runtime,
        requestContext,
      );
    case "export":
    case "preview":
      return handlePreviewRoute(
        parsedUrl,
        parts,
        request,
        response,
        runtime,
        requestContext,
      );
    case "random":
      requestContext.setRoute("random_board");
      return handleRandomRoute(response, runtime.config, requestContext);
    case "":
      requestContext.setRoute("index");
      return handleIndexRoute(request, response, runtime, requestContext);
    default:
      return serveStaticFile(request, response, runtime, requestContext);
  }
}

/**
 * @param {HttpRequest} request
 * @param {HttpResponse} response
 * @param {ServerRuntime} runtime
 * @returns {void}
 */
function handleObservedRequest(request, response, runtime) {
  const requestContext = observeRequest(request, response, runtime.config);
  requestContext.run(async function runRequestHandler() {
    try {
      await handleRequest(request, response, runtime, requestContext);
    } catch (err) {
      const statusCode = requestErrorStatusCode(err) || 500;
      if (statusCode >= 500) {
        logger.error("http.request_unhandled", {
          request_id: requestContext.requestId,
          error: err,
        });
      }
      serveError(response, runtime.errorPage, requestContext)(err);
    }
  });
}

/**
 * @param {ServerRuntime} runtime
 * @returns {import("http").RequestListener}
 */
function createRequestHandler(runtime) {
  return function requestHandler(request, response) {
    handleObservedRequest(request, response, runtime);
  };
}

export { createRequestHandler };
