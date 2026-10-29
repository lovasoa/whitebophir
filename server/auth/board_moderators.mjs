/**
 * @param {{BOARD_MODERATORS?: Map<string, Set<string>>}} config
 * @param {string} boardName
 * @param {string | undefined | null} userSecret
 * @returns {boolean}
 */
export function isConfiguredModerator(config, boardName, userSecret) {
  if (!userSecret) return false;
  const moderators = config.BOARD_MODERATORS?.get(
    String(boardName).toLowerCase(),
  );
  return moderators !== undefined && moderators.has(userSecret);
}
