# Contributing Guide

## Baseline

- [CI workflow](./.github/workflows/CI.yml).
- this is a classic node project: `npm install`, `npm test`, etc.

## Where To Look

- Main server entrypoint: [server/server.js](./server/server.js)
- Main browser entrypoint: [client-data/board.html](./client-data/board.html)
- Main client runtime: [client-data/js/board.js](./client-data/js/board.js)
- Server config and env vars: [server/configuration.js](./server/configuration.js)
- Socket and real-time flow: [server/sockets.js](./server/sockets.js)
- Board persistence and normalization on load/save: [server/boardData.js](./server/boardData.js)
- Message validation on the server: [server/message_validation.js](./server/message_validation.js)
- Shared message normalization helpers: [client-data/js/message_common.js](./client-data/js/message_common.js)
- Integration tests: [tests/integration.js](./tests/integration.js)
- Node/unit-style tests: [test-node/rate_limits.test.js](./test-node/rate_limits.test.js)
- Browser test runner config: [nightwatch.conf.js](./nightwatch.conf.js)

## Test Commands

Run these before opening a PR:

- Focused Node suite: `node --test test-node/*.test.js`
- Full local suite: `npm test`: This runs the Node tests, then Nightwatch browser tests, then the JWT browser variant.
- Auto-format: `npm run prettier`
  - Rules live in [.prettierrc](./.prettierrc); ignored paths are in [.prettierignore](./.prettierignore).

Notes:

- `npm test` expects Firefox + `geckodriver` via Nightwatch. See [nightwatch.conf.js](./nightwatch.conf.js).
- `npm test` needs an environment that allows local networking and browser/driver startup. Run them unsandboxed.

## Formatting

- There is no separate lint step in CI today. Passing `npm run prettier-check` and `npm test` is the expected bar.
- Keep edits small and consistent with the existing style in server and client files unless you are deliberately refactoring a whole module.

## Change Strategy

- If you touch message shapes or drawing payloads, update both [server/message_validation.js](./server/message_validation.js) and [client-data/js/message_common.js](./client-data/js/message_common.js), then rerun the Node suite.
- If you touch board persistence or replay behavior, read [server/boardData.js](./server/boardData.js) and rerun `node --test test-node/rate_limits.test.js` plus `npm test`.
- If you touch UI tools, start in the relevant file under [client-data/tools](./client-data/tools/) and verify through the Nightwatch integration tests.
