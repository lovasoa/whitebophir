const config = require("./configuration.js"),
  SDC = require("statsd-client");

/**
 * Parse a statsd connection string
 * @param {string} url
 * @returns {SDC.TcpOptions|SDC.UdpOptions}
 */
function parse_statsd_url(url) {
  const regex = /^(tcp|udp|statsd):\/\/(.*):(\d+)$/;
  const match = url.match(regex);
  if (!match)
    throw new Error("Invalid statsd connection string, doesn't match " + regex);
  const [_, protocol, host, port_str] = match;
  const tcp = protocol === "tcp";
  const port = parseInt(port_str);
  return { tcp, host, port, prefix: "wbo" };
}

/**
 * Statsd client to which metrics will be reported
 * @type {SDC | null}
 * */
let statsd = null;

if (config.STATSD_URL) {
  const options = parse_statsd_url(config.STATSD_URL);
  console.log("Exposing metrics on statsd server: " + JSON.stringify(options));
  statsd = new SDC(options);
}

if (statsd) {
  setInterval(function reportHealth(){
    statsd.gauge('memory', process.memoryUsage().heapUsed);
  }, 1000);
}

/**
 * Add a message to the logs
 * @param {string} type
 * @param {any} infos
 */
function log(type, infos) {
  var msg = type;
  if (infos) msg += "\t" + JSON.stringify(infos);
  if (statsd) {
    const tags = {};
    if (infos.board) tags.board = infos.board;
    if (infos.original_ip) tags.original_ip = infos.original_ip;
    statsd.increment(type, 1, tags);
  }
  console.log(msg);
}

/**
 * @template {(...args) => any} F
 * @param {F} f
 * @returns {F}
 */
function monitorFunction(f) {
  if (statsd) return statsd.helpers.wrapCallback(f.name, f);
  else return f;
}

/**
 * Report a number
 * @param {string} name 
 * @param {number} value 
 * @param {{[name:string]: string}=} tags
 */
function gauge(name, value, tags){
  if (statsd) statsd.gauge(name, value, tags);
}

module.exports = { log, gauge, monitorFunction };
