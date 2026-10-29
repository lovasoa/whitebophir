/** @param {string} assetPath */
export function normalizeBoardAssetPath(assetPath) {
  if (
    assetPath.startsWith("./") ||
    assetPath.startsWith("../") ||
    assetPath.startsWith("/") ||
    assetPath.startsWith("data:") ||
    assetPath.startsWith("http://") ||
    assetPath.startsWith("https://")
  ) {
    return assetPath;
  }
  return `../${assetPath}`;
}
