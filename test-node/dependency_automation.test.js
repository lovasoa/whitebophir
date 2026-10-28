const assert = require("node:assert/strict");
const test = require("node:test");
const mergeDependabot = require("../.github/scripts/merge-dependabot.cjs");

/** @param {any} [overrides] */
function scenario(overrides = {}) {
  const run = {
    conclusion: "success",
    event: "pull_request",
    head_repository: { full_name: "lovasoa/whitebophir" },
    actor: { login: "dependabot[bot]" },
    head_branch: "dependabot/npm-update",
    head_sha: "tested-head",
  };
  const pull = {
    number: 123,
    state: "open",
    merged_at: null,
    draft: false,
    user: { login: "dependabot[bot]" },
    head: {
      repo: { full_name: "lovasoa/whitebophir" },
      sha: "tested-head",
    },
  };
  /** @type {any[]} */
  const merges = [];
  /** @type {any[]} */
  const dispatches = [];
  const options = {
    context: {
      repo: { owner: "lovasoa", repo: "whitebophir" },
      payload: { workflow_run: { ...run, ...overrides.run } },
    },
    github: {
      rest: {
        pulls: {
          list: async (/** @type {any} */ query) => {
            assert.equal(query.base, "master");
            assert.equal(query.head, "lovasoa:dependabot/npm-update");
            return { data: [{ ...pull, ...overrides.pull }] };
          },
          merge: async (/** @type {any} */ request) => {
            merges.push(request);
            if (overrides.mergeError) throw new Error("Head changed");
            return { data: { merged: true } };
          },
        },
        actions: {
          createWorkflowDispatch: async (/** @type {any} */ request) => {
            dispatches.push(request);
          },
        },
      },
    },
  };
  return { options, merges, dispatches };
}

test("successful dependency CI merges the tested head and tests master", async () => {
  const { options, merges, dispatches } = scenario();
  await mergeDependabot(options);
  assert.deepEqual(merges, [
    {
      owner: "lovasoa",
      repo: "whitebophir",
      pull_number: 123,
      sha: "tested-head",
      merge_method: "squash",
    },
  ]);
  assert.deepEqual(dispatches, [
    {
      owner: "lovasoa",
      repo: "whitebophir",
      workflow_id: "CI.yml",
      ref: "master",
    },
  ]);
});

test("failed, unrelated, fork and stale CI cannot merge or deploy", async () => {
  for (const overrides of [
    { run: { conclusion: "failure" } },
    { run: { conclusion: "cancelled" } },
    { run: { event: "push" } },
    { run: { actor: { login: "contributor" } } },
    { run: { head_repository: null } },
    { run: { head_repository: { full_name: "contributor/whitebophir" } } },
    { pull: { user: { login: "contributor" } } },
    {
      pull: {
        head: {
          repo: { full_name: "contributor/whitebophir" },
          sha: "tested-head",
        },
      },
    },
    {
      pull: {
        head: { repo: { full_name: "lovasoa/whitebophir" }, sha: "new-head" },
      },
    },
    { pull: { draft: true } },
    { pull: { state: "closed" } },
  ]) {
    const { options, merges, dispatches } = scenario(overrides);
    await mergeDependabot(options);
    assert.deepEqual(merges, []);
    assert.deepEqual(dispatches, []);
  }
});

test("a head changing during merge cannot start deployment CI", async () => {
  const { options, dispatches } = scenario({ mergeError: true });
  await assert.rejects(mergeDependabot(options), /Head changed/);
  assert.deepEqual(dispatches, []);
});

test("retry after a completed merge can still dispatch master CI", async () => {
  const { options, merges, dispatches } = scenario({
    pull: { state: "closed", merged_at: "2026-10-28T00:00:00Z" },
  });
  await mergeDependabot(options);
  assert.deepEqual(merges, []);
  assert.equal(dispatches.length, 1);
});
