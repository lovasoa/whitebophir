import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

test("GitHub confirms the head version through Dokku's SSH parser without stdin", {
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
    `#!/bin/bash
test "$1" = -- && test "$2" = test-remote || exit 1
test "\${WBO_TEST_SKIP_COMMAND:-}" != 1 || exit 0
# Match Dokku's SSH_ORIGINAL_COMMAND parsing, including echo's -e handling.
readarray -t args < <(printf '%s' "$3" | xargs -n 1)
test "\${args[0]}" = run && test "\${args[1]}" = --no-tty && test "\${args[2]}" = wbo || exit 1
exec "\${args[@]:3}" </dev/null
`,
    { mode: 0o755 },
  );
  /** @type {NodeJS.ProcessEnv} */
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
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(
    first.stdout.trim(),
    `Deployment head ready: ${packageJson.version}`,
  );
  const updated = original.replace(
    'version: "old"',
    `version: "${packageJson.version}"`,
  );
  assert.equal(fs.readFileSync(snippet, "utf8"), updated);
  const backup = `${snippet}.before-v${packageJson.version}`;
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  env.WBO_TEST_SKIP_COMMAND = "1";
  assert.notEqual(
    run().status,
    0,
    "A silent remote no-op must fail deployment",
  );
  delete env.WBO_TEST_SKIP_COMMAND;
  env.GITHUB_REF_NAME = "v0.0.0";
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(snippet, "utf8"), updated);
  env.GITHUB_REF_NAME = `v${packageJson.version}`;
  const ambiguous = 'version:"one"; version:"two"';
  fs.writeFileSync(snippet, ambiguous);
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(snippet, "utf8"), ambiguous);
});
