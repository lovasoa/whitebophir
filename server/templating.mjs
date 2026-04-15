import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import handlebars from "handlebars";
import fs from "node:fs";
import path from "node:path";

import client_config from "./client_configuration.mjs";

/** @typedef {{[name: string]: string}} TranslationDictionary */
/** @typedef {{[language: string]: TranslationDictionary}} TranslationMap */
/** @typedef {{baseUrl: string, languages: string[], language: string, translations: TranslationDictionary, configuration: object, moderator: boolean, version: string, [name: string]: any}} TemplateParameters */
/** @typedef {import("http").IncomingMessage} TemplateRequest */
/** @typedef {import("http").ServerResponse} TemplateResponse */
/** @typedef {string | string[] | undefined} HeaderValue */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Associations from language to translation dictionnaries
 * @const
 * @type {TranslationMap}
 */
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "translations.json"), "utf8"),
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

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

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
    return Object.assign(
      {
        baseUrl,
        languages,
        language,
        translations,
        configuration,
        moderator,
        version,
      },
      extraParams,
    );
  }

  /**
   * @param {TemplateRequest} request
   * @param {TemplateResponse} response
   * @param {boolean} [isModerator]
   * @param {object} [extraParams]
   */
  serve(request, response, isModerator, extraParams) {
    const parsedUrl = new URL(request.url || "/", "http://wbo/");
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
      "Cache-Control": "public, max-age=3600",
    };
    if (!parsedUrl.searchParams.get("lang")) {
      headers.Vary = "Accept-Language";
    }
    response.writeHead(200, headers);
    response.end(body);
  }
}

class BoardTemplate extends Template {
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
    return params;
  }
}

export { Template, BoardTemplate };
