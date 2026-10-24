import assert from "node:assert/strict";
import test from "node:test";
import mergeDependabot from "../.github/scripts/merge-dependabot.cjs";

function fixture() {
  const repository = "lovasoa/whitebophir";
  const run = {
    event: "pull_request",
    conclusion: "success",
    head_sha: "tested-sha",
    head_repository: { full_name: repository },
    pull_requests: [{ number: 123 }],
  };
  const pr = {
    number: 123,
    state: "open",
    draft: false,
    merged: false,
    commits: 1,
    user: { login: "dependabot[bot]", type: "Bot" },
    base: { ref: "master", repo: { full_name: repository } },
    head: { sha: run.head_sha, repo: { full_name: repository } },
  };
  const commits = [
    {
      author: { login: "dependabot[bot]" },
      commit: { verification: { verified: true } },
    },
  ];
  /** @type {any[]} */
  const merges = [];
  /** @type {any[]} */
  const dispatches = [];
  const result = { merged: true, message: "Merged" };
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listCommits: () => {},
        /** @param {any} args */
        merge: async (args) => {
          merges.push(args);
          return { data: result };
        },
      },
      actions: {
        /** @param {any} args */
        createWorkflowDispatch: async (args) => {
          dispatches.push(args);
        },
      },
    },
    paginate: async () => commits,
  };
  const context = {
    repo: { owner: "lovasoa", repo: "whitebophir" },
    payload: { workflow_run: run },
  };
  const core = { warning() {}, info() {} };
  return {
    run,
    pr,
    commits,
    merges,
    dispatches,
    result,
    execute: () => mergeDependabot({ github, context, core }),
  };
}

test("merges verified Dependabot commits at the tested SHA and dispatches master CI", async () => {
  const f = fixture();
  await f.execute();
  assert.deepEqual(f.merges, [
    {
      owner: "lovasoa",
      repo: "whitebophir",
      pull_number: 123,
      sha: "tested-sha",
      merge_method: "merge",
    },
  ]);
  assert.deepEqual(f.dispatches, [
    {
      owner: "lovasoa",
      repo: "whitebophir",
      workflow_id: "CI.yml",
      ref: "master",
    },
  ]);
});

test("rejects failed CI, forks, stale heads, human edits and unverified commits", async () => {
  /** @type {((f: ReturnType<typeof fixture>) => void)[]} */
  const mutations = [
    (f) => {
      f.run.conclusion = "failure";
    },
    (f) => {
      f.run.event = "push";
    },
    (f) => {
      f.run.head_repository.full_name = "someone/fork";
    },
    (f) => {
      f.pr.user.login = "someone";
    },
    (f) => {
      f.pr.head.repo.full_name = "someone/fork";
    },
    (f) => {
      f.pr.head.sha = "untested-sha";
    },
    (f) => {
      f.pr.base.ref = "other";
    },
    (f) => {
      f.pr.draft = true;
    },
    (f) => {
      f.pr.state = "closed";
    },
    (f) => {
      for (const commit of f.commits) commit.author.login = "someone";
    },
    (f) => {
      for (const commit of f.commits)
        commit.commit.verification.verified = false;
    },
    (f) => {
      f.pr.commits = 251;
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await f.execute();
    assert.deepEqual(f.merges, []);
    assert.deepEqual(f.dispatches, []);
  }
});

test("a rejected merge cannot dispatch a release", async () => {
  const f = fixture();
  f.result.merged = false;
  f.result.message = "Head changed";
  await assert.rejects(f.execute(), /Head changed/);
  assert.deepEqual(f.dispatches, []);
});

test("retrying an already merged PR recovers a failed CI dispatch", async () => {
  const f = fixture();
  f.pr.state = "closed";
  f.pr.merged = true;
  await f.execute();
  assert.deepEqual(f.merges, []);
  assert.equal(f.dispatches.length, 1);
});
