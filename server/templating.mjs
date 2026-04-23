import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handlebars from "handlebars";

import { TOOL_BY_ID, TOOLBAR_TOOLS } from "../client-data/tools/index.js";
import { createClientConfiguration } from "./client_configuration.mjs";
import { startCompressedResponse } from "./http_compression.mjs";
import { parseRequestUrl } from "./request_url.mjs";

/** @typedef {{[name: string]: string}} TranslationDictionary */
/** @typedef {{[language: string]: TranslationDictionary}} TranslationMap */
/** @typedef {{baseUrl: string, languages: string[], language: string, translations: TranslationDictionary, configuration: object, moderator: boolean, [name: string]: any}} TemplateParameters */
/** @typedef {import("http").IncomingMessage} TemplateRequest */
/** @typedef {import("http").ServerResponse} TemplateResponse */
/** @typedef {string | string[] | undefined} HeaderValue */
/** @typedef {{blockedTools?: string[] | null, boardState?: {readonly?: boolean, canWrite?: boolean} | null, moderator?: boolean}} VisibleToolOptions */
/** @typedef {NonNullable<typeof TOOLBAR_TOOLS[number]>} ToolbarTool */
/** @typedef {typeof import("./configuration.mjs")} ServerConfig */
/** @typedef {ReturnType<typeof createClientConfiguration>} ClientConfig */
/** @typedef {"zstd" | "br" | "gzip"} CompressionEncoding */

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BOARD_PAGE_CACHE_HEADROOM_SECONDS = 5;

/**
 * Associations from language to translation dictionnaries
 * @const
 * @type {TranslationMap}
 */
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(SERVER_DIR, "translations.json"), "utf8"),
);
const languages = Object.keys(TRANSLATIONS);

handlebars.registerHelper({
  json: JSON.stringify.bind(JSON),
});

/**
 * @param {ToolbarTool | undefined} tool
 * @returns {tool is ToolbarTool}
 */
function isToolbarTool(tool) {
  return tool !== undefined;
}

/**
 * @param {VisibleToolOptions} options
 * @returns {typeof TOOLBAR_TOOLS}
 */
function getVisibleTools(options) {
  const blockedTools = new Set(options.blockedTools || []);
  const readonly = options.boardState?.readonly === true;
  const canWrite = options.boardState?.canWrite === true;
  const moderator = options.moderator === true;
  return TOOLBAR_TOOLS.filter(isToolbarTool).filter((tool) => {
    if (blockedTools.has(tool.toolId)) return false;
    if (tool.moderatorOnly && !moderator) return false;
    return !readonly || canWrite || tool.visibleWhenReadOnly;
  });
}

/**
 * @param {HeaderValue} value
 * @returns {string | undefined}
 */
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @param {string} tag
 * @returns {string}
 */
function canonicalizeLocale(tag) {
  const trimmed = tag.trim();
  if (!trimmed || trimmed === "*") return trimmed;
  try {
    return new Intl.Locale(trimmed).toString();
  } catch {
    return trimmed;
  }
}

/**
 * @param {string} header
 * @returns {{tag: string, quality: number}[]}
 */
function parseAcceptLanguage(header) {
  return header
    .split(",")
    .map(function parsePart(part, index) {
      const [rawTag, ...rawParams] = part.split(";");
      const tag = canonicalizeLocale(rawTag || "");
      if (!tag) return null;
      let quality = 1;
      for (const rawParam of rawParams) {
        const [key, value] = rawParam.split("=");
        if (key && key.trim() === "q") {
          const parsed = Number.parseFloat((value || "").trim());
          quality = Number.isFinite(parsed) ? parsed : 0;
        }
      }
      return { tag, quality, index };
    })
    .filter(
      /**
       * @param {{tag: string, quality: number, index: number} | null} language
       * @returns {language is {tag: string, quality: number, index: number}}
       */
      function isSupported(language) {
        return language !== null && language.quality > 0;
      },
    )
    .sort(function compareLanguages(a, b) {
      if (b.quality !== a.quality) return b.quality - a.quality;
      return a.index - b.index;
    })
    .map(function stripIndex(language) {
      return { tag: language.tag, quality: language.quality };
    });
}

/**
 * @param {string} locale
 * @returns {string}
 */
function localeBase(locale) {
  return locale.split("-", 1)[0] || locale;
}

/**
 * @param {string[]} supportedLanguages
 * @param {{tag: string, quality: number}[]} acceptedLanguages
 * @returns {string | undefined}
 */
function pickLanguage(supportedLanguages, acceptedLanguages) {
  for (const accepted of acceptedLanguages) {
    const acceptedTag = accepted.tag;
    if (acceptedTag === "*") return supportedLanguages[0];
    const acceptedBase = localeBase(acceptedTag);
    for (const supportedLanguage of supportedLanguages) {
      if (localeBase(supportedLanguage) === acceptedBase) {
        return supportedLanguage;
      }
    }
  }
  return undefined;
}

/**
 * @param {TemplateRequest} req
 * @returns {string}
 */
function findBaseUrl(req) {
  const proto =
    firstHeaderValue(req.headers["x-forwarded-proto"]) ||
    ("encrypted" in req.socket && req.socket.encrypted ? "https" : "http");
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) ||
    firstHeaderValue(req.headers.host) ||
    "localhost";
  return `${proto}://${host}`;
}

/**
 * @param {boolean} isDevelopment
 * @param {string} prodValue
 * @returns {string}
 */
function cacheControl(isDevelopment, prodValue) {
  return isDevelopment ? "no-store" : prodValue;
}

const startHtmlResponse =
  /** @type {(response: TemplateResponse, request: TemplateRequest, parsedUrl: URL, parameters: TemplateParameters, cacheControlValue: string, contentLength?: number) => { stream: import("stream").Writable, encoding: import("./http_compression.mjs").CompressionEncoding | undefined }} */
  (
    response,
    request,
    parsedUrl,
    parameters,
    cacheControlValue,
    contentLength,
  ) =>
    startCompressedResponse(response, request.headers["accept-encoding"], {
      ...(contentLength === undefined
        ? {}
        : { "Content-Length": contentLength }),
      "Content-Type": "text/html",
      "Cache-Control": cacheControlValue,
      ...(typeof parameters.etag === "string" ? { ETag: parameters.etag } : {}),
      ...(!parsedUrl.searchParams.get("lang")
        ? { Vary: "Accept-Language" }
        : {}),
    });

class Template {
  /** @type {ServerConfig} */
  serverConfig;

  /** @type {ClientConfig} */
  clientConfig;

  /**
   * @param {string} path
   * @param {ServerConfig} serverConfig
   */
  constructor(path, serverConfig) {
    const contents = fs.readFileSync(path, { encoding: "utf8" });
    this.template = handlebars.compile(contents);
    this.serverConfig = serverConfig;
    this.clientConfig = createClientConfiguration(serverConfig);
  }

  /**
   * @param {URL} parsedUrl
   * @param {TemplateRequest} request
   * @param {boolean} isModerator
   * @param {object} [extraParams]
   * @returns {TemplateParameters}
   */
  parameters(parsedUrl, request, isModerator, extraParams) {
    const accept_language_str =
      parsedUrl.searchParams.get("lang") ||
      firstHeaderValue(request.headers["accept-language"]) ||
      "";
    const accept_languages = parseAcceptLanguage(accept_language_str);
    let language = pickLanguage(languages, accept_languages) || "en";
    // The loose matcher returns the first language that partially matches, so we need to
    // check if the preferred language is supported to return it
    if (accept_languages.length > 0) {
      const preferred = accept_languages[0];
      if (preferred) {
        const preferred_language = preferred.tag;
        if (languages.includes(preferred_language)) {
          language = preferred_language;
        }
      }
    }
    const translations = TRANSLATIONS[language] || {};
    const configuration = this.clientConfig;
    const requestUrl = request.url || "/";
    const prefixPart = requestUrl.split("/boards/", 1)[0] || "";
    const prefix = prefixPart.startsWith("/")
      ? prefixPart.slice(1)
      : prefixPart;
    const baseUrl = findBaseUrl(request) + (prefix ? `/${prefix}/` : "");
    const moderator = isModerator;
    return {
      baseUrl,
      languages,
      language,
      translations,
      configuration,
      moderator,
      ...extraParams,
    };
  }

  /**
   * @param {TemplateRequest} request
   * @param {TemplateResponse} response
   * @param {boolean} [isModerator]
   * @param {object} [extraParams]
   * @returns {{encoding: CompressionEncoding | undefined}}
   */
  serve(request, response, isModerator, extraParams) {
    const parsedUrl = parseRequestUrl(request.url);
    const parameters = this.parameters(
      parsedUrl,
      request,
      isModerator === true,
      extraParams,
    );
    const body = this.template(parameters);
    const { stream, encoding } = startHtmlResponse(
      response,
      request,
      parsedUrl,
      parameters,
      this.cacheControl(),
      Buffer.byteLength(body),
    );
    stream.end(body);
    return { encoding };
  }

  /**
   * @returns {string}
   */
  cacheControl() {
    return cacheControl(
      this.serverConfig.IS_DEVELOPMENT,
      "public, max-age=3600",
    );
  }
}

class BoardTemplate extends Template {
  /**
   * @param {string} path
   * @param {ServerConfig} serverConfig
   */
  constructor(path, serverConfig) {
    super(path, serverConfig);
    const contents = fs.readFileSync(path, { encoding: "utf8" });
    const marker = "{{{inlineBoardSvg}}}";
    const markerIndex = contents.indexOf(marker);
    if (markerIndex === -1) {
      this.prefixTemplate = null;
      this.suffixTemplate = null;
      return;
    }
    this.prefixTemplate = handlebars.compile(contents.slice(0, markerIndex));
    this.suffixTemplate = handlebars.compile(
      contents.slice(markerIndex + marker.length),
    );
  }

  /**
   * @param {URL} parsedUrl
   * @param {TemplateRequest} request
   * @param {boolean} isModerator
   * @param {object} [extraParams]
   * @returns {TemplateParameters}
   */
  parameters(parsedUrl, request, isModerator, extraParams) {
    const params = super.parameters(
      parsedUrl,
      request,
      isModerator,
      extraParams,
    );
    const parts = parsedUrl.pathname.split("boards/", 2);
    const boardUriComponent = parts[1] || "";
    params.boardUriComponent = boardUriComponent;
    params.board = decodeURIComponent(boardUriComponent);
    params.hideMenu =
      parsedUrl.searchParams.get("hideMenu") === "true" || false;
    const configuration = /** @type {{BLOCKED_TOOLS?: string[]}} */ (
      params.configuration || {}
    );
    const blockedTools = Array.isArray(configuration.BLOCKED_TOOLS)
      ? configuration.BLOCKED_TOOLS
      : [];
    const visibleTools = /** @type {ToolbarTool[]} */ (
      getVisibleTools({
        blockedTools: blockedTools,
        boardState: params.boardState,
        moderator: isModerator,
      })
    );
    params.tools = visibleTools.map((tool) => ({
      id: tool.toolId,
      label: params.translations[tool.translationKey] || tool.label,
      iconUrl: tool.getIconUrl(),
    }));
    params.toolModulePreloads = Array.from(
      new Set(visibleTools.map((tool) => tool.toolId).concat("cursor")),
    )
      .map((toolId) => TOOL_BY_ID[toolId])
      .filter(isToolbarTool)
      .map((tool) => tool.getModuleImportPath());
    params.toolStylesheets = visibleTools
      .map((tool) => tool.getStylesheetUrl())
      .filter((href) => typeof href === "string");
    return params;
  }

  /**
   * @param {TemplateRequest} request
   * @param {TemplateResponse} response
   * @param {NodeJS.ReadableStream} inlineBoardSvgStream
   * @param {boolean} [isModerator]
   * @param {object} [extraParams]
   * @returns {{encoding: CompressionEncoding | undefined}}
   */
  serveStream(
    request,
    response,
    inlineBoardSvgStream,
    isModerator,
    extraParams,
  ) {
    if (!this.prefixTemplate || !this.suffixTemplate) {
      throw new Error("Board template is not configured for streaming SVG.");
    }
    const parsedUrl = parseRequestUrl(request.url);
    const parameters = this.parameters(
      parsedUrl,
      request,
      isModerator === true,
      extraParams,
    );
    const prefix = this.prefixTemplate(parameters);
    const suffix = this.suffixTemplate(parameters);
    const { stream, encoding } = startHtmlResponse(
      response,
      request,
      parsedUrl,
      parameters,
      this.cacheControl(),
    );
    stream.write(prefix);
    inlineBoardSvgStream.pipe(stream, { end: false });
    inlineBoardSvgStream.on("end", () => {
      stream.end(suffix);
    });
    return { encoding };
  }

  /**
   * @returns {string}
   */
  cacheControl() {
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(this.serverConfig.MAX_SAVE_DELAY / 1000) -
        BOARD_PAGE_CACHE_HEADROOM_SECONDS,
    );
    return cacheControl(
      this.serverConfig.IS_DEVELOPMENT,
      `public, max-age=${maxAgeSeconds}, must-revalidate`,
    );
  }
}

export { BoardTemplate, Template };
