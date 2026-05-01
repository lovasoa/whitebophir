const test = require("node:test");
const assert = require("node:assert/strict");

function createClassList() {
  const names = new Set();
  return {
    /** @param {string} name */
    contains(name) {
      return names.has(name);
    },
    /**
     * @param {string} name
     * @param {boolean} [force]
     */
    toggle(name, force) {
      const enabled = force === undefined ? !names.has(name) : force;
      if (enabled) names.add(name);
      else names.delete(name);
      return enabled;
    },
  };
}

test("interaction leases keep drawing-area suppression until every owner releases", async () => {
  const { AttachedBoardDomRuntimeModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const { InteractionModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const drawingArea = { classList: createClassList() };
  const dom = new AttachedBoardDomRuntimeModule(
    /** @type {any} */ ({}),
    /** @type {any} */ ({}),
    /** @type {any} */ (drawingArea),
  );
  const interaction = new InteractionModule(() => dom);

  const first = interaction.acquire("pencil", {
    suppressDrawingAreaHitTesting: true,
    suppressOwnCursor: true,
  });
  const _second = interaction.acquire("text", {
    suppressDrawingAreaHitTesting: true,
  });

  assert.equal(interaction.isDrawingAreaHitTestingSuppressed(), true);
  assert.equal(interaction.isOwnCursorSuppressed(), true);
  assert.equal(drawingArea.classList.contains("hit-test-suppressed"), true);

  first.release();
  first.release();

  assert.equal(interaction.isDrawingAreaHitTestingSuppressed(), true);
  assert.equal(interaction.isOwnCursorSuppressed(), false);
  assert.equal(drawingArea.classList.contains("hit-test-suppressed"), true);

  interaction.releaseOwner("text");

  assert.equal(interaction.isDrawingAreaHitTestingSuppressed(), false);
  assert.equal(interaction.isOwnCursorSuppressed(), false);
  assert.equal(drawingArea.classList.contains("hit-test-suppressed"), false);
});

test("interaction releaseAll clears active lease effects", async () => {
  const { AttachedBoardDomRuntimeModule } = await import(
    "../client-data/js/board_runtime_core.js"
  );
  const { InteractionModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const drawingArea = { classList: createClassList() };
  const dom = new AttachedBoardDomRuntimeModule(
    /** @type {any} */ ({}),
    /** @type {any} */ ({}),
    /** @type {any} */ (drawingArea),
  );
  const interaction = new InteractionModule(() => dom);

  interaction.acquire("pencil", {
    suppressDrawingAreaHitTesting: true,
    suppressOwnCursor: true,
  });

  interaction.releaseAll();

  assert.equal(interaction.isDrawingAreaHitTestingSuppressed(), false);
  assert.equal(interaction.isOwnCursorSuppressed(), false);
  assert.equal(drawingArea.classList.contains("hit-test-suppressed"), false);
});
