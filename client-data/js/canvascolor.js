/**
 *                CANVASCOLOR color picker
 *********************************************************
 * @licstart  The following is the entire license notice for the
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013-2014  Ophir LOJKINE
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


/*jshint bitwise:false*/

// ==ClosureCompiler==
// @output_file_name canvascolor.js
// @compilation_level ADVANCED_OPTIMIZATIONS
// @js_externs var canvascolor;
// @language ecmascript5_strict
// @use_types_for_optimization true
// ==/ClosureCompiler==

var canvascolor = (function() {//Code Isolation
    "use strict";

    (function addCSS () {
        var styleTag = document.createElement("style");
        styleTag.innerHTML = [".canvascolor-container{",
            "background-color:black;",
            "border-radius:5px;",
            "overflow:hidden;",
            "width:179px;",
            "padding:2px;",
            "display:none;",
            "}",
            ".canvascolor-container canvas{",
            "cursor:crosshair;",
            "}",
            ".canvascolor-history{",
            "overflow:auto;",
            "}",
            ".canvascolor-history > div{",
            "margin:2px;",
            "display:inline-block;",
            "}"].join("");
        document.head.appendChild(styleTag);
    })();

    function hsv2rgb (h,s,v) {
        if( s === 0 ) return [v,v,v]; // achromatic (grey)

        h /= (Math.PI/6);			// sector 0 to 5
        var i = h|0,
            f = h - i,			// factorial part of h
            p = v * ( 1 - s ),
            q = v * ( 1 - s * f ),
            t = v * ( 1 - s * ( 1 - f ) );
        switch( i%6 ) {
            case 0: return [v,t,p];
            case 1: return [q,v,p];
            case 2: return [p,v,t];
            case 3: return [p,q,v];
            case 4: return [t,p,v];
            case 5:return [v,p,q];
        }
    }

    function isFixedPosition(elem) {
        do {
            if (getComputedStyle(elem).position === "fixed") return true;
        } while ( (elem = elem.parentElement) !== null );
        return false;
    }

    var containerTemplate;
    (function createContainer(){
        containerTemplate = document.createElement("div");
        containerTemplate.className = "canvascolor-container";
        var canvas = document.createElement("canvas");
        var historyDiv = document.createElement("div");
        historyDiv.className = "canvascolor-history";
        containerTemplate.appendChild(canvas);
        containerTemplate.appendChild(historyDiv);
    })();

    function canvascolor(elem) {
        var curcolor = elem.value || "#000";

        var w=200, h=w/2;

        var container = containerTemplate.cloneNode(true);
        container.style.width = w+"px";
        container.style.position = isFixedPosition(elem) ? "fixed" : "absolute";
        var canvas = container.getElementsByTagName("canvas")[0];
        var ctx = canvas.getContext("2d");
        canvas.width = w; canvas.height=h;

        var prevcolorsDiv = container.getElementsByClassName("canvascolor-history")[0];
        prevcolorsDiv.style.width=w+"px";
        prevcolorsDiv.style.maxHeight=h+"px";

        var previewdiv = createColorDiv(curcolor);
        previewdiv.style.border = "1px solid white";
        previewdiv.style.borderRadius = "5px";

        document.body.appendChild(container);

        function displayContainer(){
            var rect = elem.getBoundingClientRect();
            var conttop=(rect.top+rect.height+3),
                contleft=rect.left;
            if (container.style.position !== "fixed") {
                conttop += document.documentElement.scrollTop;
                contleft += document.documentElement.scrollLeft;
            }
            container.style.top = conttop+"px";
            container.style.left = contleft+"px";
            container.style.display = "block";
        }
        function hideContainer(){
            container.style.display = "none";
        }

        elem.addEventListener("mouseover", displayContainer, true);
        container.addEventListener("mouseleave", hideContainer, false);
        elem.addEventListener("keyup", function(){
            changeColor(elem.value, true);
        }, true);

        changeColor(elem.value, true);

        var idata = ctx.createImageData(w,h);

        function rgb2hex (rgb) {
            function num2hex (c) {return (c*15/255|0).toString(16);}
            return "#"+num2hex(rgb[0])+num2hex(rgb[1])+num2hex(rgb[2]);
        }

        function colorAt(coords) {
            var x=coords[0], y=coords[1];
            return hsv2rgb(x/w*Math.PI, 1, (1-y/h)*255);
        }

        function render() {
            for (var x=0; x<w; x++) {
                for (var y=0;y<h; y++) {
                    var i = 4*(x+y*w);
                    var rgb = colorAt([x,y]);
                    idata.data[i] = rgb[0];//Red
                    idata.data[i+1] = rgb[1];//Green
                    idata.data[i+2] = rgb[2];//Blue
                    idata.data[i+3] = 255;
                }
            }
            ctx.putImageData(idata,0,0);
        }

        render();


        /** Changes the current color (the value of the input field) and updates other variables accordingly
         * @param {string} color The new color. Must be a valid CSS color string if ensureValid is not specified
         * @param {boolean} [ensureValid=false] Do not make the change if color is not a valid CSS color
         */
        function changeColor(color, ensureValid) {
            elem.style.backgroundColor = color;
            if (ensureValid && elem.style.backgroundColor.length === 0) {
                elem.style.backgroundColor = curcolor;
                return;
            }
            previewdiv.style.backgroundColor = color;
            curcolor = color;
            elem.value = color;
            elem.focus();
        }

        function createColorDiv (color) {
            var div = document.createElement("div");
            div.style.width = (w/3-10)+"px";
            div.style.height = (h/3-8)+"px";
            div.style.backgroundColor = color;
            div.addEventListener("click", function(){
                changeColor(color);
            }, true);
            if (prevcolorsDiv.childElementCount <= 1) prevcolorsDiv.appendChild(div);
            else prevcolorsDiv.insertBefore(div,prevcolorsDiv.children[1]);
            return div;
        }

        function canvasPos(evt) {
            var canvasrect = canvas.getBoundingClientRect();
            return [evt.clientX - canvasrect.left, evt.clientY - canvasrect.top];
        }

        canvas.addEventListener("mousemove", function(evt){
            var coords = canvasPos(evt);
            previewdiv.style.backgroundColor = rgb2hex(colorAt(coords));
        }, true);

        canvas.addEventListener("click", function(evt){
            var coords = canvasPos(evt);
            var color = rgb2hex(colorAt(coords));
            createColorDiv(color);
            changeColor(color);
        }, true);

        canvas.addEventListener("mouseleave", function(){
            previewdiv.style.backgroundColor = curcolor;
        }, true);
    }


    //Put a color picker on every input[type=color] if the browser doesn't support this input type
    //and on every input with the class canvascolor
    var pickers = document.querySelectorAll("input.canvascolor, input[type=color]");
    for (var i=0;i <pickers.length; i++) {
        var input = pickers.item(i);
        //If the browser supports native color picker and the user didn't
        //explicitly added canvascolor to the element, we do not add a custom color picker
        if (input.type !== "color" ||
            input.className.split(" ").indexOf("canvascolor") !== -1) {
            canvascolor(input);
        }
    }

    return canvascolor;
}());