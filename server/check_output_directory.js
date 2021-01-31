const fs = require("./fs_promises");
const path = require('path');
let os = require('os');

const { R_OK, W_OK } = fs.constants;

/**
 * Checks that the output directory is writeable
 * @param {string} directory
 * @returns {string?}
 */
async function get_error(directory) {
    if (!fs.existsSync(directory)) {
        return "does not exist";
    }
    if (!fs.statSync(directory).isDirectory()) {
        error = "exists, but is not a directory";
    }
    const { uid, gid } = os.userInfo();
    const tmpfile = path.join(directory, Math.random() + ".json");
    try {
        fs.writeFileSync(tmpfile, "{}");
        fs.unlinkSync(tmpfile);
    } catch (e) {
        return "does not allow file creation and deletion. " +
            "Check the permissions of the directory, and if needed change them so that " +
            `user with UID ${uid} has access to them. This can be achieved by running the command: chown ${uid}:${gid} on the directory`;
    }
    const fileChecks = [];
    const dir = fs.opendirSync(directory);
    while (true) {
        const elem = await dir.read();
        if (!elem) break;
        if (/^board-(.*)\.json$/.test(elem.name)) {
            const elemPath = path.join(directory, elem.name);
            if (!elem.isFile()) return `contains a board file named "${elemPath}" which is not a normal file`
            fileChecks.push(fs.promises.access(elemPath, R_OK | W_OK)
                .catch(function () { return elemPath }))
        }
    }
    dir.closeSync();
    const errs = (await Promise.all(fileChecks)).filter(function (x) { return x });
    if (errs.length > 0) {
        return `contains the following board files that are not readable and writable by the current user: "` +
            errs.join('", "') +
            `". Please make all board files accessible with chown 1000:1000.`
    }
}

/**
 * Checks that the output directory is writeable, 
 * ans exits the current process with an error otherwise.
 * @param {string} directory
 */
function check_output_directory(directory) {
    get_error(directory).then(function (error) {
        if (error) {
            console.error(
                `The configured history directory in which boards are stored ${error}.` +
                `\nThe history directory can be configured with the environment variable HISTORY_DIR. ` +
                `It is currently set to "${directory}".`
            );
            process.exit(1);
        }
    })
}

module.exports = check_output_directory