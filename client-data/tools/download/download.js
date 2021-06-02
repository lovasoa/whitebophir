/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2020  Ophir LOJKINE
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

(function download() { //Code isolation

    function downloadSVGFile() {
        var canvasCopy = Tools.svg.cloneNode(true);
        canvasCopy.removeAttribute("style", ""); // Remove css transform
        var styleNode = document.createElement("style");

        // Copy the stylesheets from the whiteboard to the exported SVG
        styleNode.innerHTML = Array.from(document.styleSheets)
            .filter(function (stylesheet) {
                if (stylesheet.href && (stylesheet.href.match(/boards\/tools\/.*\.css/)
                    || stylesheet.href.match(/board\.css/))) {
                    // This is a Stylesheet from a Tool or the Board itself, so we should include it
                    return true;
                }
                // Not a stylesheet of the tool, so we can ignore it for export
                return false;
            })
            .map(function (stylesheet) {
                return Array.from(stylesheet.cssRules)
                    .map(function (rule) { return rule.cssText })
            }).join("\n")

        canvasCopy.appendChild(styleNode);
        var outerHTML = canvasCopy.outerHTML || new XMLSerializer().serializeToString(canvasCopy);
        var blob = new Blob([outerHTML], { type: 'image/svg+xml;charset=utf-8' });
        downloadContent(blob, Tools.boardName + ".svg");
    }

    function downloadContent(blob, filename) {
        if (window.navigator.msSaveBlob) { // Internet Explorer
            window.navigator.msSaveBlob(blob, filename);
        } else {
            const url = URL.createObjectURL(blob);
            var element = document.createElement('a');
            element.setAttribute('href', url);
            element.setAttribute('download', filename);
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);
            window.URL.revokeObjectURL(url);
        }
    }

    Tools.add({ //The new tool
        "name": "Download",
        "shortcut": "d",
        "listeners": {},
        "icon": "tools/download/download.svg",
        "oneTouch": true,
        "onstart": downloadSVGFile,
        "mouseCursor": "crosshair",
    });

})(); //End of code isolation