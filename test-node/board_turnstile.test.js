const test = require("node:test");
const assert = require("node:assert/strict");

const BoardTurnstile =
  require("../client-data/js/board_transport.js").turnstile;

test("computeTurnstileValidation applies the client-side safety window", () => {
  const before = Date.now();
  const validation = BoardTurnstile.computeTurnstileValidation(
    { success: true, validationWindowMs: 12000 },
    0,
  );
  const after = Date.now();

  assert.equal(validation.validationWindowMs, 12000);
  assert.ok(validation.validatedUntil >= before + 7000);
  assert.ok(validation.validatedUntil <= after + 7000);
});

test("computeTurnstileValidation falls back to zero when validation is missing", () => {
  assert.deepEqual(BoardTurnstile.computeTurnstileValidation(false, 1000), {
    validatedUntil: 0,
    validationWindowMs: 0,
  });
});

test("resetTurnstileWidget only resets when the api is available", () => {
  /** @type {unknown[]} */
  const calls = [];
  assert.equal(
    BoardTurnstile.resetTurnstileWidget(
      {
        /** @param {unknown} widgetId */
        reset: (widgetId) => {
          calls.push(widgetId);
        },
      },
      "widget-1",
    ),
    true,
  );
  assert.deepEqual(calls, ["widget-1"]);
  assert.equal(
    BoardTurnstile.resetTurnstileWidget(undefined, "widget-1"),
    false,
  );
});
