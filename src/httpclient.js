const UrlParser = require('url')
const http = require('http')
const https = require('https')
const zlib = require('zlib')

const HttpClientError = require('./httpclienterror')
const HttpClientStream = require('./httpclientstream')

// Make vscode happy
const Agent = http.Agent

// TODO: Return refrences for request for bulk requests
// TODO: Figure out if bulk makes sense for stream
// TODO: Do lifecycle handling for sockets(needed for HTTP2 when doing ALPN)
//       and get rid of http.agent as we are handling most of the work anyway

/**
 * @typedef RequestOptions
 * @property {Agent}  [agent=null] Custom HTTP agent
 * @property {number} [timeout=60000] Timeout in ms
 * @property {number} [maxResponseSize=10485760] Max response size
 * @property {boolean} [keepAlive=false] Enable HTTP Keep alive
 * @property {string|Buffer} [ca=null] Trusted root certificate in pem format
 * @property {string|Buffer} [clientKey=null] Client private key in pem format
 * @property {string|Buffer} [clientCert=null] Client certificate in pem format
 * @property {string|Buffer} [clientPfx=null] Client certificate and private key in pfx format
 * @property {string} [clientPassphrase=null] Client private key passphrase
 * @property {boolean} [rejectUnauthorized=true] Reject on TLS/SSL validation error
 * @property {string} [secureProtocol=null] Allowed TLS/SSL protocols
 * @property {string} [ciphers=null] Allowed TLS/SSL ciphers
 * @property {boolean} [autoContentDecoding=true] Automatic content decoding
 * @property {boolean} [stream=false] Enable both write and read stream
 * @property {boolean} [writeStream=false] Enable write stream only
 * @property {boolean} [readStream=false] Enable read stream only
 */

/**
 * @typedef HttpResponse
 * @property {number} [statusCode] Status code
 * @property {string} [statusMessage] Status message
 * @property {Object} [headers] Headers
 * @property {Buffer} [data] Response data
 * @property {Object} [timings] Timing information
 * @property {number} [timings.queued] Queued timestamp in ms
 * @property {number} [timings.initialRequest]
 * @property {number} [timings.requestDataStarted]
 * @property {number} [timings.requestSent]
 * @property {number} [timings.initialResponse]
 * @property {number} [timings.responseDataStarted]
 * @property {number} [timings.responseReceived]
 */

class HttpClient {
  /**
   *
   * @param {Object} [options]
   * @param {Agent}  [options.agent=null] Custom HTTP agent
   * @param {number} [options.timeout=60000] Timeout in ms
   * @param {number} [options.maxResponseSize=10485760] Max response size
   * @param {boolean} [options.keepAlive=false] Enable HTTP Keep alive
   * @param {string|Buffer} [options.ca=null] Trusted root certificate
   * @param {string|Buffer} [options.clientKey=null] Client private key in pem format
   * @param {string|Buffer} [options.clientCert=null] Client certificate in pem format
   * @param {string|Buffer} [options.clientPfx=null] Client certificate and private key in pfx format
   * @param {string|Buffer} [options.clientPassphrase=null] Client private key passphrase
   * @param {string|Buffer} [options.rejectUnauthorized=true] Reject on TLS/SSL validation error
   * @param {string|Buffer} [options.secureProtocol=null] Allowed TLS/SSL protocols
   * @param {string|Buffer} [options.ciphers=null] Allowed TLS/SSL ciphers
   * @param {number} [options.maxConcurrent=10] Max concurrent connections towards and endpoint(protocol, host and port combination)
   * @param {number} [options.maxTotalConcurrent=100] Max total connections for this HttpClient
   * @param {boolean} [options.autoContentDecoding=true] Automatic content decoding
   */
  constructor(options = {}) {
    this._timeout = options.timeout || 60 * 1000
    this._maxResponseSize = options.maxResponseSize || 10 * 1024 * 1024
    this._keepAlive = options.keepAlive
    this._agent = options.agent
    this._ownAgents = []
    this._ca = options.ca
    this._clientKey = options.clientKey
    this._clientCert = options.clientCert
    this._clientPfx = options.clientPfx
    this._clientPassphrase = options.clientPassphrase
    this._rejectUnauthorized = options.rejectUnauthorized || true
    this._secureProtocol = options.secureProtocol
    this._ciphers = options.ciphers
    this._autoContentDecoding = options.autoContentDecoding || true
    this._defaultEndpoint = {
      maxConcurrent: options.maxConcurrent || 10,
      outstanding: 0,
      requests: [],
      global: {
        outstanding: 0,
        maxConcurrent: options.maxTotalConcurrent || 100
      }
    }
    this._endpoints = {}
  }

  /**
   *
   * @param {string} method Request method(GET, POST, PUT, PATCH, DELETE, HEAD)
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {Buffer|string} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  request(method, url, headers, data, options) {
    return /** @type {Promise<HttpResponse>} */ (this._request(
      method,
      [url],
      headers || {},
      data,
      options || {}
    )[0])
  }

  /**
   *
   * @param {string} method Request method(GET, POST, PUT, PATCH, DELETE, HEAD)
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {Buffer|string|Array<Buffer|string>} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  requestBatch(method, urls, headers, data, options) {
    return /** @type {Array<Promise<HttpResponse>>} */ (this._request(
      method,
      urls,
      headers || {},
      data,
      options || {}
    ))
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  getBatch(urls, headers, options) {
    return this.requestBatch('GET', urls, headers, null, options)
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {Buffer|string|Array<Buffer|string>} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  postBatch(urls, headers, data, options) {
    return this.requestBatch('POST', urls, headers, data, options)
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {Buffer|string|Array<Buffer|string>} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  putBatch(urls, headers, data, options) {
    return this.requestBatch('PUT', urls, headers, data, options)
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {Buffer|string|Array<Buffer|string>} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  patchBatch(urls, headers, data, options) {
    return this.requestBatch('PATCH', urls, headers, data, options)
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  deleteBatch(urls, headers, options) {
    return this.requestBatch('DELETE', urls, headers, null, options)
  }

  /**
   *
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>>}
   */
  headBatch(urls, headers, options) {
    return this.requestBatch('HEAD', urls, headers, null, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  get(url, headers = {}, options = {}) {
    return this.request('GET', url, headers, null, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {Buffer|string} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  post(url, headers, data, options = {}) {
    return this.request('POST', url, headers, data, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {Buffer|string} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  patch(url, headers, data, options = {}) {
    return this.request('PATCH', url, headers, data, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {Buffer|string} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  put(url, headers, data, options = {}) {
    return this.request('PUT', url, headers, data, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  delete(url, headers = {}, options = {}) {
    return this.request('DELETE', url, headers, null, options)
  }

  /**
   *
   * @param {string} url Request url
   * @param {Object} [headers] Request headers
   * @param {RequestOptions} [options] Request options
   * @returns {Promise<HttpResponse>}
   */
  head(url, headers = {}, options = {}) {
    return this.request('HEAD', url, headers, null, options)
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  requestStream(method, url, headers = {}, options = {}) {
    let requestOptions = Object.assign({ stream: true }, options || {})
    let stream = /** @type {HttpClientStream} */ (this._request(
      method,
      [url],
      headers || {},
      null,
      requestOptions
    )[0])
    return stream
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  getStream(url, headers, options = {}) {
    let requestOptions = Object.assign({ readStream: true }, options)
    let stream = this.requestStream('GET', url, headers, requestOptions)
    return stream
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  deleteStream(url, headers, options = {}) {
    let requestOptions = Object.assign({ readStream: true }, options)
    let stream = this.requestStream('DELETE', url, headers, requestOptions)
    return stream
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  postStream(url, headers, options = {}) {
    let requestOptions = Object.assign({ stream: true }, options)
    return this.requestStream('POST', url, headers, requestOptions)
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  putStream(url, headers, options = {}) {
    let requestOptions = Object.assign({ stream: true }, options)
    let stream = this.requestStream('PUT', url, headers, requestOptions)
    return stream
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  patchStream(url, headers, options = {}) {
    let requestOptions = Object.assign({ stream: true }, options)
    let stream = this.requestStream('PATCH', url, headers, requestOptions)
    return stream
  }

  /**
   * Close any open sockets
   */
  close() {
    for (let agent of this._ownAgents) {
      agent.destroy()
    }
  }

  /**
   * Internal function
   * @param {string} method Request method(GET, POST, PUT, PATCH, DELETE, HEAD)
   * @param {Array<string>} urls Request url
   * @param {Object|Array<Object>} [headers] Request headers
   * @param {Buffer|string|Array<Buffer|string>} [data] Request body
   * @param {RequestOptions} [options] Request options
   * @returns {Array<Promise<HttpResponse>|HttpClientStream>}
   */
  _request(method, urls, headers, data, options) {
    if (
      urls.length > 1 &&
      (options.stream || options.writeStream || options.readStream)
    ) {
      throw new Error(`Stream can not be mixed with batch`)
    }

    let defered = []
    let responsePromises = []
    for (let url of urls) {
      let pUrl = UrlParser.parse(url)

      // Build request and options
      let httpRequester
      let httpAgent
      let globalAgent
      if (pUrl.protocol === 'http:') {
        httpRequester = http.request
        httpAgent = http.Agent
        globalAgent = http.globalAgent
        pUrl.port = pUrl.port || '80'
      } else if (pUrl.protocol === 'https:') {
        httpRequester = https.request
        httpAgent = https.Agent
        globalAgent = https.globalAgent
        pUrl.port = pUrl.port || '443'
      } else {
        throw Error(`Unknown url type: ${url}`)
      }

      // Setup endpoint
      let endpointName = `${pUrl.protocol}//${pUrl.hostname}:${pUrl.port}/`
      let endpoint = this._endpoints[endpointName]
      if (!endpoint) {
        endpoint = Object.assign({}, this._defaultEndpoint)
        endpoint.name = endpointName
        if (options.agent || this._agent) {
          endpoint.agent = options.agent || this._agent
        } else if (this._keepAlive || options.keepAlive) {
          endpoint.agent = new httpAgent({ keepAlive: true })
          this._ownAgents.push(endpoint.agent)
        } else {
          endpoint.agent = globalAgent
        }
        this._endpoints[endpointName] = endpoint
      }

      let httpOptions = {
        host: pUrl.hostname,
        port: pUrl.port,
        path: pUrl.path,
        method: method,
        auth: pUrl.auth,
        headers: Array.isArray(headers) ? headers.shift() : headers,
        agent: endpoint.agent,
        ca: options.ca || this._ca,
        key: options.clientKey || this._clientKey,
        cert: options.clientCert || this._clientCert,
        rejectUnauthorized:
          options.rejectUnauthorized || this._rejectUnauthorized,
        secureProtocol: options.secureProtocol || this._secureProtocol,
        ciphers: options.ciphers || this._ciphers,
        timeout: options.timeout || this._timeout
      }

      // Register for queue processing after we return the promise
      process.nextTick(_processQueue, endpoint)

      // Create stream
      let stream = null
      if (options.stream && !options.writeStream && !options.readStream) {
        options.writeStream = true
        options.readStream = true
      }
      if (options.writeStream || options.readStream) {
        stream = new HttpClientStream()
      }

      // Add to request queue
      let responsePromise = new Promise((resolve, reject) => {
        defered.push({
          resolve,
          reject
        })
        endpoint.requests.push({
          requestInfo: {
            method: httpOptions.method,
            url,
            headers: httpOptions.headers
          },
          httpRequester,
          httpOptions,
          data: Array.isArray(data) ? data.shift() : data,
          defered,
          stream,
          writeStream: options.writeStream,
          readStream: options.readStream,
          autoContentDecoding:
            typeof options.autoContentDecoding === 'boolean'
              ? options.autoContentDecoding
              : this._autoContentDecoding,
          maxResponseSize: options.maxResponseSize || this._maxResponseSize,
          queuedTime: new Date().getTime(),
          queuedHrTime: process.hrtime()
        })
      })

      if (stream) {
        stream.response = responsePromise
        responsePromises.push(stream)
      } else {
        responsePromises.push(responsePromise)
      }
    }
    return responsePromises
  }
}

function _processQueue(endpoint) {
  while (endpoint.requests.length > 0) {
    /* console.log(
      `_processQueue: ${endpoint.outstanding} : ${endpoint.global.outstanding}`
    )*/
    if (endpoint.global.outstanding >= endpoint.global.maxConcurrent) {
      break
    }
    let request = endpoint.requests[0]
    if (endpoint.outstanding >= endpoint.maxConcurrent) {
      break
    }

    // Timings
    let initialRequestTime
    let requestDataStartedTime
    let requestSentTime
    let initialResponseTime
    let responseDataStartedTime
    let responseReceivedTime

    const hrDiff = (start, end) =>
      (end[0] - start[0]) * 1000 + (end[1] - start[1]) / 1000000

    const calculateTimings = () => ({
      queued: request.queuedTime,
      initialRequest: hrDiff(request.queuedHrTime, initialRequestTime),
      requestDataStarted: hrDiff(initialRequestTime, requestDataStartedTime),
      requestSent: hrDiff(requestDataStartedTime, requestSentTime),
      initialResponse: hrDiff(requestSentTime, initialResponseTime),
      responseDataStarted: hrDiff(initialResponseTime, responseDataStartedTime),
      responseReceived: hrDiff(responseDataStartedTime, responseReceivedTime)
    })

    // Create and send the request
    let responseData = []
    initialRequestTime = process.hrtime()
    let httpRequester = request.httpRequester
    let httpOptions = request.httpOptions
    let httpRequest = httpRequester(httpOptions, response => {
      initialResponseTime = process.hrtime()
      responseDataStartedTime = initialResponseTime // Initial value if we get no body

      let responseStream = response
      // Setup content decoding
      if (request.autoContentDecoding) {
        switch (response.headers['content-encoding']) {
          case 'gzip': {
            responseStream = response.pipe(zlib.createGunzip())
            break
          }
          case 'deflate': {
            responseStream = response.pipe(zlib.createInflate())
            break
          }
        }
      }

      let error = null
      if (request.readStream) {
        request.stream._addReadableStream(responseStream)
        responseStream = request.stream
      } else {
        // Register data listeners
        let responseDataLength = 0
        responseStream.on('data', chunk => {
          if (responseData.length === 0) {
            responseDataStartedTime = process.hrtime()
          }
          responseDataLength += chunk.length
          if (responseDataLength <= request.maxResponseSize) {
            responseData.push(chunk)
          } else {
            response.destroy()
            error = 'Response too lange'
          }
        })
      }
      responseStream.on('end', () => {
        if (request.defered.length > 0) {
          responseReceivedTime = process.hrtime()
          endpoint.outstanding--
          endpoint.global.outstanding--
          if (!error) {
            request.defered.shift().resolve({
              request: request.requestInfo,
              timings: calculateTimings(),
              statusCode: response.statusCode,
              statusMessage: response.statusMessage,
              headers: response.headers,
              data: Buffer.concat(responseData)
            })
          } else {
            request.defered
              .shift()
              .reject(
                new HttpClientError(
                  request.requestInfo,
                  error,
                  null,
                  calculateTimings()
                )
              )
          }
        }
        process.nextTick(_processQueue, endpoint) // Register for queue processing
      })
    })
    httpRequest.on('timeout', () => {
      endpoint.outstanding--
      endpoint.global.outstanding--
      initialResponseTime = process.hrtime()
      responseDataStartedTime = initialResponseTime
      responseReceivedTime = responseDataStartedTime
      httpRequest.abort()
      /* istanbul ignore next: we should never have a case where timeout is called and defered is empty */
      if (request.defered.length > 0) {
        request.defered
          .shift()
          .reject(
            new HttpClientError(
              request.requestInfo,
              'Timeout',
              null,
              calculateTimings()
            )
          )
      }
      process.nextTick(_processQueue, endpoint) // Register for queue processing
    })
    httpRequest.on('error', e => {
      endpoint.outstanding--
      endpoint.global.outstanding--
      if (request.defered.length > 0) {
        request.defered.shift().reject(e)
      }
      process.nextTick(_processQueue, endpoint) // Register for queue processing
    })

    // Send body data
    requestDataStartedTime = process.hrtime()
    requestSentTime = requestDataStartedTime // Set value if we have no data to send
    if (request.data) {
      httpRequest.write(request.data, () => {
        requestSentTime = process.hrtime()
      })
    }

    if (request.writeStream) {
      request.stream._addClientRequest(httpRequest)
    } else {
      httpRequest.end()
    }

    // Increment outstanding as we just sent the request
    endpoint.outstanding++
    endpoint.global.outstanding++

    // Dequeue the request as it has been sent
    endpoint.requests.shift()
  }
}

module.exports = HttpClient
