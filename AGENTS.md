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
- Page shell that loads the module entrypoint for the board runtime: [board document](./client-data/board.html), [board module boot](./client-data/js/board_main.js).
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
- CPU + memory profile: `npm run profile` writes `.profiles/benchmark-server.cpuprofile` and `.profiles/benchmark-server.heapprofile`.
- Full gate: `npm test` (Node tests, Playwright, `lint`).
- Auto-format: `npm run format`.

## notes

- `npm test` needs Chromium (`npx playwright install chromium` when missing).
- `npm test` requires local networking and browser process startup.
- In Playwright specs, assert authoritative socket/app state; avoid sleep-based timing.

## profiling

- Run `npm run profile` to profile `scripts/benchmark-server.js`; `.profiles/` is gitignored and keeps local CPU and heap output together.
- CPU: open `.profiles/benchmark-server.cpuprofile` in DevTools Performance and look for hot frames with high self time or repeated stacks in `BoardData.load`, `BoardData.save`, `renderBoardToSVG`, `JSON.parse`, and `JSON.stringify`.
- Memory: open `.profiles/benchmark-server.heapprofile` in DevTools Memory and look for large sampled allocations that survive GC, especially duplicated board objects, large `_children` arrays, and serialization strings.

## formatting

- CI has no separate lint job; `npm run lint` and `npm test` define pass/fail.
- Keep edits minimal and style-consistent unless doing full-module refactors.

## change strategy

- Message shape changes: update [server schema gate](./server/message_validation.js) and [shared message primitives](./client-data/js/message_common.js); rerun Node tests.
- Persistence/replay changes: review [board state engine](./server/boardData.js); rerun `node --test test-node/rate_limits.test.js` and `npm test`.
- Tool UX changes: start in [tool modules](./client-data/tools/); verify with Playwright.

## required upkeep

- **If behavior, paths, protocol shape, test commands, or architecture documented here changes, update this file in the same PR.**
