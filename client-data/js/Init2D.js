

/*****
*
*   globals
*
*****/
var svgns  = "http://www.w3.org/2000/svg";
var azap, mouser;
var points = new Array();
var shapes = new Array();
var info;
var initCalled = false;


/*****
*
*   init
*
*****/
function init(e) {
    if(!initCalled){
        initCalled = true;
        azap   = new AntiZoomAndPan();
        mouser = new Mouser();

        var background = Tools.svg.getElementById("rect_1");

        azap.appendNode(mouser.svgNode);
        azap.appendNode(background);
    }
}
