/**
 * @param {{BOARD_MODERATORS?: {[boardName: string]: Set<string>}}} config
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @returns {boolean}
 */
export function isConfiguredModerator(config, boardName, userSecret) {
  if (!userSecret) return false;
  const moderators = config.BOARD_MODERATORS?.[String(boardName).toLowerCase()];
  return moderators ? moderators.has(userSecret) : false;
}
