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
    this.destroyed = false
    this.destroyCallback = null
    this.destroyedError = null
    this.clientRequestDestroyed = false
    this.readableStreamDestroyed = false
  }

  /**
   * @returns {boolean}
   */
  isPendingRead() {
    return this.reads.length > 0
  }

  /**
   *
   * @param {ClientRequest} clientRequest
   */
  _addClientRequest(clientRequest) {
    this.clientRequest = clientRequest

    if (this.destroyed) {
      return this._destroy(this.destroyedError, this.destroyCallback)
    }

    while (this.writes.length > 0) {
      let [chunk, callback] = this.writes.splice(0, 2)
      this.clientRequest.write(chunk)
      callback()
    }

    // Node does a nextTick so we should never hit this code, but lets be sure anyway
    /* istanbul ignore if */
    if (this.ended) {
      this.clientRequest.end()
      this.ended()
    }
  }

  /**
   *
   * @param {Readable} readableStream
   */
  _addReadableStream(readableStream) {
    this.readableStream = readableStream

    // Node does a nextTick so we should never hit this code, but lets be sure anyway
    /* istanbul ignore if */
    if (this.destroyed) {
      return this._destroy(this.destroyedError, this.destroyCallback)
    }

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
    /* istanbul ignore else */
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
    this.destroyed = true
    this.destroyCallback = callback
    this.destroyedError = err
    if (this.clientRequest && !this.clientRequestDestroyed) {
      this.clientRequest.destroy(err)
      this.clientRequestDestroyed = true
    }
    if (this.readableStream && !this.readableStreamDestroyed) {
      this.readableStream.destroy(err)
      this.readableStreamDestroyed = true
    }
    if (this.clientRequestDestroyed && this.readableStreamDestroyed) {
      this.destroyCallback()
    }
  }
}

module.exports = HttpClientStream
