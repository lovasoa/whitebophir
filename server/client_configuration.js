const config = require("./configuration");

/** Settings that should be handed through to the clients  */
module.exports = {
    "MAX_DOCUMENT_SIZE": config.MAX_DOCUMENT_SIZE,
    "MAX_DOCUMENT_COUNT": config.MAX_DOCUMENT_COUNT,
    "MAX_BOARD_SIZE": config.MAX_BOARD_SIZE,
    "MAX_EMIT_COUNT": config.MAX_EMIT_COUNT,
    "MAX_EMIT_COUNT_PERIOD": config.MAX_EMIT_COUNT_PERIOD,
    "BLOCKED_TOOLS": config.BLOCKED_TOOLS,
};