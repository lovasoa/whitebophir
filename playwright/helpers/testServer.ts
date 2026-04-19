import { type ChildProcess, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import {
  readStoredBoard,
  waitForStoredBoard,
  withToken,
  writeBoard,
} from "./boardData";
import { AUTH_SECRET, TOKENS } from "./tokens";

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

function parseServerStartedPort(line: string): number | null {
  if (!line.includes("server started")) return null;
  const match = line.match(/server started\s+({.*})/);
  if (!match) return null;
  const config = JSON.parse(match[1] ?? "{}") as { port?: number };
  return typeof config.port === "number" ? config.port : null;
}

function collectChildStderr(child: ChildProcess, stderr: string[]) {
  const handleStderr = (data: Buffer) => {
    stderr.push(data.toString());
  };
  child.stderr?.on("data", handleStderr);
  return () => {
    child.stderr?.off("data", handleStderr);
  };
}

function waitForServerStarted(
  child: ChildProcess,
  getStdoutBuffer: () => string,
  appendStdout: (chunk: string) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Server failed to start within 10s. Output: ${getStdoutBuffer()}`,
        ),
      );
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", handleMessage);
      child.off("error", handleError);
      child.off("exit", handleExit);
      child.stdout?.off("data", handleStdout);
    };

    const resolveWithPort = (port: number | undefined) => {
      if (!port) return;
      cleanup();
      resolve(`http://localhost:${port}`);
    };

    const handleMessage = (msg: { type?: string; port?: number }) => {
      if (msg.type === "server-started") resolveWithPort(msg.port);
    };

    const handleStdout = (data: Buffer) => {
      const line = data.toString();
      appendStdout(line);
      resolveWithPort(parseServerStartedPort(line) ?? undefined);
    };

    const handleError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Server exited before startup (code=${code}, signal=${signal}). Output: ${getStdoutBuffer()}`,
        ),
      );
    };

    child.on("message", handleMessage);
    child.on("error", handleError);
    child.on("exit", handleExit);
    child.stdout?.on("data", handleStdout);
  });
}

function waitForChildExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

function waitForTimeout(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

export async function startTestServer(
  options: ServerSetupOptions,
  testInfo: TestInfo,
): Promise<TestServer> {
  const dataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "wbo-test-data-"));
  const useJWT = options.useJWT ?? false;
  // Keep the shared Playwright harness effectively unbounded so incidental
  // multi-page activity in CI does not trip production-like rate limits.
  // Specs that exercise rate limiting must override these defaults explicitly.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: "0",
    WBO_HISTORY_DIR: dataPath,
    WBO_SAVE_INTERVAL: "100",
    WBO_MAX_SAVE_DELAY: "100",
    WBO_MAX_EMIT_COUNT: "*:100000/60s",
    WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:100000/60s anonymous:100000/60s",
    WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:100000/60s anonymous:100000/60s",
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

  const serverPath = path.resolve("server", "server.mjs");
  const child = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  const stderr: string[] = [];
  let stdoutBuffer = "";
  const stopCollectingStderr = collectChildStderr(child, stderr);

  try {
    const serverUrl = await waitForServerStarted(
      child,
      () => stdoutBuffer,
      (chunk) => {
        stdoutBuffer += chunk;
      },
    );

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
    stopCollectingStderr();
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

  if (server.child && !server.child.killed) {
    const exitPromise = waitForChildExit(server.child);
    server.child.kill();
    await Promise.race([exitPromise, waitForTimeout(5_000)]);
    if (server.child.exitCode === null && server.child.signalCode === null) {
      server.child.kill("SIGKILL");
      await exitPromise;
    }
  }

  await fsp.rm(server.dataPath, { recursive: true, force: true });
}

export function rootUrl(
  serverUrl: string,
  token?: string,
  tokenQuery?: string,
) {
  return withToken(`${serverUrl}/`, token, tokenQuery);
}
