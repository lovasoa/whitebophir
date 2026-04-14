# contributing guide

## baseline

- CI contract: [checks and order](./.github/workflows/CI.yml).
- Standard flow: `npm install`, `npm test`.

## architecture

- Process boot + routes + socket server: [server startup](./server/server.js).
- Realtime event handlers + broadcast path: [socket handlers](./server/sockets.js).
- Socket auth, rate-limit enforcement, payload admission: [socket policy](./server/socket_policy.js).
- Canonical inbound payload normalization: [message schema gate](./server/message_validation.js).
- In-memory board model + apply rules + disk sync: [board state engine](./server/boardData.js).
- Page shell that loads runtime bundles: [board document](./client-data/board.html).
- Client state machine + send/receive plumbing: [board runtime](./client-data/js/board.js).
- Shared socket transport utilities: [transport helpers](./client-data/js/board_transport.js).
- Shared geometry/id/color/text clamps: [message primitives](./client-data/js/message_common.js).
- Tool implementations that mutate SVG/DOM: [tool modules](./client-data/tools/).

## message lifecycle

- A tool builds payload data from pointer/input handlers and calls `Tools.drawAndSend` or `Tools.send` (tool modules + runtime).
- `Tools.drawAndSend` renders locally first with `tool.draw(data, true)`.
- `Tools.send` clones payload, stamps `tool`, runs hooks, wraps socket envelope `{ board, data }`.
- `Tools.sendBufferedWrite` emits immediately with `socket.emit("broadcast", message)` or appends to `Tools.bufferedWrites`; `Tools.scheduleBufferedWriteFlush` and `Tools.flushBufferedWrites` drain later.
- Server receives `socket.on("broadcast", ...)` and runs board access + rate-limit checks.
- Server calls `normalizeBroadcastData`, which calls `normalizeIncomingMessage`; rejects include explicit reasons.
- Accepted payload is cloned for storage, then passed through `handleMessage` / `saveHistory` to `board.processMessage(...)`.
- Server relays normalized payload to peers with `socket.broadcast.to(boardName).emit("broadcast", normalizedData)`.
- Client `socket.on("broadcast", msg)` calls `handleMessage(msg)`; child batches use `BoardMessages.hasChildMessages` + `normalizeChildMessage`.
- `messageForTool` resolves `Tools.list[message.tool]` and calls `tool.draw(message, false)`; tool code mutates SVG/DOM.

## where to look by concern

- Config/env behavior: [server configuration](./server/configuration.js).
- Browser integration coverage: [playwright specs](./playwright/tests).
- Node behavior coverage: [rate-limit tests](./test-node/rate_limits.test.js).
- Browser runner setup: [playwright config](./playwright.config.ts).

## test commands

- Node suite: `node --test test-node/*.test.js`.
- Browser suite: `npx playwright test playwright/tests/<file>.spec.ts`.
- Throughput check: `npm run bench` before/after suspected performance changes.
- Full gate: `npm test` (Node tests, Playwright, `prettier-check`).
- Auto-format: `npm run prettier` (rules: [prettierrc](./.prettierrc), ignores: [prettierignore](./.prettierignore)).

## notes

- `npm test` needs Chromium (`npx playwright install chromium` when missing).
- `npm test` requires local networking and browser process startup.
- In Playwright specs, assert authoritative socket/app state; avoid sleep-based timing.

## formatting

- CI has no separate linter; `npm run prettier-check` + `npm test` define pass/fail.
- Keep edits minimal and style-consistent unless doing full-module refactors.

## change strategy

- Message shape changes: update [server schema gate](./server/message_validation.js) and [shared message primitives](./client-data/js/message_common.js); rerun Node tests.
- Persistence/replay changes: review [board state engine](./server/boardData.js); rerun `node --test test-node/rate_limits.test.js` and `npm test`.
- Tool UX changes: start in [tool modules](./client-data/tools/); verify with Playwright.

## required upkeep

- **If behavior, paths, protocol shape, test commands, or architecture documented here changes, update this file in the same PR.**
