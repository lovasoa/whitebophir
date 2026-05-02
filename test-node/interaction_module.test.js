const test = require("node:test");
const assert = require("node:assert/strict");

test("interaction own-cursor suppression is owner-scoped and idempotent", async () => {
  const { InteractionModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const interaction = new InteractionModule();

  const first = interaction.suppressOwnCursor("pencil");
  interaction.suppressOwnCursor("text");

  assert.equal(interaction.isOwnCursorSuppressed(), true);

  first.release();
  first.release();

  assert.equal(interaction.isOwnCursorSuppressed(), true);

  interaction.releaseOwner("text");

  assert.equal(interaction.isOwnCursorSuppressed(), false);

  interaction.suppressOwnCursor("pencil");
  interaction.releaseAll();

  assert.equal(interaction.isOwnCursorSuppressed(), false);
});
