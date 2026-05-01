# Pencil responsiveness performance plan

## Problem statement

The current pencil path mutates the main board SVG on every accepted point.
On dense boards this pushes Chrome through SVG invalidation, paint, layerization,
commit, and hit-test work for a document with tens of thousands of elements.
The [huge trace](/tmp/chrometrace.json) that motivated this plan showed JavaScript pointer handlers as small
relative to browser rendering work: the expensive time was in `Paint`,
`Layerize`, `Commit`, `UpdateLayer`, and `HitTest`.

The goal is to make active pencil drawing responsive on dense boards without
turning the client into a large rendering subsystem. Optimizations should be
small, local where possible, and enforceable by tests that do not depend on
strict wall-clock timing.

## Constraints

- Keep the board architecture SVG-backed. Do not start a large rewrite.
- Keep pencil-specific logic in `client-data/tools/pencil/`.
- Centralize cross-tool interaction side effects so tools cannot leak global state after cancellation, rejection, socket disconnect, or tool switches.
- Avoid adding a large general-purpose scheduler. Prefer narrow leases, RAF batching, and small helpers.
- Preserve optimistic write semantics and existing socket protocol
- Preserve eraser and hand hit-testing behavior outside active pencil strokes.

## Browser model summary

Chrome RenderingNG is organized around a document lifecycle: style, layout, pre-paint, paint, compositing/layerization, commit, and raster/composite.
Updates that are only compositor transforms can skip much of that work, but SVG geometry mutations cannot. They invalidate paint and geometry data.

The local Chromium geometry notes describe property trees for transforms, effects, clips, and scrolls, and emphasize caching geometry mapping and hit-test data when state does not change. The pencil path is currently the opposite case: every point changes SVG path geometry in the large board tree.

## Implementation phases

### Phase 0: Reproducible baseline (done)

Before changes, keep one reproducible browser scenario:

- Load a dense SVG board with thousands of persisted items.
- Select pencil.
- Draw one 80-120 point stroke through the normal tool path.
- Collect DevTools trace manually for diagnosis when needed.

Do not put hard duration budgets into CI. Use the trace for local diagnosis and use Playwright for structural invariants.

The baseline is in /tmp/chrometrace.json

### Phase 1: Centralized interaction leases

Add lease-based interaction state to the runtime before adding more tool-side optimizations.

Recommended owner:

- Put the lease manager in `InteractionModule` in
  `client-data/js/board_full_runtime_modules.js`.
- Keep raw DOM toggles in `BoardDomRuntimeActions` in
  `client-data/js/board_runtime_core.js` if the toggle is board-DOM-specific.
- Expose owner-scoped methods through `createToolRuntimeModules()` in
  `client-data/js/board_tool_registry_module.js`, closing over the tool name
  from `createToolBootContext(toolName)`.

The lease API should be small:

```js
const lease = runtime.interaction.acquire({
  suppressDrawingAreaHitTesting: true,
  suppressOwnCursor: true,
});
lease.release();
```

Properties:

- `release()` is idempotent.
- The interaction module stores leases by generated token and owner tool name.
- The tool runtime facade does not let a tool claim another owner's lease.
- `ToolRegistryModule.replaceCurrentTool()` calls
  `Tools.interaction.releaseOwner(oldTool.name)` after `oldTool.onquit(...)`.
- `ReplayModule.beginAuthoritativeResync()` and socket-disconnect cleanup also
  release active leases, either through mounted tool hooks or an explicit
  runtime cleanup.

DOM behavior:

- Use a class, not inline style restoration, for drawing-area hit-testing suppression.
- CSS owns the actual rule:

```css
#drawingArea.hit-test-suppressed {
  pointer-events: none;
}
```

Why this module:

- `InteractionModule` already owns pointer/cursor visibility flags.
- Tool registry owns tool lifecycle, so it can guarantee cleanup on tool
  switches.
- The board DOM module owns actual DOM nodes and can keep DOM writes narrow.

Acceptance criteria:

- Pencil can acquire hit-test and cursor suppression on press and release them
  on normal release.
- Switching from pencil to any other tool clears the drawing-area suppression.
- Socket disconnect, mutation rejection, clear/delete of the active line, and
  touch cancellation clear suppression.
- Eraser and hand still see normal hit targets when they are active.

### Phase 2: Pointer-events quick win

Use the interaction lease during active local pencil strokes:

- Acquire `suppressDrawingAreaHitTesting` on pencil press.
- Release it from the same paths that currently call `stopLine()` or
  `abortLine()`.
- Do not put pointer-events rules in `pencil.css` except for pencil-owned
  overlay elements.

Expected impact:

- Reduces browser hit-test work while pencil is active.
- Does not solve paint/layerize by itself.
- Small code footprint once the lease manager exists.

Risk:

- Low, if lease cleanup is tested through tool switch, disconnect, and cancel.

### Phase 3: Cursor and presence rendering policy

#### Cursor policy

Do not render the local cursor marker while a pencil stroke is in progress.

Implementation:

- The pencil lease also requests `suppressOwnCursor`.
- The cursor tool checks `runtime.interaction.isOwnCursorSuppressed()` before
  mutating `#cursor-me`.
- If needed later, add `suppressRemoteCursors`, but start with own cursor only.

Reason:

- The trace showed repeated `circle#cursor-me` layout invalidations during the
  drawing sequence.
- The visible pencil stroke itself is the pointer feedback during drawing.

Acceptance criteria:

- During active pencil stroke, local cursor DOM does not update.
- After release/cancel, cursor rendering resumes automatically.
- No direct `showMyCursor = false` mutations from the pencil tool; suppression
  must be lease-scoped.

#### Presence policy

Separate presence data updates from DOM rendering.

Current problem:

- `updateConnectedUsersFromActivity()` can call `renderConnectedUsers()` for
  each activity update.
- The activity pulse is already CSS animation, but JS restarts and ends it by
  mutating rows and timeout state on activity.

Recommended architecture:

- Keep user activity data in `PresenceModule`.
- Add `schedulePresenceRender(reason)` that coalesces DOM rendering with
  `requestAnimationFrame`.
- If the connected-users panel is closed, do not render row activity changes.
  Only update data and the toggle badge when the user count changes.
- If the panel is open, patch only rows whose display state changed when
  possible. Avoid sorting/rebuilding the whole list for activity-only updates.

Activity animation:

- Treat activity as a state window, not one DOM restart per message.
- On first activity after idle, set `user.activeUntil = now + ttl` and mark the
  row active.
- On further activity while active, extend `activeUntil` but do not rerender or
  restart the animation.
- CSS can run a quiet infinite pulse while the row is active:

```css
.connected-user-color.active {
  animation: connected-user-pulse 700ms ease-out infinite;
}
```

- JS owns the guarantee that activity ends: one timeout per active user checks
  `activeUntil` and removes the active class after the quiet period.
- `clearConnectedUsers()` and row removal must clear timeout ids.

Acceptance criteria:

- Continuous activity can keep the pulse active, but when activity stops the
  pulse must end without requiring another render event.
- Hidden panels do not do per-message row DOM work.
- Toggle label/badge remains correct.

Risk:

- Low to medium. Presence is user-visible but not protocol-critical.
- Keep this change separate from pencil rendering so regressions are easy to
  isolate.

### Phase 4: Main local rendering fix

Render the active local stroke outside the main board SVG while keeping the
canonical optimistic SVG path hidden and up to date.

This is the lowest-risk main fix because it preserves the existing message
shape, optimistic journal behavior, and persistence model.

#### Key idea

During an active local pencil stroke:

- The real board path still exists under `#drawingArea`.
- The real board path still receives `d` updates, preserving current optimistic
  rollback snapshots.
- The real board path is hidden while active, so its per-point geometry updates
  should not repaint the large SVG scene.
- A tiny fixed overlay renders the visible active stroke.
- On release, the overlay is cleared and the real path is revealed once.

This avoids the biggest risk in a pure overlay design: if local appends never
update the canonical DOM path, existing per-append optimistic rollback snapshots
become incorrect after release.

#### DOM structure

Create a pencil-owned overlay lazily:

```html
<svg class="wbo-pencil-live-overlay" aria-hidden="true">
  <path class="wbo-pencil-live-path"></path>
</svg>
```

CSS:

```css
.wbo-pencil-live-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 20; /* above the board, below the menu and HUD*/
  overflow: hidden;
}
```

The menu is `z-index: 60` and the HUD is `z-index: 35`, so `z-index: 20` keeps
the stroke above the board but below chrome.

#### Coordinate model

Keep the overlay path in board coordinates and transform it into viewport
coordinates:

```text
screen = board * scale - document scroll
```

Use one SVG transform on the overlay path:

```text
translate(-scrollLeft, -scrollTop) scale(currentScale)
```

This preserves the current board zoom behavior, including scaled stroke width,
without converting every point to screen coordinates.

During an active stroke, the overlay renderer should refresh the transform on:

- point append RAF flush,
- `scroll`,
- `resize`,
- scale changes if an API hook exists or if the transform is recomputed on each
  RAF while active.

Pencil drawing owns app gestures, so scroll/scale changes during a stroke should
be rare; the refresh path is mostly defensive.

#### Module split

Add one small tool-local helper class inside the existing pencil index.js

Responsibilities:

- Create/remove/reuse the overlay SVG and path.
- Copy stroke style from the active line or pencil message.
- Accept latest `pathData`.
- Schedule one RAF flush.
- On flush, set overlay path `d`, stroke attrs, opacity, and transform.
- Clear overlay on release/cancel/rejection/disconnect.

Keep smoothing and canonical path data in existing pencil code:

- `wboPencilPoint()` remains the single smoothing function.
- `state.pathDataCache[line.id]` remains the canonical local path-data array.
- The hidden board path and overlay path both render from that same data.

#### Active board path behavior

Change `.wbo-pencil-drawing` from pointer-only to hidden active geometry:

```css
#drawingArea path.wbo-pencil-drawing {
  display: none;
  pointer-events: none;
}
```

`display: none` is intentional: the active path stays available for optimistic
rollback and final reveal, but should not participate in visible SVG paint while
points are appended.

On release:

- Call `move()` once as today to include the release point.
- Clear the overlay.
- Remove `wbo-pencil-drawing`, revealing the already-updated final SVG path.
- Release interaction leases.

On abort/cancel/rejection/disconnect:

- Clear overlay.
- Remove or restore the real path through existing abort/rollback paths.
- Release interaction leases.

### Phase 5: RAF coalescing

After the overlay exists, avoid redundant overlay updates:

- Pencil append still updates canonical hidden path immediately.
- Overlay renderer flushes at most once per animation frame.
- If multiple points arrive before the frame, only the latest path data is
  rendered in the overlay.

Do not coalesce network writes in this phase. Keep behavior and rate-limit
semantics unchanged.

Expected impact:

- Medium.
- Small code footprint because it belongs inside `live_overlay.js`.

### Phase 6: Protocol batching: do not do it now

If remote peers remain slow after local overlay work, batch pencil appends.

Scope:

- Add a live pencil batch shape that can carry multiple child points.
- Reuse existing batch concepts where possible.
- Update server validation, board apply logic, replay, optimistic invalidation,
  and tests.

Why later:

- It touches protocol shape and hot server validation paths.
- It affects persistence/replay correctness.
- It is valuable for multi-user boards, but not required to fix local input
  responsiveness.

Expected impact:

- High for remote peers and server fan-out.

Risk:

- Medium-high.

### Phase 7: Remote active-stroke overlay, only after batching: do not do it now

If peers still suffer from visible path mutation while receiving someone else's
stroke, add a remote overlay concept:

- Render remote active pencil strokes in overlays.
- Commit to board SVG on stroke-end or idle timeout.
- Requires an explicit or inferred stroke lifecycle.

Risk:

- High without a clean stroke-end protocol.
- Do not do this before local overlay and batching prove insufficient.

## Regression testing strategy

The tests should catch the slow architecture being reintroduced without relying
on exact milliseconds. Use three layers.

### 1. Unit-level lease cleanup tests

Add Node/browserless tests around runtime/tool behavior where possible:

- Pencil press acquires an interaction lease.
- Release, cancel, mutation rejection, socket disconnect, and tool switch
  release the lease.
- Releasing twice is safe.
- Tool A cannot release Tool B's lease through the tool runtime facade.

These tests are deterministic and cheap.

### 2. Playwright structural performance invariant

Add one Playwright spec for large-board pencil drawing.

Setup:

- Write a board with a few thousand simple SVG items using `server.writeBoard`.
  It does not need the full production maximum; the test checks architecture,
  not absolute throughput.
- Navigate to the board, wait for ready/socket writable, select pencil.
- Install a `MutationObserver` on `#drawingArea` before drawing.
- Draw an active pencil stroke through the normal tool listener path.

Assertions while the stroke is active:

- The active board path has `wbo-pencil-drawing`.
- `getComputedStyle(activePath).display === "none"`.
- The pencil live overlay exists and contains a path with non-empty `d`.
- `#drawingArea[data-wbo-hit-test-suppressed]` is present.
- The local cursor marker is not updated during the active stroke.
- Every observed `d` mutation on `#drawingArea path` during the active stroke
  belonged to a hidden active pencil path. No visible board path receives
  per-point `d` updates.

Assertions after release:

- The overlay is empty or removed.
- The final board path is visible.
- Drawing-area hit-test suppression is cleared.
- Cursor suppression is cleared.
- The final path persists as today.

This fails when the known slow pattern returns: visible main-board path mutation
on each pencil point.

### 3. Optional relative browser-health smoke

Use Playwright's `page.evaluate()` to run a small in-page metric collector during
the scripted stroke:

- `PerformanceObserver` for `longtask` entries when available.
- RAF tick count and max RAF gap as diagnostic attachments, not primary strict
  pass/fail numbers.
- Mutation counters from the structural invariant as the primary pass/fail
  signal.

If a relative assertion is desired, compare empty-board and large-board runs in
the same test process and assert the large-board stroke does not produce many
more long tasks than the empty-board stroke. Keep this threshold generous and
secondary; the deterministic mutation invariant should carry the test.

Avoid default CI assertions like "stroke must finish in < N ms". Shared CI
hardware makes that flaky.

### 4. Local deep profiling path

Keep Chrome/Playwright tracing as a manual diagnostic, not a CI gate:

- Playwright can evaluate browser-side scripts with `page.evaluate()`.
- Playwright tracing captures browser operations and network activity, useful
  for debugging failures.
- Chromium-only CDP sessions are available through
  `browser.newBrowserCDPSession()` if a future diagnostic script needs raw
  Chrome performance traces.

Do not parse full DevTools traces in normal CI unless the lightweight tests miss
real regressions.

## Suggested file changes by phase

Phase 1:

- `client-data/js/board_full_runtime_modules.js`
- `client-data/js/board_runtime_core.js`
- `client-data/js/board_tool_registry_module.js`
- `types/app-runtime.d.ts`
- `client-data/board.css`
- targeted Node tests

Phase 2:

- `client-data/tools/pencil/index.js`
- pencil-specific cleanup tests

Phase 3:

- `client-data/tools/cursor/index.js`
- `client-data/js/board_presence_module.js`
- `client-data/board.css`
- presence/cursor tests

Phase 4:

- `client-data/tools/pencil/live_overlay.js`
- `client-data/tools/pencil/index.js`
- `client-data/tools/pencil/pencil.css`
- Playwright large-board structural performance spec

Phase 5:

- `client-data/tools/pencil/live_overlay.js`

Phase 6+:

- only after measurement justifies protocol changes

## Rollout order

1. Add interaction leases and cleanup tests.
2. Use the lease for pencil hit-test suppression and own-cursor suppression.
3. Make presence rendering coalesced and idle-safe.
4. Add the pencil live overlay with hidden canonical path.
5. Add Playwright structural performance test.
6. Measure local trace again on the same dense board.
7. Consider protocol batching only if remote-peer traces still show repeated
   large-SVG paint/layerize during incoming pencil strokes.

## Source notes

- Chrome RenderingNG architecture:
  https://developer.chrome.com/docs/chromium/renderingng-architecture
- Local Chromium geometry notes:
  `/home/ophir/Downloads/Web page geometries.md`
- Playwright `page.evaluate()` runs code in the browser page environment and can
  return results to the test:
  https://playwright.dev/docs/evaluating
- Playwright tracing is useful for debugging but should generally be configured
  through Playwright Test rather than used as a normal assertion mechanism:
  https://playwright.dev/docs/api/class-tracing
- Playwright Chromium CDP sessions are available but Chromium-only:
  https://playwright.dev/docs/api/class-browser
