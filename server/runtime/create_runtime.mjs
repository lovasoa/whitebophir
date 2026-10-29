import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import serveStatic from "serve-static";

import { CSP, staticFileCacheControl } from "../http/cache_policy.mjs";
import * as templating from "../http/templating.mjs";
import observability from "../observability/index.mjs";

const { logger } = observability;
const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_WEBROOT = path.resolve(RUNTIME_DIR, "../../client-data");

/** @import { HttpResponse, ServerConfig, ServerRuntime } from "../../types/server-runtime.d.ts" */

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
 * @param {ServerConfig} config
 * @param {string} fileName
 * @returns {string}
 */
function configuredTemplatePath(config, fileName) {
  return path.join(config.WEBROOT, fileName);
}

/**
 * @param {ServerConfig} config
 * @param {string} fileName
 * @returns {string}
 */
function configuredTemplatePathWithBundledFallback(config, fileName) {
  const configuredPath = configuredTemplatePath(config, fileName);
  if (fs.existsSync(configuredPath)) return configuredPath;
  return path.join(BUNDLED_WEBROOT, fileName);
}

/**
 * @param {ServerConfig} config
 * @returns {import("../../types/server-runtime.d.ts").StaticFileServer}
 */
function createStaticFileServer(config) {
  const configuredFileserver = createSingleRootStaticFileServer(
    config,
    config.WEBROOT,
  );
  const configuredRoot = path.resolve(config.WEBROOT);
  if (configuredRoot === BUNDLED_WEBROOT) return configuredFileserver;

  const bundledFileserver = createSingleRootStaticFileServer(
    config,
    BUNDLED_WEBROOT,
  );
  return (request, response, next) => {
    const originalUrl = request.url;
    configuredFileserver(request, response, (error) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      request.url = originalUrl;
      bundledFileserver(request, response, next);
    });
  };
}

/**
 * @param {ServerConfig} config
 * @param {string} root
 * @returns {import("../../types/server-runtime.d.ts").StaticFileServer}
 */
function createSingleRootStaticFileServer(config, root) {
  return serveStatic(root, {
    maxAge: 0,
    /** @param {HttpResponse} res */
    setHeaders: (res, /** @type {string} */ filePath) => {
      res.setHeader("Content-Security-Policy", CSP);
      const cacheValue = staticFileCacheControl(config, filePath || "");
      if (cacheValue !== undefined) res.setHeader("Cache-Control", cacheValue);
    },
  });
}

/**
 * Builds the cold, request-independent dependencies shared by HTTP routes.
 *
 * @param {ServerConfig} config
 * @returns {ServerRuntime}
 */
function createServerRuntime(config) {
  const htmlHeadSnippet = readHtmlHeadSnippet(config);
  const fileserver = createStaticFileServer(config);
  const errorTemplate = new templating.Template(
    configuredTemplatePath(config, "error.html"),
    config,
    { htmlHeadSnippet },
  );
  const boardTemplate = new templating.BoardTemplate(
    configuredTemplatePath(config, "board.html"),
    config,
    { htmlHeadSnippet },
  );
  const indexTemplate = new templating.Template(
    configuredTemplatePath(config, "index.html"),
    config,
    { htmlHeadSnippet },
  );
  const rulesTemplate = new templating.RulesTemplate(
    configuredTemplatePathWithBundledFallback(config, "rules.html"),
    config,
    { htmlHeadSnippet },
  );
  const manifestTemplate = new templating.Template(
    configuredTemplatePath(config, "manifest.json"),
    config,
    { htmlHeadSnippet },
  );
  return {
    config,
    fileserver,
    errorPage: errorTemplate,
    boardTemplate,
    indexTemplate,
    rulesTemplate,
    manifestTemplate,
  };
}

export { createServerRuntime };
