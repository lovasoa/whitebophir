const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LOGFMT_MODULE_URL = pathToFileURL(
  path.join(__dirname, "..", "server", "logfmt.mjs"),
).href;
let loadSequence = 0;

async function loadLogfmt() {
  return import(`${LOGFMT_MODULE_URL}?cache-bust=${++loadSequence}`);
}

test("formatLogfmtValue quotes whitespace and escapes quotes", async () => {
  const { formatLogfmtValue } = await loadLogfmt();
  assert.equal(formatLogfmtValue("plain"), "plain");
  assert.equal(formatLogfmtValue("two words"), '"two words"');
  assert.equal(formatLogfmtValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(
    formatLogfmtValue("first line\nsecond line\tindent"),
    '"first line\\nsecond line\\tindent"',
  );
});

test("flattenError extracts stable error fields", async () => {
  const { flattenError } = await loadLogfmt();
  const error = new TypeError("boom");
  const flattened = flattenError(error);

  assert.equal(flattened["exception.type"], "TypeError");
  assert.equal(flattened["exception.message"], "boom");
  assert.match(flattened["exception.stacktrace"] || "", /TypeError: boom/);
});

test("formatCanonicalLogLine emits the canonical envelope first", async () => {
  const { formatCanonicalLogLine } = await loadLogfmt();
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

test("colorizeLevelInLogLine colors only the level value", async () => {
  const { colorizeLevelInLogLine } = await loadLogfmt();
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

test("dimLogLineKeys dims only the keys", async () => {
  const { dimLogLineKeys } = await loadLogfmt();
  assert.equal(
    dimLogLineKeys(
      "ts=2026-04-14T12:00:00.000Z level=warn event=board.joined board=demo",
    ),
    "\x1b[2mts=\x1b[0m2026-04-14T12:00:00.000Z \x1b[2mlevel=\x1b[0mwarn \x1b[2mevent=\x1b[0mboard.joined \x1b[2mboard=\x1b[0mdemo",
  );
});

test("styleTerminalLogLine combines dim keys with colored level values", async () => {
  const { styleTerminalLogLine } = await loadLogfmt();
  assert.equal(
    styleTerminalLogLine(
      "ts=2026-04-14T12:00:00.000Z level=warn event=board.joined board=demo",
      "warn",
    ),
    "\x1b[2mts=\x1b[0m2026-04-14T12:00:00.000Z \x1b[2mlevel=\x1b[0m\x1b[33mwarn\x1b[0m \x1b[2mevent=\x1b[0mboard.joined \x1b[2mboard=\x1b[0mdemo",
  );
});
