/**
 * Add a message to the logs
 * @param {string} type
 * @param {any} infos
 */
function log(type, infos) {
  var msg = new Date().toISOString() + "\t" + type;
  if (infos) msg += "\t" + JSON.stringify(infos);
  console.log(msg);
}

module.exports.log = log;
