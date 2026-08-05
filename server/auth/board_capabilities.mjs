import {
  getMutationType,
  MutationType,
} from "../../client-data/js/message_tool_metadata.js";
import {
  BOARD_CAPABILITY,
  BOARD_CAPABILITY_FLAG_BY_CAPABILITY,
  TOOL_CODE_BY_ID,
} from "../../client-data/tools/manifest.js";
import { forbidden } from "../http/boundary_errors.mjs";
import { roleInBoard } from "./board_jwt.mjs";
import { isConfiguredModerator } from "./board_moderators.mjs";

/** @typedef {{AUTH_SECRET_KEY: string, BOARD_MODERATORS?: Map<string, Set<string>>}} BoardCapabilityConfig */
/** @typedef {{name: string, readonly?: boolean, isReadOnly?: () => boolean}} BoardCapabilityBoard */
/** @typedef {{token?: string | null, userSecret?: string | null}} BoardCapabilityUserInfo */
/** @typedef {() => boolean} IsBannedPredicate */
/** @typedef {() => number | null} GetBanExpiresAt */
/** @typedef {() => number | null} GetTemporaryModeratorExpiresAt */
/** @typedef {import("../../types/app-runtime").BoardCapabilities} BoardCapabilities */
/** @typedef {import("../../types/app-runtime").BoardCapability} BoardCapability */
/** @typedef {import("../../types/app-runtime").AppBoardState} RenderedBoardState */
/** @typedef {{tool?: unknown, type?: unknown, _children?: unknown}} CapabilityMessage */

const CURSOR_TOOL_CODE = TOOL_CODE_BY_ID.cursor;

/**
 * @param {BoardCapabilityBoard} board
 * @returns {boolean}
 */
function isBoardReadOnly(board) {
  if (typeof board.isReadOnly === "function") return board.isReadOnly();
  return board.readonly === true;
}

/**
 * @param {unknown} role
 * @returns {boolean}
 */
function isEditCapableRole(role) {
  return role === "editor" || role === "moderator";
}

/**
 * @param {unknown} role
 * @returns {boolean}
 */
function isClearCapableRole(role) {
  return role === "moderator";
}

/**
 * @param {BoardCapabilityConfig} config
 * @param {string} boardName
 * @param {BoardCapabilityUserInfo | undefined} userInfo
 * @returns {"moderator" | "editor" | "reader" | "forbidden"}
 */
function roleForBoard(config, boardName, userInfo) {
  if (isConfiguredModerator(config, boardName, userInfo?.userSecret))
    return "moderator";
  if (config.AUTH_SECRET_KEY === "") return "editor";
  const token = userInfo?.token;
  return token ? roleInBoard(config, token, boardName) : "forbidden";
}

/**
 * @param {BoardCapabilities} capabilities
 * @param {BoardCapability} capability
 * @returns {boolean}
 */
function capabilitiesGrant(capabilities, capability) {
  return capabilities[BOARD_CAPABILITY_FLAG_BY_CAPABILITY[capability]] === true;
}

/**
 * Creates a per-request/per-socket resolver so JWT verification happens once
 * for a board and the resulting compatibility role stays inside this module.
 *
 * Ban state is live (re-evaluated on every capability query) so a time-based
 * edit ban degrades `canEdit` to `false` without a separate enforcement path.
 * `getBanExpiresAt` also lets rendered state tell the browser when to refresh
 * access once. `isBanned` remains supported for ban sources without an expiry.
 * Moderators bypass both. Defaults to never-banned.
 *
 * @param {{config: BoardCapabilityConfig, boardName: string, userInfo?: BoardCapabilityUserInfo, isBanned?: IsBannedPredicate, getBanExpiresAt?: GetBanExpiresAt, getTemporaryModeratorExpiresAt?: GetTemporaryModeratorExpiresAt}} input
 * @returns {{
 *   canOpen: () => boolean,
 *   canBan: () => boolean,
 *   canGrantTemporaryModerator: () => boolean,
 *   canReport: () => boolean,
 *   resolveCapabilities: (board: BoardCapabilityBoard) => BoardCapabilities,
 *   boardState: (board: BoardCapabilityBoard) => RenderedBoardState,
 *   requireOpen: () => void,
 *   canApplyBoardMessage: (board: BoardCapabilityBoard, message: CapabilityMessage) => boolean,
 * }}
 */
function forBoard(input) {
  const jwtEnabled = input.config.AUTH_SECRET_KEY !== "";
  const role = roleForBoard(input.config, input.boardName, input.userInfo);
  const permanentModerator = isClearCapableRole(role);
  const fallbackIsBanned = input.isBanned || (() => false);

  /** @returns {number | null} */
  function readTemporaryModeratorExpiresAt() {
    if (permanentModerator || !input.getTemporaryModeratorExpiresAt)
      return null;
    const expiresAt = Number(input.getTemporaryModeratorExpiresAt());
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? expiresAt
      : null;
  }

  /**
   * Reads one coherent ban snapshot for a capability response. Expiry-aware
   * callers return only active expiries; the defensive wall-clock check keeps
   * stale or malformed values from scheduling needless refreshes.
   *
   * @returns {{moderator: boolean, banned: boolean, refreshAfterMs: number | null}}
   */
  function readAccessState() {
    const temporaryModeratorExpiresAt = readTemporaryModeratorExpiresAt();
    if (permanentModerator) {
      return {
        moderator: true,
        banned: false,
        refreshAfterMs: null,
      };
    }
    if (temporaryModeratorExpiresAt !== null) {
      return {
        moderator: true,
        banned: false,
        refreshAfterMs: Math.max(
          0,
          Math.floor(temporaryModeratorExpiresAt - Date.now()),
        ),
      };
    }
    if (!input.getBanExpiresAt) {
      return {
        moderator: false,
        banned: fallbackIsBanned(),
        refreshAfterMs: null,
      };
    }
    const expiresAt = Number(input.getBanExpiresAt());
    const now = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      return {
        moderator: false,
        banned: false,
        refreshAfterMs: null,
      };
    }
    return {
      moderator: false,
      banned: true,
      refreshAfterMs: Math.max(0, Math.floor(expiresAt - now)),
    };
  }

  function canOpen() {
    return (
      !jwtEnabled ||
      role !== "forbidden" ||
      readTemporaryModeratorExpiresAt() !== null
    );
  }

  /**
   * Reporting is available to every board viewer except an identity with an
   * active moderation ban. Moderators retain their existing ban bypass.
   * Keeping this decision beside the other board permissions prevents callers
   * from inferring ban state from the broader edit flag.
   *
   * @returns {boolean}
   */
  function canReport() {
    return canOpen() && !readAccessState().banned;
  }

  /**
   * @param {BoardCapabilityBoard} board
   * @param {{moderator: boolean, banned: boolean}} accessState
   * @returns {BoardCapabilities}
   */
  function resolveCapabilitiesForAccessState(board, accessState) {
    const readonly = isBoardReadOnly(board);
    if (!jwtEnabled && !accessState.moderator) {
      return {
        canOpen: true,
        canEdit: !readonly && !accessState.banned,
        canClear: false,
      };
    }

    const open =
      !jwtEnabled || role !== "forbidden" || accessState.moderator === true;
    return {
      canOpen: open,
      canEdit:
        open &&
        !accessState.banned &&
        (!readonly || accessState.moderator || isEditCapableRole(role)),
      canClear: accessState.moderator,
    };
  }

  /**
   * @param {BoardCapabilityBoard} board
   * @returns {BoardCapabilities}
   */
  function resolveCapabilities(board) {
    return resolveCapabilitiesForAccessState(board, readAccessState());
  }

  /**
   * @param {BoardCapabilityBoard} board
   * @returns {RenderedBoardState}
   */
  function boardState(board) {
    const accessState = readAccessState();
    const capabilities = resolveCapabilitiesForAccessState(board, accessState);
    return {
      ...boardStateForCapabilities(board, capabilities),
      canBan: accessState.moderator,
      canGrantTemporaryModerator: permanentModerator,
      canReport: capabilities.canOpen && !accessState.banned,
      ...(accessState.refreshAfterMs === null
        ? {}
        : { accessRefreshAfterMs: accessState.refreshAfterMs }),
    };
  }

  /**
   * @returns {void}
   */
  function requireOpen() {
    if (!canOpen()) throw forbidden("access_forbidden");
  }

  /**
   * @param {BoardCapabilityBoard} board
   * @param {CapabilityMessage} message
   * @returns {boolean}
   */
  function canApplyBoardMessage(board, message) {
    return canApplyBoardMessageWithCapabilities(
      resolveCapabilities(board),
      message,
    );
  }

  return {
    canOpen,
    canReport,
    resolveCapabilities,
    boardState,
    requireOpen,
    canApplyBoardMessage,
    canBan: () =>
      permanentModerator || readTemporaryModeratorExpiresAt() !== null,
    canGrantTemporaryModerator: () => permanentModerator,
  };
}

/**
 * @param {{config: BoardCapabilityConfig, board: BoardCapabilityBoard, userInfo?: BoardCapabilityUserInfo}} input
 * @returns {BoardCapabilities}
 */
function resolveCapabilities(input) {
  return forBoard({
    config: input.config,
    boardName: input.board.name,
    userInfo: input.userInfo,
  }).resolveCapabilities(input.board);
}

/**
 * @param {BoardCapabilityBoard} board
 * @param {BoardCapabilities} capabilities
 * @returns {RenderedBoardState}
 */
function boardStateForCapabilities(board, capabilities) {
  return {
    readonly: isBoardReadOnly(board),
    canEdit: capabilities.canEdit,
    canClear: capabilities.canClear,
    canWrite: capabilities.canEdit,
  };
}

/**
 * @param {BoardCapabilities} capabilities
 * @param {CapabilityMessage} message
 * @returns {boolean}
 */
function canApplyBoardMessageWithCapabilities(capabilities, message) {
  if (message.tool === CURSOR_TOOL_CODE) {
    return capabilitiesGrant(capabilities, BOARD_CAPABILITY.OPEN);
  }
  if (getMutationType(message) === MutationType.CLEAR) {
    return capabilitiesGrant(capabilities, BOARD_CAPABILITY.CLEAR);
  }
  return capabilitiesGrant(capabilities, BOARD_CAPABILITY.EDIT);
}

const BoardPermissions = Object.freeze({
  forBoard,
  resolveCapabilities,
  boardStateForCapabilities,
  canApplyBoardMessageWithCapabilities,
  /**
   * @param {{config: BoardCapabilityConfig, board: BoardCapabilityBoard, userInfo?: BoardCapabilityUserInfo}} input
   * @returns {boolean}
   */
  canOpen(input) {
    return resolveCapabilities(input).canOpen;
  },
  /**
   * @param {{config: BoardCapabilityConfig, board: BoardCapabilityBoard, userInfo?: BoardCapabilityUserInfo}} input
   * @returns {boolean}
   */
  canEdit(input) {
    return resolveCapabilities(input).canEdit;
  },
  /**
   * @param {{config: BoardCapabilityConfig, board: BoardCapabilityBoard, userInfo?: BoardCapabilityUserInfo}} input
   * @returns {boolean}
   */
  canClear(input) {
    return resolveCapabilities(input).canClear;
  },
});

export {
  BoardPermissions,
  boardStateForCapabilities,
  canApplyBoardMessageWithCapabilities,
  forBoard,
  resolveCapabilities,
};
