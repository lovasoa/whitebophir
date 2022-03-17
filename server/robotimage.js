const { exec } = require("child_process");
/**
 * just for testing how to run external process
 */
function pwd () {
	return new Promise( (resolve, reject) => {
		exec("pwd", (error, stdout, stderr) => {
			if (error) reject(error.message);
			else resolve(stdout);
		});
	});
}

function getSnapshotMarkers() {
	return new Promise( (resolve, reject) => {
		exec("./get_snapshot_markers.sh", (error, stdout, stderr) => {
			if (error) reject(error.message);
			else resolve(stdout);
		});
	});
}


function transformWhiteboardImage() {
	return new Promise( (resolve, reject) => {
		exec("./transform_robot_image.sh", (error, stdout, stderr) => {
			if (error) reject(stdout + ' ' + error.message);
			else resolve(stdout);
		});
	});
}

module.exports = { pwd, getSnapshotMarkers, transformWhiteboardImage };