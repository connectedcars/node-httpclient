function HttpClientError(message, statusCode = null, timings = {}) {
  this.name = 'HttpClientError'
  this.statusCode = statusCode
  this.message = message
  this.timings = timings
  this.stack = new Error().stack
}
HttpClientError.prototype = Object.create(Error.prototype)
HttpClientError.prototype.constructor = HttpClientError

module.exports = HttpClientError
