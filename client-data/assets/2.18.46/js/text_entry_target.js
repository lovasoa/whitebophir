/**
 * @param {EventTarget | null} target
 * @returns {target is HTMLInputElement | HTMLTextAreaElement}
 */
export function isTextEntryTarget(target) {
  return (
    (target instanceof HTMLInputElement && target.type === "text") ||
    target instanceof HTMLTextAreaElement
  );
}
