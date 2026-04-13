const handlebars = require("handlebars");
const fs = require("node:fs");
const path = require("node:path");
const accept_language_parser = require("accept-language-parser");
const client_config = require("./client_configuration");

/** @typedef {string | string[] | undefined} HeaderValue */
/** @typedef {{headers: {[name: string]: HeaderValue}, socket: {encrypted?: boolean}, url: string}} TemplateRequest */
/** @typedef {{writeHead: (statusCode: number, headers: {[name: string]: string | number}) => void, end: (body?: string) => void}} TemplateResponse */
/** @typedef {{[name: string]: string}} TranslationDictionary */
/** @typedef {{[language: string]: TranslationDictionary}} TranslationMap */
/** @typedef {{baseUrl: string, languages: string[], language: string, translations: TranslationDictionary, configuration: object, moderator: boolean, version: string, [name: string]: any}} TemplateParameters */

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
 * @param {TemplateRequest} req
 * @returns {string}
 */
function findBaseUrl(req) {
  var proto =
    firstHeaderValue(req.headers["x-forwarded-proto"]) ||
    (req.socket.encrypted ? "https" : "http");
  var host =
    firstHeaderValue(req.headers["x-forwarded-host"]) ||
    firstHeaderValue(req.headers.host) ||
    "localhost";
  return proto + "://" + host;
}

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
    const accept_languages = accept_language_parser.parse(accept_language_str);
    const opts = { loose: true };
    let language =
      accept_language_parser.pick(languages, accept_languages, opts) || "en";
    // The loose matcher returns the first language that partially matches, so we need to
    // check if the preferred language is supported to return it
    if (accept_languages.length > 0) {
      const preferred = accept_languages[0];
      if (preferred) {
        const preferred_language = preferred.region
          ? preferred.code + "-" + preferred.region
          : preferred.code;
        if (languages.includes(preferred_language)) {
          language = preferred_language;
        }
      }
    }
    const translations = TRANSLATIONS[language] || {};
    const configuration = client_config || {};
    const prefixPart = request.url.split("/boards/", 1)[0] || "";
    const prefix = prefixPart.startsWith("/") ? prefixPart.slice(1) : prefixPart;
    const baseUrl = findBaseUrl(request) + (prefix ? "/" + prefix + "/" : "");
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
    const parsedUrl = new URL(request.url, "http://wbo/");
    const parameters = this.parameters(
      parsedUrl,
      request,
      isModerator === true,
      extraParams,
    );
    var body = this.template(parameters);
    /** @type {{[name: string]: string | number}} */
    var headers = {
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "text/html",
      "Cache-Control": "public, max-age=3600",
    };
    if (!parsedUrl.searchParams.get("lang")) {
      headers["Vary"] = "Accept-Language";
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
    params["boardUriComponent"] = boardUriComponent;
    params["board"] = decodeURIComponent(boardUriComponent);
    params["hideMenu"] =
      parsedUrl.searchParams.get("hideMenu") == "true" || false;
    return params;
  }
}

module.exports = { Template, BoardTemplate };
