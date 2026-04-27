import * as fs from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";

import { ATTR_SERVER_PORT } from "@opentelemetry/semantic-conventions";
import serveStatic from "serve-static";

import { check_output_directory } from "./check_output_directory.mjs";
import { CSP, staticFileCacheControl } from "./http_cache_policy.mjs";
import { errorCode, handleClientError } from "./http_observation.mjs";
import { createRequestHandler } from "./http_routes.mjs";
import observability from "./observability.mjs";
import * as sockets from "./sockets.mjs";
import * as templating from "./templating.mjs";

const { logger } = observability;

/** @typedef {import("http").IncomingMessage} HttpRequest */
/** @typedef {import("http").ServerResponse} HttpResponse */
/** @import { ServerConfig } from "../types/server-runtime.d.ts" */
/** @typedef {(request: HttpRequest, response: HttpResponse, next: (error?: unknown) => void) => void} StaticFileServer */
/** @typedef {{
 *   config: ServerConfig,
 *   fileserver: StaticFileServer,
 *   errorPage: string,
 *   boardTemplate: templating.BoardTemplate,
 *   indexTemplate: templating.Template,
 * }} ServerRuntime */

/**
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

/**
 * @param {import("http").Server} server
 * @param {{shutdown?: () => Promise<void>}} socketModule
 * @returns {void}
 */
function installShutdownHandlers(server, socketModule) {
  let shutdownRequested = false;

  /**
   * @param {NodeJS.Signals} signal
   * @returns {Promise<void>}
   */
  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("server.shutdown_started", { signal });
    try {
      await socketModule.shutdown?.();
      await new Promise(
        /**
         * @param {(value?: void | PromiseLike<void>) => void} resolve
         * @param {(reason?: unknown) => void} reject
         */
        (resolve, reject) => {
          server.close((error) => {
            if (!error || errorCode(error) === "ERR_SERVER_NOT_RUNNING") {
              resolve();
              return;
            }
            reject(error);
          });
          server.closeAllConnections?.();
        },
      );
      logger.info("server.shutdown_completed", { signal });
      process.exit(0);
    } catch (error) {
      logger.error("server.shutdown_failed", {
        signal,
        error,
      });
      process.exit(1);
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

/**
 * @param {ServerConfig} config
 * @param {{
 *   installShutdownHandlers?: boolean,
 *   logStarted?: boolean,
 *   socketsModule?: {
 *     start: (app: import("http").Server, config: ServerConfig) => Promise<void>,
 *     shutdown?: () => Promise<void>,
 *   },
 * }} [options]
 * @returns {Promise<import("http").Server & {shutdown?: () => Promise<void>}>}
 */
async function createServerApp(config, options = {}) {
  const runtime = createServerRuntime(config);
  const requestHandler = createRequestHandler(runtime);
  const socketModule = options.socketsModule || sockets;
  await check_output_directory(config.HISTORY_DIR);
  const app =
    /** @type {import("http").Server & {shutdown?: () => Promise<void>}} */ (
      createServer(requestHandler)
    );
  app.on("clientError", handleClientError);
  await socketModule.start(app, config);
  if (options.installShutdownHandlers === true) {
    installShutdownHandlers(app, socketModule);
  }
  await new Promise(
    /**
     * @param {(value: void | PromiseLike<void>) => void} resolve
     */
    (resolve) => {
      app.listen(config.PORT, config.HOST, resolve);
    },
  );
  if (options.logStarted !== false) {
    const address = app.address();
    const actualPort =
      address && typeof address !== "string" ? address.port : undefined;
    logger.info("server.started", {
      [ATTR_SERVER_PORT]: actualPort,
      "log.level": config.LOG_LEVEL,
    });
    if (process.send)
      process.send({ type: "server-started", port: actualPort });
  }
  app.shutdown = async () => {
    await socketModule.shutdown?.();
    await new Promise(
      /**
       * @param {(value: void | PromiseLike<void>) => void} resolve
       * @param {(reason?: unknown) => void} reject
       */
      (resolve, reject) => {
        app.close((error) => {
          if (!error || errorCode(error) === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          reject(error);
        });
        app.closeAllConnections?.();
      },
    );
  };
  return app;
}

export { createServerApp };
