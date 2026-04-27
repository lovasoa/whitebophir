import * as fs from "node:fs";
import * as path from "node:path";

import serveStatic from "serve-static";

import { CSP, staticFileCacheControl } from "./http_cache_policy.mjs";
import observability from "./observability.mjs";
import * as templating from "./templating.mjs";

const { logger } = observability;

/** @import { HttpResponse, ServerConfig, ServerRuntime } from "../types/server-runtime.d.ts" */

/**
 * Reads the trusted startup-only HTML snippet inserted into rendered pages.
 *
 * @param {ServerConfig} config
 * @returns {string}
 */
function readHtmlHeadSnippet(config) {
  const snippetPath = config.HTML_HEAD_SNIPPET_PATH;
  if (typeof snippetPath !== "string" || snippetPath === "") return "";
  try {
    return fs.readFileSync(snippetPath, "utf8");
  } catch (error) {
    logger.error("html_head_snippet.read_failed", {
      path: snippetPath,
      error,
    });
    return "";
  }
}

/**
 * Builds the cold, request-independent dependencies shared by HTTP routes.
 *
 * @param {ServerConfig} config
 * @returns {ServerRuntime}
 */
function createServerRuntime(config) {
  const htmlHeadSnippet = readHtmlHeadSnippet(config);
  const fileserver = serveStatic(config.WEBROOT, {
    maxAge: 0,
    /** @param {HttpResponse} res */
    setHeaders: (res, /** @type {string} */ filePath) => {
      res.setHeader("Content-Security-Policy", CSP);
      const cacheValue = staticFileCacheControl(config, filePath || "");
      if (cacheValue !== undefined) res.setHeader("Cache-Control", cacheValue);
    },
  });
  const errorTemplate = new templating.StaticTemplate(
    path.join(config.WEBROOT, "error.html"),
    { htmlHeadSnippet },
  );
  const boardTemplate = new templating.BoardTemplate(
    path.join(config.WEBROOT, "board.html"),
    config,
    { htmlHeadSnippet },
  );
  const indexTemplate = new templating.Template(
    path.join(config.WEBROOT, "index.html"),
    config,
    { htmlHeadSnippet },
  );
  return {
    config,
    fileserver,
    errorPage: errorTemplate.render(),
    boardTemplate,
    indexTemplate,
  };
}

export { createServerRuntime, readHtmlHeadSnippet };
