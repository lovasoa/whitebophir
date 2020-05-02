function pencilExtrapolatePoints (pts, x, y) {
    function dist(x1, y1, x2, y2) {
        //Returns the distance between (x1,y1) and (x2,y2)
        return Math.hypot(x2 - x1, y2 - y1);
    }

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

    return {
        type: "C", values: [
            cx2, cy2,
            x, y,
            x, y,
        ]
    }
}

try {
    module.exports = {
        pencilExtrapolatePoints: pencilExtrapolatePoints
    };
} catch (e) {

}