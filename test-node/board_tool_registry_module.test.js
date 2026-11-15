const assert = require("node:assert/strict");
const test = require("node:test");

test("tool registries retain their own board configuration and viewport", async () => {
  const { ToolRegistryModule } = await import(
    "../client-data/js/board_tool_registry_module.js"
  );
  /** @param {number} scale @param {string[]} blockedTools */
  function runtime(scale, blockedTools) {
    return /** @type {import("../types/app-runtime").AppToolsState} */ (
      /** @type {unknown} */ ({
        config: { serverConfig: { BLOCKED_TOOLS: blockedTools } },
        viewportState: { scale },
      })
    );
  }
  const first = new ToolRegistryModule(
    () => runtime(1, ["pencil"]),
    () => {},
  );
  const second = new ToolRegistryModule(
    () => runtime(0, []),
    () => {},
  );
  const pencil = /** @type {import("../types/app-runtime").MountedAppTool} */ (
    /** @type {unknown} */ ({ name: "pencil" })
  );
  assert.equal(first.isBlocked(pencil), true);
  assert.equal(second.isBlocked(pencil), false);
  assert.equal(first.shouldDisableTool("pencil"), false);
  assert.equal(second.shouldDisableTool("pencil"), true);
});

test("tool runtime keeps private method receivers and live interaction and access state", async () => {
  const { createToolRuntimeModules } = await import(
    "../client-data/js/board_tool_registry_module.js"
  );
  const { InteractionModule, RateLimitModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const interaction = new InteractionModule();
  let canEdit = false;
  const tools =
    /** @type {import("../types/app-runtime").MountedAppToolsState} */ (
      /** @type {unknown} */ ({
        viewportState: { controller: {} },
        interaction,
        rateLimits: new RateLimitModule(
          {
            serverConfig: {
              RATE_LIMITS: { general: { limit: 8, periodMs: 1000 } },
            },
          },
          { boardName: "test", token: null },
        ),
        access: {
          get canEdit() {
            return canEdit;
          },
        },
      })
    );
  const runtime = createToolRuntimeModules(tools);
  assert.deepEqual(runtime.rateLimits.getEffectiveRateLimit("general"), {
    limit: 8,
    periodMs: 1000,
  });
  runtime.interaction.suppressOwnCursor("pencil");
  interaction.releaseOwner("pencil");
  assert.equal(runtime.interaction.isOwnCursorSuppressed(), false);
  assert.equal(runtime.permissions.canEdit, false);
  canEdit = true;
  assert.equal(runtime.permissions.canEdit, true);
});
