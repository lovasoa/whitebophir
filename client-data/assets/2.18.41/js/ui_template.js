/**
 * Parse fixed UI markup on first use, then clone its inert template. Dynamic
 * text and attributes must be assigned to the clone, never interpolated here.
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} markup
 * @returns {() => T}
 */
export function createUiTemplate(markup) {
  /** @type {HTMLTemplateElement | undefined} */
  let template;
  return () => {
    template ??= document.createElement("template");
    if (!template.content.firstElementChild) template.innerHTML = markup;
    return /** @type {T} */ (
      /** @type {Element} */ (template.content.firstElementChild).cloneNode(
        true,
      )
    );
  };
}
