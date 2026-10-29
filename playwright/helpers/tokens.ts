import jsonwebtoken from "jsonwebtoken";

export const AUTH_SECRET = "test";
export const DEFAULT_FORWARDED_IP = "198.51.100.10";

export const TOKENS = {
  globalModerator: jsonwebtoken.sign(
    { sub: "moderator", roles: ["moderator"] },
    AUTH_SECRET,
  ),
  boardModeratorTestboard: jsonwebtoken.sign(
    { sub: "moderator-board", roles: ["moderator:testboard"] },
    AUTH_SECRET,
  ),
  globalEditor: jsonwebtoken.sign(
    { sub: "editor", roles: ["editor"] },
    AUTH_SECRET,
  ),
  boardEditorTestboard: jsonwebtoken.sign(
    { sub: "editor-board", roles: ["editor:testboard"] },
    AUTH_SECRET,
  ),
  readOnlyViewer: jsonwebtoken.sign(
    { sub: "viewer", roles: ["reader:readonly-test"] },
    AUTH_SECRET,
  ),
  readOnlyGlobalEditor: jsonwebtoken.sign(
    { sub: "readonly-editor", roles: ["editor"] },
    AUTH_SECRET,
  ),
  readOnlyBoardEditor: jsonwebtoken.sign(
    { sub: "readonly-board-editor", roles: ["editor:readonly-test"] },
    AUTH_SECRET,
  ),
  readOnlyGlobalModerator: jsonwebtoken.sign(
    { sub: "readonly-moderator", roles: ["moderator"] },
    AUTH_SECRET,
  ),
} as const;
