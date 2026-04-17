const test = require("node:test");
const assert = require("node:assert/strict");

const BoardAuthoritativeView = require("../client-data/js/board_authoritative_view.js");

test("authoritative drawing markup advances only on authoritative messages", () => {
  assert.equal(
    BoardAuthoritativeView.evolveAuthoritativeDrawingMarkup({
      previousMarkup: '<rect id="authoritative"></rect>',
      currentMarkup:
        '<rect id="authoritative"></rect><rect id="speculative"></rect>',
      isPersistentEnvelope: false,
      isSnapshotMessage: false,
    }),
    '<rect id="authoritative"></rect>',
  );
  assert.equal(
    BoardAuthoritativeView.evolveAuthoritativeDrawingMarkup({
      previousMarkup: '<rect id="old"></rect>',
      currentMarkup: '<rect id="new"></rect>',
      isPersistentEnvelope: true,
      isSnapshotMessage: false,
    }),
    '<rect id="new"></rect>',
  );
  assert.equal(
    BoardAuthoritativeView.evolveAuthoritativeDrawingMarkup({
      previousMarkup: '<rect id="old"></rect>',
      currentMarkup: '<rect id="snapshot"></rect>',
      isPersistentEnvelope: false,
      isSnapshotMessage: true,
    }),
    '<rect id="snapshot"></rect>',
  );
});

test("authoritative resync restores cached markup only for seq clients with a snapshot", () => {
  assert.equal(
    BoardAuthoritativeView.markupForAuthoritativeResync({
      authoritativeMarkup: '<rect id="persisted"></rect>',
      useSeqSyncProtocol: true,
      hasAuthoritativeBoardSnapshot: true,
    }),
    '<rect id="persisted"></rect>',
  );
  assert.equal(
    BoardAuthoritativeView.markupForAuthoritativeResync({
      authoritativeMarkup: '<rect id="persisted"></rect>',
      useSeqSyncProtocol: false,
      hasAuthoritativeBoardSnapshot: true,
    }),
    null,
  );
  assert.equal(
    BoardAuthoritativeView.markupForAuthoritativeResync({
      authoritativeMarkup: '<rect id="persisted"></rect>',
      useSeqSyncProtocol: true,
      hasAuthoritativeBoardSnapshot: false,
    }),
    null,
  );
});
