export const SocketEvents = Object.freeze({
  BOARDSTATE: "boardstate",
  BROADCAST: "broadcast",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  ERROR: "error",
  MUTATION_REJECTED: "mutation_rejected",
  RATE_LIMITED: "rate-limited",
  REPORT_USER: "report_user",
  RESYNC_REQUIRED: "resync_required",
  SYNC_REPLAY_END: "sync_replay_end",
  SYNC_REPLAY_START: "sync_replay_start",
  SYNC_REQUEST: "sync_request",
  TURNSTILE_TOKEN: "turnstile_token",
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
});

export const SocketControlEvents = Object.freeze([
  SocketEvents.MUTATION_REJECTED,
  SocketEvents.RESYNC_REQUIRED,
  SocketEvents.SYNC_REPLAY_END,
  SocketEvents.SYNC_REPLAY_START,
]);
