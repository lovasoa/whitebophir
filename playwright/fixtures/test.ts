import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import {
  type ServerSetupOptions,
  startTestServer,
  stopTestServer,
  type TestServer,
} from "../helpers/testServer";
import { BoardPage } from "../pages/BoardPage";

type Fixtures = {
  server: TestServer;
  boardPage: BoardPage;
};

type Options = {
  serverOptions: ServerSetupOptions;
};

export const test = base.extend<Fixtures, Options>({
  serverOptions: [{ useJWT: false }, { option: true, scope: "worker" }],

  server: async ({ serverOptions }, use, testInfo) => {
    const server = await startTestServer(serverOptions, testInfo);
    try {
      await use(server);
    } finally {
      await stopTestServer(server, testInfo);
    }
  },

  boardPage: async ({ page, server }, use) => {
    await use(new BoardPage(page, server));
  },
});

export { expect };
export function createBoardPage(page: Page, server: TestServer) {
  return new BoardPage(page, server);
}
