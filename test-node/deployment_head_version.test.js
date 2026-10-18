import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

test("GitHub stamps and backs up the head snippet without remote stdin", {
  skip: process.platform === "win32",
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wbo-release-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const snippet = path.join(directory, "head.html");
  const original =
    '<script>sdk.init({version: "old", sessionSampleRate:20})</script>';
  fs.writeFileSync(snippet, original);
  fs.writeFileSync(
    path.join(directory, "ssh"),
    `#!/bin/sh
test "$1" = test-remote && test "$2" = -- || exit 1
case "$3" in
  "run --no-tty wbo "*) command=\${3#run --no-tty wbo } ;;
  *) exit 1 ;;
esac
exec sh -c "$command" </dev/null
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    SSH_REMOTE: "test-remote",
    APP_NAME: "wbo",
    GITHUB_REF_NAME: `v${packageJson.version}`,
    WBO_HTML_HEAD_SNIPPET_PATH: snippet,
  };
  const run = () =>
    spawnSync("sh", ["bin/ci-pre-deploy"], { env, encoding: "utf8" });
  assert.equal(run().status, 0);
  const updated = original.replace(
    'version: "old"',
    `version: "${packageJson.version}"`,
  );
  assert.equal(fs.readFileSync(snippet, "utf8"), updated);
  const backup = `${snippet}.before-v${packageJson.version}`;
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  env.GITHUB_REF_NAME = "v0.0.0";
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(snippet, "utf8"), updated);
  env.GITHUB_REF_NAME = `v${packageJson.version}`;
  const ambiguous = 'version:"one"; version:"two"';
  fs.writeFileSync(snippet, ambiguous);
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(snippet, "utf8"), ambiguous);
});
