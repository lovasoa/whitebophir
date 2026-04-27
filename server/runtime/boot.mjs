import { createServer } from "node:http";

import { ATTR_SERVER_PORT } from "@opentelemetry/semantic-conventions";

import { check_output_directory } from "./check_output_directory.mjs";
import { errorCode, handleClientError } from "../http/observation.mjs";
import observability from "../observability/index.mjs";

const { logger } = observability;

/** @import { HttpRequestHandler, ServerApp, ServerConfig, ServerRuntime, SocketServerModule } from "../../types/server-runtime.d.ts" */

/**
 * @param {import("http").Server} server
 * @param {SocketServerModule} socketModule
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
      await closeHttpServer(server);
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
 * @param {import("http").Server} server
 * @returns {Promise<void>}
 */
function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || errorCode(error) === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
    server.closeAllConnections?.();
  });
}

/**
 * Starts the HTTP server, attaches sockets, and owns process-level lifecycle.
 *
 * @param {ServerConfig} config
 * @param {{
 *   runtime: (config: ServerConfig) => ServerRuntime,
 *   http: HttpRequestHandler,
 *   sockets: SocketServerModule,
 *   installShutdownHandlers?: boolean,
 *   logStarted?: boolean,
 * }} options
 * @returns {Promise<ServerApp>}
 */
async function startWhiteboardServer(config, options) {
  const runtime = options.runtime(config);
  const app = /** @type {ServerApp} */ (
    createServer((request, response) => {
      options.http({ request, response, runtime });
    })
  );

  app.on("clientError", handleClientError);
  await check_output_directory(config.HISTORY_DIR);
  await options.sockets.start(app, config);
  if (options.installShutdownHandlers === true) {
    installShutdownHandlers(app, options.sockets);
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
    if (process.send) {
      process.send({ type: "server-started", port: actualPort });
    }
  }
  app.shutdown = async () => {
    await options.sockets.shutdown?.();
    await closeHttpServer(app);
  };
  return app;
}

export { startWhiteboardServer };
