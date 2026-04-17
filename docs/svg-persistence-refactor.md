### Summary

Refactor board persistence and sync so that:

- boards are stored on disk as SVG
- `/boards/:name` streams an authoritative inline SVG baseline before board JS boots
- `/boards/:name.svg` serves the same authoritative board state with a short cache TTL
- the server keeps only minimal per-item summaries in memory, not a full board object or SVG DOM
- accepted persistent mutations are appended to a per-board log with contiguous `seq`
- persistence rewrites SVG by streaming the previous stored SVG and applying queued mutations
- optimistic local rendering remains

The main correctness requirement is: a client must never render an invalid board, even if persistence completes between baseline fetch and replay start.

### Non-goals

- backward compatibility with old deployed socket clients
- immediate deletion of all legacy code
- changing Pencil smoothing behavior

### Required compatibility

- optimistic local rendering stays
- existing `.json` boards still load
- first read remains `try .svg -> else legacy .json`
- all legacy JSON support lives behind one isolated adapter

## Core design

### State model

Client state is split into:

- `authoritative`: last contiguous server-confirmed persistent state
- `speculative`: optimistic local persistent writes not yet confirmed
- `ephemeral`: cursors, presence, selection chrome, text input UI

Visible board = authoritative + speculative + ephemeral.

“Authoritative” on the client means “applied through contiguous `seq`”.

### Required invariants

- Persisted-state invariant: stored SVG at root `data-wbo-seq=P` represents exactly the authoritative board after all accepted persistent mutations with `seq <= P`.
- Replay invariant: baseline at `B` plus contiguous replay of all mutations with `B < seq <= L` equals authoritative board state at `L`.
- Gap invariant: the client never applies a persistent mutation unless `seq === authoritativeSeq + 1`.
- Retention invariant: `max(cache TTL) + max(reconnect delay) <= MutationLog retention window`.
- Atomic persistence invariant: readers see either the old full SVG or the new full SVG, never a partial rewrite.
- Paint-order invariant: child order inside persisted `#drawingArea` is authoritative z-order.

The server still keeps `O(items)` state in memory, but only as minimal per-item summaries needed for validation and rewrite planning.

## Runtime DOM contract

The served baseline must match the current client runtime contract. Before JS boots, the board DOM must contain:

- `svg#canvas`
- `defs#defs`
- `g#drawingArea`
- `g#cursors`

Rules:

- all persisted drawable items live under `#drawingArea`
- `#cursors` is always empty in a persisted baseline and is reserved for ephemeral presence UI
- tools continue to append persisted items into `#drawingArea` and presence UI into `#cursors`

This wrapper structure is part of the baseline contract, not an implementation detail.

## Stored SVG vs served baseline

To avoid storing Pencil-heavy boards twice, the stored SVG and the served baseline are allowed to be different serializations of the same authoritative board state.

- Stored SVG: compact, machine-readable, rewrite-friendly board source of truth.
- Served baseline: browser-renderable SVG that satisfies the runtime DOM contract above.

This is required because most boards are Pencil-heavy, and storing both a visible smoothed path and raw point metadata in the served baseline would inflate bytes and parse cost too much.

Decision:

- the stored SVG must not duplicate Pencil geometry
- server-side baseline streaming may render compact stored Pencil items into visible smoothed paths on the fly
- client-side and server-side smoothing must share the same algorithm so optimistic rendering and served baselines match visually

## Persistent mutation schema

The schema is intentionally tightened to the current engine’s real behavior.

```ts
type BoardName = string;
type ItemId = string;
type BoardSeq = number;
type ClientMutationId = string;
type PaintOrder = number;

type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type ShapeCreate =
  | {
      tool: "Straight line";
      type: "line";
      id: ItemId;
      x: number;
      y: number;
      x2: number;
      y2: number;
      color: string;
      size: number;
      opacity?: number;
    }
  | {
      tool: "Rectangle" | "Ellipse";
      type: "rect" | "ellipse";
      id: ItemId;
      x: number;
      y: number;
      x2: number;
      y2: number;
      color: string;
      size: number;
      opacity?: number;
    };

type ShapeUpdate =
  | {
      tool: "Straight line";
      type: "update";
      id: ItemId;
      x2: number;
      y2: number;
    }
  | {
      tool: "Rectangle" | "Ellipse";
      type: "update";
      id: ItemId;
      x: number;
      y: number;
      x2: number;
      y2: number;
    };

type PencilCreate = {
  tool: "Pencil";
  type: "line";
  id: ItemId;
  color: string;
  size: number;
  opacity?: number;
};

type PencilChild = {
  tool: "Pencil";
  type: "child";
  parent: ItemId;
  x: number;
  y: number;
};

type TextCreate = {
  tool: "Text";
  type: "new";
  id: ItemId;
  x: number;
  y: number;
  color: string;
  size: number;
  opacity?: number;
};

type TextUpdate = {
  tool: "Text";
  type: "update";
  id: ItemId;
  txt: string;
};

type TransformUpdate = {
  tool: "Hand";
  type: "update";
  id: ItemId;
  transform: Transform;
};

type CopyMutation = {
  tool: "Hand";
  type: "copy";
  id: ItemId;
  newid: ItemId;
};

type DeleteMutation = {
  tool: "Eraser";
  type: "delete";
  id: ItemId;
};

type ClearMutation = {
  tool: "Clear";
  type: "clear";
};

type HandBatchChild =
  | TransformUpdate
  | CopyMutation
  | DeleteMutation;

type HandBatch = {
  tool: "Hand";
  _children: HandBatchChild[];
};

type PersistentMutation =
  | ShapeCreate
  | ShapeUpdate
  | PencilCreate
  | PencilChild
  | TextCreate
  | TextUpdate
  | TransformUpdate
  | CopyMutation
  | DeleteMutation
  | ClearMutation
  | HandBatch;
```

Important decisions:

- Shape updates are limited to current `TOOL_UPDATE_FIELDS`. There is no `color`/`size`/`opacity` update path for shape updates.
- `HandBatch` has no `type` discriminator. Dispatch must stay `_children`-first.
- `PencilChild` includes `tool: "Pencil"` in the typed protocol. This is a deliberate protocol change; current persisted child payloads strip `tool`, `type`, and `parent`.
- `CopyMutation` is explicitly tightened to `tool: "Hand"`. The current engine is effectively tool-agnostic for copy handling.

## Sync protocol

```ts
interface MutationEnvelope {
  board: BoardName;
  seq: BoardSeq;
  acceptedAtMs: number;
  mutation: PersistentMutation;
  clientMutationId?: ClientMutationId;
}

interface SyncRequest {
  baselineSeq: BoardSeq;
}

interface SyncReplayStart {
  type: "sync_replay_start";
  fromExclusiveSeq: BoardSeq;
  toInclusiveSeq: BoardSeq;
}

interface SyncReplayEnd {
  type: "sync_replay_end";
  toInclusiveSeq: BoardSeq;
}

interface ResyncRequired {
  type: "resync_required";
  latestSeq: BoardSeq;
  minReplayableSeq: BoardSeq;
}

interface MutationRejected {
  type: "mutation_rejected";
  clientMutationId: ClientMutationId;
  reason: string;
}
```

Rules:

- Empty replay is explicit: when `baselineSeq === latestSeq`, the server still emits `sync_replay_start` followed by `sync_replay_end` with the same `toInclusiveSeq`.
- `MutationRejected` applies only to client-initiated mutations and therefore only when `clientMutationId` exists.
- `clientMutationId` is a correlation token only. It is not an idempotency key and provides no server-side retry dedup.
- Authoritative corrections are never carried on `mutation_rejected`. If rejecting a client mutation requires an authoritative correction, that correction must be represented as one or more normal sequenced `MutationEnvelope`s, appended to `MutationLog`, persisted, and replayed to every client.

## Core components

### BoardSession

Per-board mutation admission is serialized through a board-local async queue or mutex.

The serialized critical section is:

1. hydrate missing summaries
2. validate mutation against current authoritative summaries
3. assign next contiguous `seq`
4. append to `MutationLog`
5. update `AdmissionIndex`
6. emit replay/broadcast events

No mutation may validate or assign `seq` outside this queue.

```ts
interface BoardSessionState {
  board: BoardName;
  latestSeq: BoardSeq;
  persistedSeq: BoardSeq;
  flushScheduled: boolean;
  flushInFlight: boolean;
}

interface BoardSession {
  state(): BoardSessionState;
  acceptPersistentMutation(
    socketId: string,
    mutation: PersistentMutation,
    clientMutationId: ClientMutationId | undefined,
    nowMs: number,
  ): Promise<
    | {
        ok: true;
        accepted: MutationEnvelope;
        followup?: MutationEnvelope[];
      }
    | {
        ok: false;
        reason: string;
        rejected?: MutationRejected;
        followup?: MutationEnvelope[];
      }
  >;
}
```

`followup` exists for server-generated authoritative corrections. It is valid on both success and rejection paths. If `clientMutationId` is absent, rejection is still reported through `{ ok: false, reason }`; only the client-facing `MutationRejected` payload is omitted.

### AdmissionIndex

`AdmissionIndex` must store enough geometry to reproduce current accept/reject behavior.

```ts
type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

interface ShapeSummary {
  id: ItemId;
  tool: "Straight line" | "Rectangle" | "Ellipse";
  paintOrder: PaintOrder;
  x: number;
  y: number;
  x2: number;
  y2: number;
  transform?: Transform;
  localBounds: Bounds | null;
}

interface PencilSummary {
  id: ItemId;
  tool: "Pencil";
  paintOrder: PaintOrder;
  childCount: number;
  points: Array<{ x: number; y: number }>;
  transform?: Transform;
  localBounds: Bounds | null;
}

interface TextSummary {
  id: ItemId;
  tool: "Text";
  paintOrder: PaintOrder;
  x: number;
  y: number;
  size: number;
  txt: string;
  transform?: Transform;
  localBounds: Bounds | null;
}

type ItemSummary = ShapeSummary | PencilSummary | TextSummary;

interface AdmissionIndex {
  get(id: ItemId): ItemSummary | undefined;
  ensureLoaded(ids: Iterable<ItemId>): Promise<void>;
  canApplyLoaded(mutation: PersistentMutation): { ok: true } | { ok: false; reason: string };
  applyAccepted(mutation: PersistentMutation, seq: BoardSeq): void;
}
```

Notes:

- `Text/update` needs `x`, `y`, `size`, `txt`, and bounds, not just `textLength`.
- `Pencil` needs raw points or equivalent growth-capable geometry to reproduce transform-then-grow checks.
- `canApplyLoaded` is synchronous only after `ensureLoaded`; the async boundary lives at `BoardSession`.
- `paintOrder` is part of authoritative state.

### MutationLog

```ts
interface MutationLog {
  latestSeq(): BoardSeq;
  minReplayableSeq(): BoardSeq;
  append(envelope: Omit<MutationEnvelope, "seq">): MutationEnvelope;
  readRange(fromExclusiveSeq: BoardSeq, toInclusiveSeq: BoardSeq): MutationEnvelope[];
  markPersisted(persistedSeq: BoardSeq): void;
  trimBefore(seqInclusiveFloor: BoardSeq): void;
}
```

### SvgBoardStore

The store is stream-first. Callers do not receive file paths.

```ts
interface SvgBaselineHeader {
  board: BoardName;
  seq: BoardSeq;
  readonly: boolean;
}

interface SvgBoardStore {
  readBaselineHeader(board: BoardName): Promise<SvgBaselineHeader>;
  streamServedBaseline(board: BoardName): Promise<NodeJS.ReadableStream>;
  parseItems(board: BoardName, ids: Set<ItemId>): Promise<Map<ItemId, ItemSummary>>;
  rewriteStoredSvg(
    board: BoardName,
    fromSeqExclusive: BoardSeq,
    toSeqInclusive: BoardSeq,
    mutations: MutationEnvelope[],
  ): Promise<SvgBaselineHeader>;
}
```

### MetadataStore

Current sync callers need a replacement for `BoardData.loadMetadataSync`.

```ts
interface BoardMetadataStore {
  read(board: BoardName): Promise<{ readonly: boolean }>;
}
```

The board HTTP path becomes async when the SVG-backed metadata path ships.

## Stored SVG contents

Stored SVG is the source of truth. It must already be the correct renderable board, not a JSON payload re-encoded into SVG attributes.

No per-item field may be duplicated in stored SVG. Rewrite and hydration must derive board state from canonical SVG geometry and paint attributes, not from shadow metadata.

Required stored metadata:

- root:
  - `data-wbo-format`
  - `data-wbo-seq`
  - `data-wbo-readonly`
- persisted item identity and paint order:
  - `id`
  - paint order by child order inside stored `#drawingArea`
- shapes:
  - tag determines the tool:
    - `<rect>` => Rectangle
    - `<ellipse>` => Ellipse
    - `<line>` => Straight line
  - canonical SVG geometry attributes are the source of truth
  - `stroke`, `stroke-width`, `opacity`, and `transform` carry persisted style state
- text:
  - `<text>` tag determines the tool
  - `x`, `y`, `font-size`, node text content, `fill`, `opacity`, and `transform` are the source of truth
- pencil:
  - `<path>` tag determines the tool
  - `d` is the source of truth for pencil geometry
  - `stroke`, `stroke-width`, `opacity`, and `transform` carry persisted style state
  - hydration reconstructs in-memory point summaries from `d`; the file does not store raw points separately

Opaque shell rules:

- `defs`, `cursors`, and the surrounding SVG shell are not semantically parsed or regenerated during rewrite
- persistence treats them as opaque prefix/suffix bytes around stored `#drawingArea` children

The served baseline must satisfy the runtime DOM contract without inventing extra per-item metadata beyond the canonical SVG itself.

## Paint-order semantics

`paintOrder` is not an abstract tag. It must follow the current runtime behavior exactly.

Required mutation semantics:

- create appends the new item at the end of persisted `#drawingArea`
- copy appends the new copied item at the end of persisted `#drawingArea`
- update preserves the target item’s existing order
- Pencil child append preserves the parent item’s existing order
- Text update preserves the target item’s existing order
- Hand transform preserves the target item’s existing order
- delete removes the item from persisted `#drawingArea`
- clear removes all persisted items from `#drawingArea`

Implementation rules:

- hydration derives `paintOrder` from child order in stored `#drawingArea`
- `AdmissionIndex.applyAccepted(...)` must update stored summaries using the mutation semantics above
- `SvgBoardStore.rewriteStoredSvg(...)` must preserve the same order, not recompute or sort items independently
- parity and integration tests must assert order across create, copy, update, delete, clear, and rewrite flows

## Rejection and rollback

Routine post-local-draw rejection must stay rare.

Allowed rejection classes:

- readonly / auth failure
- rate limit / anti-abuse failure
- stale-context mutation against missing authoritative ids
- replay gap / replay unavailability

Rollback rules:

- single-mutation rejection removes the rejected speculative mutation
- sequenced authoritative follow-up mutations are applied through the normal authoritative replay path
- speculative descendants invalidated by those authoritative follow-up mutations must also be pruned
  - examples: speculative Hand transforms on a now-deleted id, speculative copies derived from a now-deleted seed item, speculative Pencil growth on a removed parent
- full authoritative resync is reserved for replay gap, reconnect without contiguous replay, or server session reset

This avoids wiping mid-stroke local work because of an unrelated rejection.

## Rollout plan

### 1. Freeze current behavior

Add regression tests for optimistic draw-before-send, disconnect clearing unsent optimistic writes, replay determinism, Pencil replay idempotence, and Hand/Text/Eraser behaviors that rely on stable ids.

### 2. Isolate legacy JSON reads

Introduce `LegacyJsonBoardSource`. `.json` is still the authoritative write target at this step.

### 3. Add typed seams

Introduce `BoardSeq`, `ClientMutationId`, replay event types, and a `BoardScene` skeleton. No protocol cutover yet.

### 4. Introduce BoardScene under the current revision model

Add client scene layers:

- authoritative
- speculative
- ephemeral

During rollout, this step still used the pre-`seq` acknowledgment model.

Migrate tools in order:

1. Rectangle / Ellipse / Straight line
2. Pencil
3. Text
4. Eraser
5. Hand

### 5. Add OptimisticJournal

Track speculative mutations by `clientMutationId`. During rollout this still used the pre-`seq` snapshot/replay flow.

### 6. Add BoardSession + MutationLog

Introduce contiguous `seq`, board-local serialized admission, and replay retention while the current persistence backend still exists.

### 7. Add the new sync handshake

Introduce `sync_request`, replay start/end, replay envelopes, and `resync_required`. This is the point where `seq` becomes authoritative on the client.

### 8. Switch baseline delivery to SVG

Add:

- inline streamed SVG baseline on `/boards/:name`
- served rendered baseline on `/boards/:name.svg`

At this step, the server stops emitting the initial `broadcast({_children, revision})` snapshot and relies on SVG baseline + replay only.

### 9. Build AdmissionIndex + SvgBoardStore + PersistenceCoordinator in shadow mode

Compare new decisions and summaries against the current production path.

### 10. Flip production persistence to SVG-first

This is the first step where eager `.json -> .svg` migration happens, because before this step `.json` is still the write target.

### 11. Remove coexistence paths

Remove old snapshot baseline delivery, `revision` terminology, and shadow-mode assertions once stable. Legacy JSON reads remain behind the isolated adapter as required compatibility.

## Test plan

Unit tests:

- `AdmissionIndex` parity for all mutation types
- `OptimisticJournal` append/promote/reject/reset
- `SvgBoardStore` parse/serialize/rewrite
- shared Pencil smoothing parity between client and server

Integration tests:

- stale cached baseline + contiguous replay
- empty replay
- replay gap forcing resync
- persistence finishing between baseline fetch and replay start
- single-mutation rejection that also authoritatively deletes a seed item
- Hand/Text/Eraser behavior on projected scene
- paint order preserved across copy/delete/rewrite

Route tests:

- `.svg` cache headers
- inline SVG baseline
- async metadata read path replacing `loadMetadataSync`
- legacy `.json` read fallback

Benchmarks:

- keep `load dense persisted board` by name for historical comparison
- add SVG baseline load/replay scenarios alongside it
- explicitly measure Pencil-heavy boards before approving the stored-vs-served SVG design

## Acceptance criteria

- active boards load from SVG baselines that satisfy the current runtime DOM contract
- persistent sync uses contiguous `seq`
- optimistic rendering still works without routine full-resync rollback
- the server keeps only minimal per-item summaries in memory
- paint order is preserved
- persistence rewrites stored SVG by streaming old state + queued mutations
- clients remain correct across the baseline/persistence race
- legacy `.json` loading remains isolated
- Pencil-heavy boards do not pay double-geometry storage in the stored SVG
