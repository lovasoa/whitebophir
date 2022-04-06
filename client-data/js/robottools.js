var RobotTools = {}

/**
 * Send a custom robot whiteboard app message to the server,
 * and all other attached clients
 * @param {string} msg 
 * @param {object} args 
 */
RobotTools.send = function(msg, args) {
    Tools.send({type:"robotmessage", msg:msg, args:args},"robotTool")
};

/**
 * Move the camera to a preset tilt and zoom
 * @param {string} mode home | whiteboard | station
 */
RobotTools.cameraPreset = function (mode) {
    RobotTools.send("camerapreset", {mode:mode});
};

/**
 * Set the projector tilt and power according to the mode
 * @param {string} mode home | whiteboard | station
 */
 RobotTools.projectorMode = function (mode) {
    RobotTools.send("projectormode", {mode:mode});
};

/**
 * Drive the robot to a room
 * @param {string} room The room name (aka named space) in the RMS map
 */
RobotTools.goToRoom = function (room) {
    RobotTools.send("gotoroom", {name:room});
};
