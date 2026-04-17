const test = require("node:test");
const assert = require("node:assert/strict");

const BoardAuthoritativeView = require("../client-data/js/board_authoritative_view.js");

test("authoritative drawing markup advances only on persistent envelopes", () => {
  assert.equal(
    BoardAuthoritativeView.evolveAuthoritativeDrawingMarkup({
      previousMarkup: '<rect id="authoritative"></rect>',
      currentMarkup:
        '<rect id="authoritative"></rect><rect id="speculative"></rect>',
      isPersistentEnvelope: false,
    }),
    '<rect id="authoritative"></rect>',
  );
  assert.equal(
    BoardAuthoritativeView.evolveAuthoritativeDrawingMarkup({
      previousMarkup: '<rect id="old"></rect>',
      currentMarkup: '<rect id="new"></rect>',
      isPersistentEnvelope: true,
    }),
    '<rect id="new"></rect>',
  );
});

test("authoritative resync restores cached markup only after a baseline has been loaded", () => {
  assert.equal(
    BoardAuthoritativeView.markupForAuthoritativeResync({
      authoritativeMarkup: '<rect id="persisted"></rect>',
      hasAuthoritativeBoardSnapshot: true,
    }),
    '<rect id="persisted"></rect>',
  );
  assert.equal(
    BoardAuthoritativeView.markupForAuthoritativeResync({
      authoritativeMarkup: '<rect id="persisted"></rect>',
      hasAuthoritativeBoardSnapshot: false,
    }),
    null,
  );
});
