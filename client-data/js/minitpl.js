/**
 *                        MINITPL
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

var Minitpl = (function () {
  /**
   * @typedef {string | ((element: Element) => void)} TemplateValue
   * @typedef {{[selector: string]: TemplateValue}} TemplateMapping
   */

  /**
   * @constructor
   * @param {string | Element} elem
   */
  function Minitpl(elem) {
    this.elem = typeof elem === "string" ? document.querySelector(elem) : elem;
    if (!this.elem) {
      throw new Error("Invalid element");
    }
    if (!this.elem.parentNode) {
      throw new Error("Template element has no parent");
    }
    this.parent = this.elem.parentNode;
    this.parent.removeChild(this.elem);
  }

  /**
   * @param {Element} element
   * @param {TemplateValue} transformer
   */
  function transform(element, transformer) {
    if (typeof transformer === "function") {
      transformer(element);
    } else {
      element.textContent = transformer;
    }
  }

  /**
   * @param {TemplateValue | TemplateMapping} data
   * @returns {Element}
   */
  Minitpl.prototype.add = function (data) {
    var newElem = this.elem.cloneNode(true);
    if (!(newElem instanceof Element)) {
      throw new Error("Template clone must be an Element");
    }
    if (typeof data === "object") {
      for (var key in data) {
        var value = data[key];
        if (value === undefined) {
          continue;
        }
        var matches = newElem.querySelectorAll(key);
        for (var i = 0; i < matches.length; i++) {
          var match = matches[i];
          if (match) {
            transform(match, value);
          }
        }
      }
    } else {
      transform(newElem, data);
    }
    this.parent.appendChild(newElem);
    return newElem;
  };

  return Minitpl;
})();
