# WBO architecture

WBO runs as one Node.js process serving a browser application over HTTP and
Socket.IO. The server owns accepted board state and access decisions; the
browser renders SVG and applies local edits optimistically.

## Boundaries

| Area | Responsibility and entry point |
| --- | --- |
| Startup and HTTP | [server.mjs](./server/server.mjs) composes routes, startup configuration, and runtime dependencies. `server/http` owns request handling; `server/routes` owns responses. |
| Access | [board_capabilities.mjs](./server/auth/board_capabilities.mjs) resolves board permissions for both HTTP and sockets. `server/socket` supplies live ban and temporary-moderator state. |
| Socket admission | [socket/index.mjs](./server/socket/index.mjs) wires connection lifecycle. Its sibling modules own replay, rate limits, validation, broadcasts, and moderation. |
| Board state | [data.mjs](./server/board/data.mjs) owns the canonical item index. `session.mjs` orders accepted writes; `message_processing.mjs` applies mutations; `data_persistence.mjs` schedules saves. |
| Storage | [svg_board_store.mjs](./server/persistence/svg_board_store.mjs) loads and writes authoritative SVG files. Scanning and item codecs isolate document structure from tool content. |
| Browser runtime | [board_main.js](./client-data/js/board_main.js) starts staged boot. `app_tools.js` assembles runtime modules; viewport, connection/replay, writes, and presence have separate owners. |
| Drawing tools | [manifest.js](./client-data/tools/manifest.js) owns metadata; [contracts.js](./client-data/tools/contracts.js) owns storage and rendering. Per-tool `index.js` modules own interaction. |

## Opening and editing a board

1. HTTP checks access and streams a board shell containing a stored SVG baseline
   and its sequence. Chrome and boot configuration precede the drawing markup.
2. The browser attaches the baseline and restores the viewport first, allowing
   pan before loading the full runtime and drawing tools.
3. The socket checks access and replays mutations after that baseline. The
   browser enforces sequence order and fetches a fresh baseline if replay cannot
   bridge the gap. Writes depend on successful synchronization.
4. Tools submit edits to the write runtime, which owns optimistic drawing,
   buffering, and rollback. The server applies rate limits, validates the message,
   and checks capabilities before accepting a persistent mutation.
5. A per-board session orders application and replay-log recording. Accepted
   mutations receive sequences and are broadcast to synchronized clients,
   including the sender. Saves later fold state into a new SVG baseline.

Cursors are ephemeral. Pencil coalesces active remote ink on its light overlay
and commits it between gestures. Editing and rollback snapshots flush pending
geometry first; replay still applies every message in order. Rendering policy
belongs to tools, so it never delays mutation sequencing or acknowledgements.

## Why these choices

**SVG is the durable document and the initial rendering.** Serving the same
representation avoids replaying an entire board just to display it. In memory,
the server keeps canonical item summaries for validation and updates. Structural
scans, summaries, and full geometry are separate so opening or saving a dense
Pencil board does not require decoding every point. Legacy JSON is migration
input. Staging files and quarantine handle interrupted saves and unreadable
documents; structural corruption is an error, not an invitation to invent data.

**Ordered mutations bridge snapshots and collaboration.** The replay log covers
edits newer than the SVG baseline. Baselines served over HTTP are temporarily
pinned so saves cannot prematurely remove the history connecting a page to its
socket. Batch application is atomic, and optimistic rollback restores client
state after rejection. These layers solve different consistency problems.

**Shared contracts reduce drift; enforcement stays on the server.** Tools share
metadata, normalization primitives, rate-limit math, and moderation rules with
the server. Browser checks improve interaction; they do not authorize writes.
HTTP and sockets use one permission resolver, with live moderation state read
when capabilities are queried.

**Staged boot protects interaction latency.** The small initial runtime supports
viewport restoration and pan. Full runtime hydration and lazy tool loading add
editing and collaboration afterward. Consolidating these stages would put tool
and network dependencies on the path to the first usable viewport.

## Operational limits

Each process owns its loaded boards, write queues, replay history, presence,
bans, and temporary moderator grants. Run one writer per history directory;
stale-save detection is not coordination for multiple replicas. Horizontal
scaling requires explicit board ownership and shared coordination.

Accepted writes reach memory and connected clients before the scheduled SVG
save. A process crash can lose edits since the last completed save. Replay and
moderation state are process-local and disappear on restart. Back up the history
directory for durable recovery; staging files are not a backup policy.

See [README.md](./README.md) for deployment and [AGENTS.md](./AGENTS.md) for
engineering and validation policy. Keep implementation details with their owner.
