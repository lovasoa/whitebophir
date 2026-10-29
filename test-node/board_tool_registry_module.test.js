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
