const dgram = require("node:dgram");
const net = require("node:net");

/**
 * @typedef {{tcp: boolean, host: string, port: number, prefix?: string}} StatsdOptions
 */

class StatsdClient {
  /**
   * @param {StatsdOptions} options
   * @param {string=} prefix
   * @param {{
   *   udpSocket: dgram.Socket | null,
   *   udpErrorHandlerInstalled: boolean,
   *   tcpSocket: net.Socket | null,
   *   tcpConnected: boolean,
   *   tcpConnecting: boolean,
   * }=} transport
   */
  constructor(options, prefix, transport) {
    this.options = options;
    this.prefix = normalizePrefix(prefix ?? options.prefix ?? "");
    this.transport = transport ?? {
      udpSocket: options.tcp ? null : dgram.createSocket("udp4"),
      udpErrorHandlerInstalled: false,
      tcpSocket: null,
      tcpConnected: false,
      tcpConnecting: false,
    };

    if (this.transport.udpSocket && !this.transport.udpErrorHandlerInstalled) {
      this.transport.udpSocket.on("error", () => {});
      this.transport.udpErrorHandlerInstalled = true;
    }
  }

  /**
   * @param {string} name
   * @param {number=} delta
   * @param {{[name:string]: string}=} tags
   */
  increment(name, delta = 1, tags) {
    this.sendMetric(name, "c", delta, tags);
  }

  /**
   * @param {string} name
   * @param {number} value
   * @param {{[name:string]: string}=} tags
   */
  gauge(name, value, tags) {
    this.sendMetric(name, "g", value, tags);
  }

  /**
   * @param {string} name
   * @param {Date|number} start
   * @param {{[name:string]: string}=} tags
   */
  timing(name, start, tags) {
    const startedAt = start instanceof Date ? start.getTime() : start;
    this.sendMetric(name, "ms", Date.now() - startedAt, tags);
  }

  /**
   * @param {string} prefix
   * @returns {StatsdClient}
   */
  getChildClient(prefix) {
    return new StatsdClient(
      this.options,
      this.prefix + normalizePrefix(prefix),
      this.transport,
    );
  }

  /**
   * @param {string} name
   * @param {"c"|"g"|"ms"} type
   * @param {number} value
   * @param {{[name:string]: string}=} tags
   */
  sendMetric(name, type, value, tags) {
    const message = `${this.prefix}${name}:${value}|${type}${formatTags(tags)}`;
    this.send(message);
  }

  /**
   * @param {string} message
   */
  send(message) {
    const buffer = Buffer.from(message);
    if (!this.options.tcp) {
      if (!this.transport.udpSocket) return;
      this.transport.udpSocket.send(
        buffer,
        this.options.port,
        this.options.host,
        () => {},
      );
      return;
    }

    const socket = this.getTcpSocket();
    if (!socket || !this.transport.tcpConnected) {
      return;
    }
    socket.write(buffer);
    socket.write("\n");
  }

  /**
   * @returns {net.Socket | null}
   */
  getTcpSocket() {
    if (this.transport.tcpSocket || this.transport.tcpConnecting) {
      return this.transport.tcpSocket;
    }

    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port,
    });
    this.transport.tcpSocket = socket;
    this.transport.tcpConnecting = true;
    socket.on("connect", () => {
      this.transport.tcpConnected = true;
      this.transport.tcpConnecting = false;
    });
    socket.on("error", () => {
      this.transport.tcpConnected = false;
    });
    socket.on("close", () => {
      this.transport.tcpSocket = null;
      this.transport.tcpConnected = false;
      this.transport.tcpConnecting = false;
    });
    return socket;
  }
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function normalizePrefix(prefix) {
  return prefix ? prefix.replace(/[.]*$/, "") + "." : "";
}

/**
 * @param {{[name:string]: string}=} tags
 * @returns {string}
 */
function formatTags(tags) {
  if (!tags) {
    return "";
  }
  const tagList = Object.entries(tags).map(
    ([name, value]) => `${name}:${value}`,
  );
  if (tagList.length === 0) {
    return "";
  }
  return `|#${tagList.join(",")}`;
}

module.exports = StatsdClient;
