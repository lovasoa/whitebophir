const test = require("node:test");
const assert = require("node:assert/strict");

const {
  colorizeLevelInLogLine,
  dimLogLineKeys,
  flattenError,
  formatCanonicalLogLine,
  formatLogfmtValue,
  styleTerminalLogLine,
} = require("../server/logfmt.js");

test("formatLogfmtValue quotes whitespace and escapes quotes", () => {
  assert.equal(formatLogfmtValue("plain"), "plain");
  assert.equal(formatLogfmtValue("two words"), '"two words"');
  assert.equal(formatLogfmtValue('say "hi"'), '"say \\"hi\\""');
});

test("flattenError extracts stable error fields", () => {
  const error = new TypeError("boom");
  const flattened = flattenError(error);

  assert.equal(flattened.error_type, "TypeError");
  assert.equal(flattened.error_message, "boom");
  assert.match(flattened.error_stack || "", /TypeError: boom/);
});

test("formatCanonicalLogLine emits the canonical envelope first", () => {
  const line = formatCanonicalLogLine({
    ts: "2026-04-14T12:00:00.000Z",
    level: "info",
    event: "http.request_failed",
    status_code: 200,
  });

  assert.equal(
    line,
    "ts=2026-04-14T12:00:00.000Z level=info event=http.request_failed status_code=200",
  );
});

test("colorizeLevelInLogLine colors only the level value", () => {
  assert.equal(
    colorizeLevelInLogLine(
      "ts=2026-04-14T12:00:00.000Z level=warn event=board.joined",
      "warn",
    ),
    "ts=2026-04-14T12:00:00.000Z level=\x1b[33mwarn\x1b[0m event=board.joined",
  );
  assert.equal(
    colorizeLevelInLogLine(
      "ts=2026-04-14T12:00:00.000Z level=info event=board.joined",
      "fatal",
    ),
    "ts=2026-04-14T12:00:00.000Z level=info event=board.joined",
  );
});

test("dimLogLineKeys dims only the keys", () => {
  assert.equal(
    dimLogLineKeys(
      "ts=2026-04-14T12:00:00.000Z level=warn event=board.joined board=demo",
    ),
    "\x1b[2mts=\x1b[0m2026-04-14T12:00:00.000Z \x1b[2mlevel=\x1b[0mwarn \x1b[2mevent=\x1b[0mboard.joined \x1b[2mboard=\x1b[0mdemo",
  );
});

test("styleTerminalLogLine combines dim keys with colored level values", () => {
  assert.equal(
    styleTerminalLogLine(
      "ts=2026-04-14T12:00:00.000Z level=warn event=board.joined board=demo",
      "warn",
    ),
    "\x1b[2mts=\x1b[0m2026-04-14T12:00:00.000Z \x1b[2mlevel=\x1b[0m\x1b[33mwarn\x1b[0m \x1b[2mevent=\x1b[0mboard.joined \x1b[2mboard=\x1b[0mdemo",
  );
});
