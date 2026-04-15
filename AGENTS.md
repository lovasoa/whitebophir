# contributing guide

## baseline

- CI contract: [checks and order](./.github/workflows/CI.yml).
- Standard flow: `npm install`, `npm test`.

## architecture

- Process boot + routes + socket server: [server startup](./server/server.mjs).
- HTML templating + client config payload: [templating](./server/templating.mjs), [client config](./server/client_configuration.mjs).
- Shared toolbar catalog + versioned tool asset helpers: [tool catalog](./client-data/js/tool_catalog.js), [tool assets](./client-data/js/tool_assets.js).
- Realtime event handlers + broadcast path: [socket handlers](./server/sockets.mjs).
- Socket auth, rate-limit enforcement, payload admission: [socket policy](./server/socket_policy.mjs).
- Canonical inbound payload normalization: [message schema gate](./server/message_validation.mjs).
- In-memory board model + apply rules + disk sync: [board state engine](./server/boardData.mjs).
- Page shell that server-renders the toolbar and loads the module entrypoint for the board runtime: [board document](./client-data/board.html), [board module boot](./client-data/js/board_main.js).
- Client state machine + staged tool boot + send/receive plumbing: [board runtime](./client-data/js/board.js).
- Shared socket transport utilities: [transport helpers](./client-data/js/board_transport.js).
- Shared board-name allowlist + sanitization for landing-page inputs and server routes: [board name helpers](./client-data/js/board_name.js).
- Shared geometry/id/color/text clamps: [message primitives](./client-data/js/message_common.js).
- Tool implementations that mutate SVG/DOM: [tool modules](./client-data/tools/).
- Tool modules now default-export a tool class for dynamic `import()` boot, while legacy named `register*Tool` exports may still exist during migration.

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

- Config/env behavior: [server configuration](./server/configuration.mjs).
- Browser integration coverage: [playwright specs](./playwright/tests).
- Node behavior coverage: [rate-limit tests](./test-node/rate_limits.test.js).
- Browser runner setup: [playwright config](./playwright.config.ts).
- Server-rendered toolbar/icon/cache coverage: [server route tests](./test-node/server_routes.test.js).

## test commands

- Node suite: `node --test test-node/*.test.js`.
- Browser suite: `npx playwright test playwright/tests/<file>.spec.ts`.
- Throughput check: `npm run bench` before/after suspected performance changes.
- CPU + memory profile: `npm run profile` writes `.profiles/benchmark-server.cpuprofile` and `.profiles/benchmark-server.heapprofile`.
- Full gate: `npm test` (Node tests, Playwright, Biome `lint` with warnings treated as failures).
- Auto-format: `npm run format` (Biome `--write --unsafe`).

## notes

- `npm test` needs Chromium (`npx playwright install chromium` when missing).
- `npm test` requires local networking and browser process startup.
- In Playwright specs, assert authoritative socket/app state; avoid sleep-based timing.

## profiling

- Run `npm run profile` to profile `scripts/benchmark-server.mjs`; `.profiles/` is gitignored and keeps local CPU and heap output together.
- CPU: open `.profiles/benchmark-server.cpuprofile` in DevTools Performance and look for hot frames with high self time or repeated stacks in `BoardData.load`, `BoardData.save`, `renderBoardToSVG`, `JSON.parse`, and `JSON.stringify`.
- Memory: open `.profiles/benchmark-server.heapprofile` in DevTools Memory and look for large sampled allocations that survive GC, especially duplicated board objects, large `_children` arrays, and serialization strings.

## formatting

- `npm run lint` runs the full Biome formatter+linter gate and fails on warnings.
- `npm run format` applies Biome safe and unsafe autofixes.
- Keep edits minimal and style-consistent unless doing full-module refactors.

## change strategy

- Message shape changes: update [server schema gate](./server/message_validation.mjs) and [shared message primitives](./client-data/js/message_common.js); rerun Node tests.
- Persistence/replay changes: review [board state engine](./server/boardData.mjs); rerun `node --test test-node/rate_limits.test.js` and `npm test`.
- Tool UX changes: start in [tool modules](./client-data/tools/); verify with Playwright.

## design system

- Reference style: technical minimalism built from the whiteboard shell, not the softer landing-page gradients or dark toast language.
- Shared shell first: tools, HUD chips, presence controls, and lightweight panels should reuse the same base control styling whenever possible instead of introducing parallel card styles.
- Reuse before adding: extend shared tokens/selectors first, and delete superseded styling rules in the same change so one visual behavior maps to one CSS path.
- Grid alignment is mandatory: persistent chrome must snap to the `40px` tool-tile grid and align with the first tool row, even when it lives on the opposite screen edge.
- Stack spacing belongs to the column, not the first tile: use container gaps or sibling spacing so the first tile defines the alignment row cleanly.
- Closed-by-default chrome must stay compact: when a control is always visible, prefer icon-first layouts and counts; avoid permanent labels or padding that consume canvas space without adding meaning.
- One-cell rule for persistent chips: if a control is always on screen, keep it within one tool cell when possible and surface counts as badges or transient expansions rather than widening the base tile.
- Idle status stays hidden: persistent board-state UI should only appear when there is meaningful state to communicate; do not reserve screen space for decorative status shells.
- Narrow-screen rule: HUD and presence UI must never overlap the tool column; on small widths, keep auxiliary chrome to the right of the toolbar and stack vertically before expanding horizontally.
- Core surfaces: default to `#ffffff` and near-whites such as `#f3f4f6`; avoid decorative gradients as a default treatment.
- Borders first: structure components with thin cool-gray borders (`#d9dde3`, stronger `#b8c0cc`) before adding heavier fills or shadows.
- Geometry and type: keep shapes mostly square with very small radii (`2px` controls, `4px` panels) and compact UI text (`13px` primary, `11px`-`12px` secondary); avoid oversized labels.
- Accent color: use a green accent inspired by the current frontpage gradient family (`#ccdfdf` -> `#abc6c6`) for active/highlighted states; semantic warning colors should support meaning, not replace text.
- Motion: keep transitions quiet and mechanical (`120ms`-`180ms`, fade/slide, gentle spinner); avoid playful bounce or constant pulsing for routine states.

## required upkeep

- **If behavior, paths, protocol shape, test commands, or architecture documented here changes, update this file in the same PR.**
