(function (global) {
    "use strict";

    function dist(x1, y1, x2, y2) {
        //Returns the distance between (x1,y1) and (x2,y2)
        return Math.hypot(x2 - x1, y2 - y1);
    }

    /**
     * Represents a single operation in an SVG path
     * @param {string} type 
     * @param {number[]} values 
     */
    function PathDataPoint(type, values) {
        this.type = type;
        this.values = values;
    }

    /**
     * Given the existing points in a path, add a new point to get a smoothly interpolated path
     * @param {PathDataPoint[]} pts 
     * @param {number} x 
     * @param {number} y 
     */
    function wboPencilPoint(pts, x, y) {
        // pts represents the points that are already in the line as a PathData
        var nbr = pts.length; //The number of points already in the line
        var npoint;
        switch (nbr) {
            case 0: //The first point in the line
                //If there is no point, we have to start the line with a moveTo statement
                pts.push(new PathDataPoint("M", [x, y]));
                //Temporary first point so that clicks are shown and can be erased
                npoint = new PathDataPoint("L", [x, y]);
                break;
            case 1: //This should never happen
                // First point will be the move. Add Line of zero length ensure there are two points and fall through
                pts.push(new PathDataPoint("L", [pts[0].values[0], pts[0].values[1]]));
            // noinspection FallThroughInSwitchStatementJS
            case 2: //There are two points. The initial move and a line of zero length to make it visible
                //Draw a curve that is segment between the old point and the new one
                npoint = new PathDataPoint("C", [
                    pts[0].values[0], pts[0].values[1],
                    x, y,
                    x, y,
                ]);
                break;
            default: //There are at least two points in the line
                npoint = pencilExtrapolatePoints(pts, x, y);
        }
        if (npoint) pts.push(npoint);
        return pts;
    }

    function pencilExtrapolatePoints(pts, x, y) {
        //We add the new point, and smoothen the line
        var ANGULARITY = 3; //The lower this number, the smoother the line
        var prev_values = pts[pts.length - 1].values; // Previous point
        var ante_values = pts[pts.length - 2].values; // Point before the previous one
        var prev_x = prev_values[prev_values.length - 2];
        var prev_y = prev_values[prev_values.length - 1];
        var ante_x = ante_values[ante_values.length - 2];
        var ante_y = ante_values[ante_values.length - 1];


        //We don't want to add the same point twice consecutively
        if ((prev_x === x && prev_y === y)
            || (ante_x === x && ante_y === y)) return;

        var vectx = x - ante_x,
            vecty = y - ante_y;
        var norm = Math.hypot(vectx, vecty);
        var dist1 = dist(ante_x, ante_y, prev_x, prev_y) / norm,
            dist2 = dist(x, y, prev_x, prev_y) / norm;
        vectx /= ANGULARITY;
        vecty /= ANGULARITY;
        //Create 2 control points around the last point
        var cx1 = prev_x - dist1 * vectx,
            cy1 = prev_y - dist1 * vecty, //First control point
            cx2 = prev_x + dist2 * vectx,
            cy2 = prev_y + dist2 * vecty; //Second control point
        prev_values[2] = cx1;
        prev_values[3] = cy1;

        return new PathDataPoint("C", [
            cx2, cy2,
            x, y,
            x, y,
        ]);
    }

    global["wboPencilPoint"] = wboPencilPoint;
})("object" === typeof module && module.exports || window);