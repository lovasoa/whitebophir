const path = require("path");
const app_root = path.dirname(__dirname); // Parent of the directory where this file is

module.exports = {
    /** Port on which the application will listen */
    PORT: parseInt(process.env['PORT']) || 8080,

    /** Path to the directory where boards will be saved by default */
    HISTORY_DIR: process.env['WBO_HISTORY_DIR'] || path.join(app_root, "server-data"),

    /** Folder from which static files will be served */
    WEBROOT: process.env['WBO_WEBROOT'] || path.join(app_root, "client-data"),

    /** Number of milliseconds of inactivity after which the board should be saved to a file */
    SAVE_INTERVAL: parseInt(process.env['WBO_SAVE_INTERVAL']) || 1000 * 2, // Save after 2 seconds of inactivity

    /** Periodicity at which the board should be saved when it is being actively used (milliseconds)  */
    MAX_SAVE_DELAY: parseInt(process.env['WBO_MAX_SAVE_DELAY']) || 1000 * 60, // Save after 60 seconds even if there is still activity

    /** Maximal number of items to keep in the board. When there are more items, the oldest ones are deleted */
    MAX_ITEM_COUNT: parseInt(process.env['WBO_MAX_ITEM_COUNT']) || 32768,

    /** Max number of sub-items in an item. This prevents flooding */
    MAX_CHILDREN: parseInt(process.env['WBO_MAX_CHILDREN']) || 128,

    /** Maximum value for any x or y on the board */
    MAX_BOARD_SIZE: parseInt(process.env['WBO_MAX_BOARD_SIZE']) || 65536,

    /** Path at which the app is served (without leading, but with trailing slash) */
    URL_PREFIX_PATH: parseInt(process.env['WBO_URL_PREFIX_PATH']) || "",
};