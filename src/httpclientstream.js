const { Duplex } = require('stream')

// To make vscode happy
const http = require('http')
const stream = require('stream')
const Readable = stream.Readable
const ClientRequest = http.ClientRequest

class HttpClientStream extends Duplex {
  /**
   *
   * @param {Object} [options]
   * @param {number} [options.highWaterMark]
   */
  constructor(options) {
    super(options)
    this.response = null
    this.clientRequest = null
    this.readableStream = null
    this.reads = []
    this.writes = []
    this.ended = null
    this.readable = false
  }

  /**
   *
   * @param {ClientRequest} clientRequest
   */
  addClientRequest(clientRequest) {
    this.clientRequest = clientRequest
    while (this.writes.length > 0) {
      let [chunk, callback] = this.writes.splice(0, 2)
      this.clientRequest.write(chunk)
      callback()
    }
    if (this.ended) {
      this.clientRequest.end()
      this.ended()
    }
  }

  /**
   *
   * @param {Readable} readableStream
   */
  addReadableStream(readableStream) {
    this.readableStream = readableStream
    this.readableStream.on('readable', () => {
      if (this.reads.shift()) {
        this.push(this.readableStream.read())
        this.readable = false
      } else {
        this.readable = true
      }
    })
    this.readableStream.on('end', () => {
      this.push(null)
    })
  }

  /**
   *
   * @param {number} size
   */
  _read(size) {
    if (this.readable) {
      this.push(this.readableStream.read())
      this.readable = false
    } else {
      this.reads.push(size)
    }
  }

  /**
   *
   * @param {Buffer} chunk
   * @param {string} encoding
   * @param {Function} callback
   */
  _write(chunk, encoding, callback) {
    if (this.clientRequest) {
      this.clientRequest.write(chunk, callback)
    } else {
      this.writes.push(chunk, callback)
    }
  }

  /**
   *
   * @param {Function} callback
   */
  _final(callback) {
    if (this.clientRequest) {
      this.clientRequest.end()
      callback()
    }
    this.ended = callback
  }

  /**
   *
   * @param {Error} err
   * @param {Function} callback
   */
  _destroy(err, callback) {
    if (this.clientRequest) {
      this.clientRequest.destroy(err)
    }
    if (this.readableStream) {
      this.readableStream.destroy(err)
    }
    callback()
  }
}

module.exports = HttpClientStream
