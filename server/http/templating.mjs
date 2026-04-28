import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handlebars from "handlebars";

import { TOOLBAR_TOOLS } from "../../client-data/tools/manifest.js";
import { createClientConfiguration } from "./client_configuration.mjs";
import { startCompressedResponse } from "./compression.mjs";
import { parseRequestUrl } from "./request_url.mjs";

/** @typedef {{[name: string]: string}} TranslationDictionary */
/** @typedef {{[language: string]: TranslationDictionary}} TranslationMap */
/** @typedef {{baseUrl: string, languages: string[], language: string, translations: TranslationDictionary, configuration: object, moderator: boolean, htmlHeadSnippet: string, [name: string]: any}} TemplateParameters */
/** @typedef {import("http").IncomingMessage} TemplateRequest */
/** @typedef {import("http").ServerResponse} TemplateResponse */
/** @typedef {string | string[] | undefined} HeaderValue */
/** @typedef {{blockedTools?: string[] | null, boardState?: {readonly?: boolean, canWrite?: boolean} | null, moderator?: boolean}} VisibleToolOptions */
/** @typedef {NonNullable<typeof TOOLBAR_TOOLS[number]>} ToolbarTool */
/** @typedef {import("./client_configuration.mjs").ClientConfiguration} ClientConfig */
/** @typedef {"zstd" | "br" | "gzip"} CompressionEncoding */
/** @typedef {{htmlHeadSnippet?: string}} TemplateOptions */
/** @import { ServerConfig } from "../../types/server-runtime.d.ts" */

const HTTP_DIR = path.dirname(fileURLToPath(import.meta.url));
const BOARD_PAGE_CACHE_HEADROOM_SECONDS = 5;

/**
 * Associations from language to translation dictionnaries
 * @const
 * @type {TranslationMap}
 */
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(HTTP_DIR, "translations.json"), "utf8"),
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
 * @param {string} pathname
 * @returns {string}
 */
function findPathPrefix(pathname) {
  const prefixPart = pathname.split("/boards/", 1)[0] || "";
  return prefixPart
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

/**
 * @param {string} baseUrl
 * @param {string} language
 * @returns {handlebars.SafeString}
 */
function localizedUrl(baseUrl, language) {
  const url = new URL(baseUrl);
  url.searchParams.set("lang", language);
  return new handlebars.SafeString(url.href);
}

/**
 * @param {string[]} supportedLanguages
 * @param {(language: string) => handlebars.SafeString} hrefForLanguage
 * @returns {{language: string, href: handlebars.SafeString}[]}
 */
function localizedLinks(supportedLanguages, hrefForLanguage) {
  return supportedLanguages.map((supportedLanguage) => ({
    language: supportedLanguage,
    href: hrefForLanguage(supportedLanguage),
  }));
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
  /** @type {(response: TemplateResponse, request: TemplateRequest, parsedUrl: URL, parameters: TemplateParameters, cacheControlValue: string, contentLength?: number) => { stream: import("stream").Writable, encoding: import("./compression.mjs").CompressionEncoding | undefined }} */
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

class StaticTemplate {
  /** @type {string} */
  templateContents;

  /** @type {string} */
  htmlHeadSnippet;

  /** @type {(parameters: {[name: string]: any}) => string} */
  template;

  /**
   * @param {string} templatePath
   * @param {TemplateOptions} [options]
   */
  constructor(templatePath, options) {
    const contents = fs.readFileSync(templatePath, { encoding: "utf8" });
    this.templateContents = contents;
    this.htmlHeadSnippet = options?.htmlHeadSnippet || "";
    this.template = handlebars.compile(contents);
  }

  /**
   * @param {{[name: string]: any}} [parameters]
   * @returns {string}
   */
  render(parameters = {}) {
    return this.template({
      htmlHeadSnippet: this.htmlHeadSnippet,
      ...parameters,
    });
  }
}

class Template extends StaticTemplate {
  /** @type {ServerConfig} */
  serverConfig;

  /** @type {ClientConfig} */
  clientConfig;

  /**
   * @param {string} templatePath
   * @param {ServerConfig} serverConfig
   * @param {TemplateOptions} [options]
   */
  constructor(templatePath, serverConfig, options) {
    super(templatePath, options);
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
    const prefix = findPathPrefix(parsedUrl.pathname);
    const baseUrl = findBaseUrl(request) + (prefix ? `/${prefix}/` : "");
    const moderator = isModerator;
    return {
      baseUrl,
      languages,
      languageLinks: localizedLinks(languages, (linkLanguage) =>
        localizedUrl(baseUrl, linkLanguage),
      ),
      language,
      canonicalUrl: localizedUrl(baseUrl, language),
      translations,
      configuration,
      moderator,
      htmlHeadSnippet: this.htmlHeadSnippet,
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
    const body = this.render(parameters);
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
   * @param {TemplateOptions} [options]
   */
  constructor(path, serverConfig, options) {
    super(path, serverConfig, options);
    const contents = this.templateContents;
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
    const boardBaseUrl = new URL(`boards/${boardUriComponent}`, params.baseUrl)
      .href;
    params.boardUriComponent = boardUriComponent;
    params.board = decodeURIComponent(boardUriComponent);
    params.canonicalUrl = localizedUrl(boardBaseUrl, params.language);
    params.languageLinks = localizedLinks(params.languages, (linkLanguage) =>
      localizedUrl(boardBaseUrl, linkLanguage),
    );
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
      iconUrl: `../${tool.iconPath}`,
    }));
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

export { BoardTemplate, StaticTemplate, Template };
