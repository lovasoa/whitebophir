import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as productionConfig from "./configuration.mjs";
import { createServerApp } from "./http_runtime.mjs";
import observability from "./observability.mjs";

const { logger } = observability;

const entryArg = process.argv[1];
if (entryArg && path.resolve(entryArg) === fileURLToPath(import.meta.url)) {
  void createServerApp(productionConfig, {
    installShutdownHandlers: true,
  }).catch((error) => {
    logger.error("server.start_failed", {
      error,
    });
    process.exit(1);
  });
}

export { createServerApp };
