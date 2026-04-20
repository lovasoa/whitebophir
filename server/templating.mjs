import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handlebars from "handlebars";
import packageJson from "../package.json" with { type: "json" };

import client_config from "./client_configuration.mjs";
import { readConfiguration } from "./configuration.mjs";
import {
  getToolIconUrl,
  getToolModuleImportPath,
  getToolStylesheetUrl,
  withVersion,
} from "../client-data/js/tool_assets.js";
import { applyCompressionForResponse } from "./http_compression.mjs";
import {
  getVisibleToolCatalogEntries,
  TOOL_CATALOG,
} from "../client-data/js/tool_catalog.js";
import { parseRequestUrl } from "./request_url.mjs";

/** @typedef {{[name: string]: string}} TranslationDictionary */
/** @typedef {{[language: string]: TranslationDictionary}} TranslationMap */
/** @typedef {{baseUrl: string, languages: string[], language: string, translations: TranslationDictionary, configuration: object, moderator: boolean, version: string, [name: string]: any}} TemplateParameters */
/** @typedef {import("http").IncomingMessage} TemplateRequest */
/** @typedef {import("http").ServerResponse} TemplateResponse */
/** @typedef {string | string[] | undefined} HeaderValue */

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

class Template {
  /**
   * @param {string} path
   */
  constructor(path) {
    const contents = fs.readFileSync(path, { encoding: "utf8" });
    this.template = handlebars.compile(contents);
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
    const configuration = client_config || {};
    const requestUrl = request.url || "/";
    const prefixPart = requestUrl.split("/boards/", 1)[0] || "";
    const prefix = prefixPart.startsWith("/")
      ? prefixPart.slice(1)
      : prefixPart;
    const baseUrl = findBaseUrl(request) + (prefix ? `/${prefix}/` : "");
    const moderator = isModerator;
    const version = packageJson.version;
    return {
      baseUrl,
      languages,
      language,
      translations,
      configuration,
      moderator,
      version,
      ...extraParams,
    };
  }

  /**
   * @param {TemplateRequest} request
   * @param {TemplateResponse} response
   * @param {boolean} [isModerator]
   * @param {object} [extraParams]
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
    /** @type {{[name: string]: string | number}} */
    const headers = {
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "text/html",
      "Cache-Control": this.cacheControl(),
    };
    if (typeof parameters.etag === "string") {
      headers.ETag = parameters.etag;
    }
    if (!parsedUrl.searchParams.get("lang")) {
      headers.Vary = "Accept-Language";
    }
    const { stream } = applyCompressionForResponse(
      response,
      request.headers["accept-encoding"],
      headers,
    );
    response.writeHead(200, headers);
    stream.end(body);
  }

  /**
   * @returns {string}
   */
  cacheControl() {
    return readConfiguration().IS_DEVELOPMENT
      ? "no-store"
      : "public, max-age=3600";
  }
}

class BoardTemplate extends Template {
  /**
   * @param {string} path
   */
  constructor(path) {
    super(path);
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
    const visibleTools = getVisibleToolCatalogEntries({
      blockedTools: blockedTools,
      boardState: params.boardState,
      moderator: isModerator,
    });
    params.tools = visibleTools.map((tool) => ({
      name: tool.name,
      label:
        params.translations[tool.name.toLowerCase().replace(/ /g, "_")] ||
        tool.name,
      iconUrl: getToolIconUrl(tool.name, params.version),
    }));
    params.toolModulePreloads = Array.from(
      new Set(visibleTools.map((tool) => tool.name).concat("Cursor")),
    ).map((toolName) =>
      withVersion(getToolModuleImportPath(toolName), params.version),
    );
    params.toolStylesheets = TOOL_CATALOG.map((tool) =>
      getToolStylesheetUrl(tool.name, params.version),
    ).filter((href) => typeof href === "string");
    return params;
  }

  /**
   * @param {TemplateRequest} request
   * @param {TemplateResponse} response
   * @param {NodeJS.ReadableStream} inlineBoardSvgStream
   * @param {boolean} [isModerator]
   * @param {object} [extraParams]
   * @returns {void}
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
    /** @type {{[name: string]: string | number}} */
    const headers = {
      "Content-Type": "text/html",
      "Cache-Control": this.cacheControl(),
    };
    if (typeof parameters.etag === "string") {
      headers.ETag = parameters.etag;
    }
    if (!parsedUrl.searchParams.get("lang")) {
      headers.Vary = "Accept-Language";
    }
    const { stream } = applyCompressionForResponse(
      response,
      request.headers["accept-encoding"],
      headers,
    );
    response.writeHead(200, headers);
    stream.write(prefix);
    inlineBoardSvgStream.pipe(stream, { end: false });
    inlineBoardSvgStream.on("end", () => {
      stream.end(suffix);
    });
  }

  /**
   * @returns {string}
   */
  cacheControl() {
    const serverConfig = readConfiguration();
    if (serverConfig.IS_DEVELOPMENT) {
      return "no-store";
    }
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(serverConfig.MAX_SAVE_DELAY / 1000) -
        BOARD_PAGE_CACHE_HEADROOM_SECONDS,
    );
    return `public, max-age=${maxAgeSeconds}, must-revalidate`;
  }
}

export { BoardTemplate, Template };
