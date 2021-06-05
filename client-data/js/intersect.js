/**
 *                        INTERSEC
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *  JavaScript code in this page.
 *
 * Copyright (C) 2021  Ophir LOJKINE
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

if (!SVGGraphicsElement.prototype.transformedBBox || !SVGGraphicsElement.prototype.transformedBBoxContains) {
    [pointInTransformedBBox,
     transformedBBoxIntersects] = (function () {

	 var get_transform_matrix = function (elem) {
	     // Returns the first translate or transform matrix or makes one
	     var transform = null;
	     for (var i = 0; i < elem.transform.baseVal.numberOfItems; ++i) {
		 var baseVal = elem.transform.baseVal[i];
		 // quick tests showed that even if one changes only the fields e and f or uses createSVGTransformFromMatrix
		 // the brower may add a SVG_TRANSFORM_MATRIX instead of a SVG_TRANSFORM_TRANSLATE
		 if (baseVal.type === SVGTransform.SVG_TRANSFORM_MATRIX) {
		     transform = baseVal;
		     break;
		 }
	     }
	     if (transform == null) {
		 transform = elem.transform.baseVal.createSVGTransformFromMatrix(Tools.svg.createSVGMatrix());
		 elem.transform.baseVal.appendItem(transform);
	     }
	     return transform.matrix;
	 }

	var transformRelative = function (m,t) {
	    return [
		m.a*t[0]+m.c*t[1],
		m.b*t[0]+m.d*t[1]
	    ]
	}

	var transformAbsolute = function (m,t) {
	    return [
		m.a*t[0]+m.c*t[1]+m.e,
		m.b*t[0]+m.d*t[1]+m.f
	    ]
	}

	SVGGraphicsElement.prototype.transformedBBox = function (scale=1) {
	    bbox = this.getBBox();
	    tmatrix = get_transform_matrix(this);
	    tmatrix.e /= scale;
	    tmatrix.f /= scale;
	    return {
		r: transformAbsolute(tmatrix,[bbox.x/scale,bbox.y/scale]),
		a: transformRelative(tmatrix,[bbox.width/scale,0]),
		b: transformRelative(tmatrix,[0,bbox.height/scale])
	    }
	}

	SVGSVGElement.prototype.transformedBBox = function (scale=1) {
	    bbox = {
		x: this.x.baseVal.value,
		y: this.y.baseVal.value,
		width: this.width.baseVal.value,
		height: this.height.baseVal.value
	    };
	    tmatrix = get_transform_matrix(this);
	    tmatrix.e /= scale;
	    tmatrix.f /= scale;
	    return {
		r: transformAbsolute(tmatrix,[bbox.x/scale,bbox.y/scale]),
		a: transformRelative(tmatrix,[bbox.width/scale,0]),
		b: transformRelative(tmatrix,[0,bbox.height/scale])
	    }
	}

	var pointInTransformedBBox = function ([x,y],{r,a,b}) {
	    var d = [x-r[0],y-r[1]];
	    var idet = (a[0]*b[1]-a[1]*b[0]);
	    var c1 = (d[0]*b[1]-d[1]*b[0]) / idet;
	    var c2 = (d[1]*a[0]-d[0]*a[1]) / idet;
	    return (c1>=0 && c1<=1 && c2>=0 && c2<=1)
	}

	SVGGraphicsElement.prototype.transformedBBoxContains = function (x,y) {
	    return pointInTransformedBBox([x, y], this.transformedBBox())
	}

	function transformedBBoxIntersects(bbox_a,bbox_b) {
	    var corners = [
		bbox_b.r,
		[bbox_b.r[0] + bbox_b.a[0], bbox_b.r[1] + bbox_b.a[1]],
		[bbox_b.r[0] + bbox_b.b[0], bbox_b.r[1] + bbox_b.b[1]],
		[bbox_b.r[0] + bbox_b.a[0] + bbox_b.b[0], bbox_b.r[1] + bbox_b.a[1] + bbox_b.b[1]]
	    ]
	    return corners.every(function(corner) {
				return pointInTransformedBBox(corner, bbox_a);
			})
	}

	SVGGraphicsElement.prototype.transformedBBoxIntersects= function (bbox) {
	    return transformedBBoxIntersects(this.transformedBBox(),bbox)
	}

	 return [pointInTransformedBBox,
		 transformedBBoxIntersects]
    })();
}
