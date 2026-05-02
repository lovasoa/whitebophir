const test = require("node:test");
const assert = require("node:assert/strict");

test("interaction leases keep own-cursor suppression until every owner releases", async () => {
  const { InteractionModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const interaction = new InteractionModule();

  const first = interaction.acquire("pencil", {
    suppressOwnCursor: true,
  });
  const _second = interaction.acquire("text", {
    suppressOwnCursor: true,
  });

  assert.equal(interaction.isOwnCursorSuppressed(), true);

  first.release();
  first.release();

  assert.equal(interaction.isOwnCursorSuppressed(), true);

  interaction.releaseOwner("text");

  assert.equal(interaction.isOwnCursorSuppressed(), false);
});

test("interaction releaseAll clears own-cursor suppression", async () => {
  const { InteractionModule } = await import(
    "../client-data/js/board_full_runtime_modules.js"
  );
  const interaction = new InteractionModule();

  interaction.acquire("pencil", {
    suppressOwnCursor: true,
  });

  interaction.releaseAll();

  assert.equal(interaction.isOwnCursorSuppressed(), false);
});
