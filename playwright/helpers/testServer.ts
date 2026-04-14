import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { AUTH_SECRET, TOKENS } from "./tokens";
import {
  withToken,
  writeBoard,
  readStoredBoard,
  waitForStoredBoard,
} from "./boardData";

export interface ServerSetupOptions {
  useJWT?: boolean;
  env?: Record<string, string | undefined>;
  token?: string;
}

export interface TestServer {
  child: ChildProcess;
  dataPath: string;
  serverUrl: string;
  tokenQuery: string;
  stderr: string[];
  useJWT: boolean;
  writeBoard: typeof writeBoard;
  readStoredBoard: typeof readStoredBoard;
  waitForStoredBoard: typeof waitForStoredBoard;
}

export async function startTestServer(
  options: ServerSetupOptions,
  testInfo: TestInfo,
): Promise<TestServer> {
  const dataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-test-data-"));
  const useJWT = options.useJWT ?? true;
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: "0",
    WBO_HISTORY_DIR: dataPath,
    WBO_SAVE_INTERVAL: "100",
    WBO_MAX_SAVE_DELAY: "100",
    WBO_MAX_EMIT_COUNT: "1000",
    WBO_MAX_EMIT_COUNT_PERIOD: "4096",
    WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "1000",
    WBO_MAX_DESTRUCTIVE_ACTIONS_PERIOD_MS: "60000",
    WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "1000",
    WBO_MAX_CONSTRUCTIVE_ACTIONS_PERIOD_MS: "60000",
    WBO_IP_SOURCE: "X-Forwarded-For",
    WBO_SILENT: "true",
    ...(options.env ?? {}),
  };

  let tokenQuery = "";
  if (useJWT) {
    env.AUTH_SECRET_KEY = AUTH_SECRET;
    tokenQuery = `token=${options.token ?? TOKENS.globalEditor}`;
  } else {
    delete env.AUTH_SECRET_KEY;
  }

  const serverPath = path.resolve("server", "server.js");
  const child = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  const stderr: string[] = [];
  let stdoutBuffer = "";

  try {
    const serverUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Server failed to start within 10s. Output: ${stdoutBuffer}`,
          ),
        );
      }, 10_000);

      const onServerStarted = (port: number | undefined) => {
        if (!port) return;
        clearTimeout(timeout);
        resolve(`http://localhost:${port}`);
      };

      child.on("message", (msg: { type?: string; port?: number }) => {
        if (msg.type === "server-started") onServerStarted(msg.port);
      });

      child.stdout?.on("data", (data: Buffer) => {
        const line = data.toString();
        stdoutBuffer += line;
        if (!line.includes("server started")) return;
        const match = line.match(/server started\s+({.*})/);
        if (!match) return;
        const config = JSON.parse(match[1] ?? "{}") as { port?: number };
        onServerStarted(config.port);
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr.push(data.toString());
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Server exited before startup (code=${code}, signal=${signal}). Output: ${stdoutBuffer}`,
          ),
        );
      });
    });

    return {
      child,
      dataPath,
      serverUrl,
      tokenQuery,
      stderr,
      useJWT,
      writeBoard,
      readStoredBoard,
      waitForStoredBoard,
    };
  } catch (err) {
    await stopTestServer(
      {
        child,
        dataPath,
        serverUrl: "",
        tokenQuery,
        stderr,
        useJWT,
        writeBoard,
        readStoredBoard,
        waitForStoredBoard,
      },
      testInfo,
    );
    throw err;
  }
}

export async function stopTestServer(server: TestServer, testInfo: TestInfo) {
  if (testInfo.status !== testInfo.expectedStatus && server.stderr.length > 0) {
    await testInfo.attach("server-stderr.txt", {
      body: Buffer.from(server.stderr.join("")),
      contentType: "text/plain",
    });
  }

  await new Promise<void>((resolve) => {
    if (!server.child || server.child.killed) {
      resolve();
      return;
    }
    server.child.once("exit", () => resolve());
    server.child.kill();
  });

  await fsp.rm(server.dataPath, { recursive: true, force: true });
}

export function rootUrl(
  serverUrl: string,
  token?: string,
  tokenQuery?: string,
) {
  return withToken(`${serverUrl}/`, token, tokenQuery);
}
