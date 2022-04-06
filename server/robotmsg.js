const { getSnapshotMarkers, transformWhiteboardImage } = require("./robotimage.js")
const request = require('request-promise-native')
const log = require("./log.js").log

// RMS and Robot configuration
// TODO support multiple robots, each could be on a different RMS,
// TODO maybe something like use the robot ID or map name as the board name,
// TODO and somehow associate RMS information with that.
var RMSNAME = process.env["WBO_RMSNAME"] || "eft.ava8.net";
var RMSUSER = process.env["WBO_RMSUSER"] || "unknown";
var RMSPW = process.env["WBO_RMSPW"] || "unknown";
var ROBOT = process.env["WBO_ROBOT"] || "SB00243";

// Camera preset values. Could these be different for different robots?
const tiltWhiteboard = 0.0;
const tiltStation = 0.528;
const zoomWhiteboard = 8;
const zoomStation = 3;

async function rmsGet(api) {
    let rv;
    try {
        let rmsUrl = `https://${RMSUSER}:${RMSPW}@${RMSNAME}/api/htproxy/whiteboard/${ROBOT}${api}`;
        let resp = await request({url:rmsUrl, json:true, timeout:5000});
        log(`rms GET ${api}`, resp);
        rv = resp;
    } catch (e) {
        log(`rms GET ERROR ${api}`, e);
        rv = e;
    }
    return rv;
}

async function rmsPost(api, data) {
    let rv;
    try {
        let rmsUrl = `https://${RMSUSER}:${RMSPW}@${RMSNAME}/api/htproxy/whiteboard/${ROBOT}${api}`;
        let resp = await request({uri:rmsUrl, method:'POST', json:true, body:data, timeout:5000});
        log(`rms POST ${api}`, resp);
        rv = resp;
    } catch (e) {
        log(`rms POST ERROR ${api}`, e);
        rv = e;
    }
    return rv;
}

async function handleCamPreset(mode) {
    if (mode === "home") {
        await rmsGet("/robot/drive/resetTilt");
        // zoomDirectInternal caused irregular zoom out then zoom in again
        await rmsGet("/robot/cameraPose/zoomDirect?level=0");
    } else {
        let tiltposition;
        let zoomlevel;
        if (mode === "whiteboard") {
            tiltposition = tiltWhiteboard;
            zoomlevel = zoomWhiteboard;
        } else {
            tiltposition = tiltStation;
            zoomlevel = zoomStation;
        }
        let zoomapi = `/robot/cameraPose/zoomDirect?level=${zoomlevel}`;
        let tiltapi = `/robot/drive/payloadPose?cameraTilt=${tiltposition}`;
        await rmsGet(tiltapi);
        await rmsGet(zoomapi);
    }
}

async function handleProjectorMode(mode) {
    let args = {};
    if (mode === "home") {
        args.projector = "off";
        args.tilt = "up";
    } else if (mode === "whiteboard") {
        args.projector = "on";
        args.tilt = "up";
    } else if (mode === "station") {
        args.projector = "on";
        args.tilt = "down";
    }
    await rmsPost('/robot/torso/set', args)
}

async function goToRoom(room) {
    await rmsPost('/robot/tel/goToRoom', {name:room});
}

function handleRobotMsg(message) {
    if (message.msg === "log") {
        log("clientlog", message.logobj);
    } else {
        log("robotmessage", message);
    }
    if (message.msg === "showmarkers") {
        getSnapshotMarkers()
            .then(val => log(`MARKD getSnapshotMarkers: ${val}`))
            .catch(e => log(`MARKD ERROR from getSnapshotMarkers ${e}`));
    }
    else if (message.msg === "showblack") {
        transformWhiteboardImage()
            .then(val => log(`MARKD xform ${val}`))
            .catch(e => log(`MARKD ERROR from xform ${e}`));
    }
    else if (message.msg === "camerapreset") {
        handleCamPreset(message.args.mode);
    }
    else if (message.msg === "gotoroom") {
        goToRoom(message.args.name);
    }
    else if (message.msg === "projectormode") {
        handleProjectorMode(message.args.mode);
    }
}

module.exports = { handleRobotMsg };