const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { logger } = require("./observability.js");

const { R_OK, W_OK } = fs.constants;

/**
 * Checks that the output directory is writeable
 * @param {string} directory
 * @returns {Promise<string | undefined>}
 */
async function getError(directory) {
  if (!fs.existsSync(directory)) {
    return "does not exist";
  }
  if (!fs.statSync(directory).isDirectory()) {
    return "exists, but is not a directory";
  }
  const tmpfile = path.join(directory, `${Math.random()}.json`);
  try {
    fs.writeFileSync(tmpfile, "{}");
    fs.unlinkSync(tmpfile);
  } catch (_e) {
    let errorMessage = "does not allow file creation and deletion. ";
    try {
      const { uid, gid } = os.userInfo();
      errorMessage +=
        "Check the permissions of the directory, and if needed change them so that " +
        `user with UID ${uid} has access to them. This can be achieved by running the command: chown ${uid}:${gid} on the directory`;
    } catch {}
    return errorMessage;
  }
  const fileChecks = [];
  const files = await fsp.readdir(directory, { withFileTypes: true });
  for (const elem of files) {
    if (/^board-(.*)\.json$/.test(elem.name)) {
      const elemPath = path.join(directory, elem.name);
      if (!elem.isFile())
        return `contains a board file named "${elemPath}" which is not a normal file`;
      fileChecks.push(fsp.access(elemPath, R_OK | W_OK).catch(() => elemPath));
    }
  }
  const errs = (await Promise.all(fileChecks)).filter((x) => x);
  if (errs.length > 0) {
    return `contains the following board files that are not readable and writable by the current user: "${errs.join(
      '", "',
    )}". Please make all board files accessible with chown 1000:1000`;
  }
  return undefined;
}

/**
 * Checks that the output directory is writeable,
 * and exits the current process with an error otherwise.
 * @param {string} directory
 */
function check_output_directory(directory) {
  getError(directory).then((error) => {
    if (error) {
      logger.error("history.dir_invalid", {
        directory,
        reason:
          `The configured history directory in which boards are stored ${error}. ` +
          `The history directory can be configured with the environment variable WBO_HISTORY_DIR. ` +
          `It is currently set to "${directory}".`,
      });
      process.exit(1);
    }
  });
}

module.exports = check_output_directory;
