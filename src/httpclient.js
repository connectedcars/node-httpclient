const UrlParser = require('url')
const http = require('http')
const https = require('https')
const zlib = require('zlib')

const HttpClientError = require('./httpclienterror')
const HttpClientStream = require('./httpclientstream')

class HttpClient {
  /**
   *
   * @param {Object} [options]
   * @param {number} [options.timeout]
   * @param {boolean} [options.keepAlive]
   * @param {number} [options.maxResponseSize]
   * @param {string} [options.ca]
   * @param {number} [options.maxConcurrent]
   * @param {number} [options.maxTotalConcurrent]
   */
  constructor(options = {}) {
    this._timeout = options.timeout || 60 * 1000
    this._maxResponseSize = options.maxResponseSize || 10 * 1024 * 1024
    this._keepAlive = options.keepAlive
    this._ca = options.ca
    this._maxTotalConcurrent = options.maxTotalConcurrent || 100
    this._totalOutstanding = 0
    this._defaultEndpoint = {
      maxConcurrent: options.maxConcurrent || 10,
      outstanding: 0,
      requests: []
    }
    this._endpoints = {}
  }

  /**
   *
   * @param {string} method
   * @param {string} url
   * @param {Object} [headers]
   * @param {Buffer} [data]
   * @param {Object} [options]
   * @param {number} [options.timeout]
   * @param {number} [options.keepAlive]
   * @param {number} [options.maxResponseSize]
   * @param {string} [options.ca]
   * @param {boolean} [options.stream]
   * @returns {any}
   */
  request(method, url, headers = {}, data = null, options = {}) {
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
      if (this._keepAlive || options.keepAlive) {
        endpoint.agent = new httpAgent({ keepAlive: true })
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
      headers: headers,
      agent: endpoint.agent,
      ca: options.ca || this._ca,
      timeout: options.timeout || this._timeout
    }

    // Register for queue processing after we return the promise
    process.nextTick(_processQueue, endpoint)

    // Add to request queue
    let stream = options.stream ? new HttpClientStream() : null
    let responsePromise = new Promise((resolve, reject) => {
      endpoint.requests.push({
        httpRequester,
        httpOptions,
        data,
        resolve,
        reject,
        stream,
        maxResponseSize: options.maxResponseSize || this._maxResponseSize,
        queuedTime: new Date().getTime(),
        queuedHrTime: process.hrtime()
      })
    })
    if (stream) {
      stream.response = responsePromise
    }

    return options.stream ? stream : responsePromise
  }

  get(url, headers, options) {
    return this.request('GET', url, headers, null, options)
  }

  post(url, headers, data, options) {
    return this.request('POST', url, headers, data, options)
  }

  patch(url, headers, data, options) {
    return this.request('PATCH', url, headers, data, options)
  }

  put(url, headers, data, options) {
    return this.request('PUT', url, headers, data, options)
  }

  delete(url, headers, options) {
    return this.request('DELETE', url, headers, null, options)
  }

  head(url, headers, options) {
    return this.request('HEAD', url, headers, null, options)
  }

  /**
   *
   * @param {string} [url]
   * @param {Object} [headers]
   * @param {Object} [options]
   * @returns {HttpClientStream}
   */
  requestStream(method, url, headers, options = {}) {
    let requestOptions = Object.assign({ stream: true }, options)
    let stream = this.request(method, url, headers, null, requestOptions)
    stream.end()
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
    let requestOptions = Object.assign({ stream: true }, options)
    let stream = this.request('GET', url, headers, null, requestOptions)
    stream.end()
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
    let requestOptions = Object.assign({ stream: true }, options)
    let stream = this.request('DELETE', url, headers, null, requestOptions)
    stream.end()
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
    return this.request('POST', url, headers, null, requestOptions)
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
    let stream = this.request('PUT', url, headers, null, requestOptions)
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
    let stream = this.request('PATCH', url, headers, null, requestOptions)
    return stream
  }
}

function _processQueue(endpoint) {
  //console.log(`_processQueue: ${endpoint.outstanding}`)
  while (endpoint.requests.length > 0) {
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

      // Setup content decoding
      let responseStream
      switch (response.headers['content-encoding']) {
        case 'gzip': {
          responseStream = response.pipe(zlib.createGunzip())
          break
        }
        case 'deflate': {
          responseStream = response.pipe(zlib.createInflate())
          break
        }
        default: {
          responseStream = response
        }
      }

      let error = null
      if (request.stream) {
        //responseStream.pause()
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
        responseReceivedTime = process.hrtime()
        endpoint.outstanding--
        if (!error) {
          request.resolve({
            timings: calculateTimings(),
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            data: Buffer.concat(responseData)
          })
        } else {
          request.reject(new HttpClientError(error, null, calculateTimings()))
        }
        process.nextTick(_processQueue, endpoint) // Register for queue processing
      })
    })
    httpRequest.on('timeout', () => {
      endpoint.outstanding--
      initialResponseTime = process.hrtime()
      responseDataStartedTime = initialResponseTime
      responseReceivedTime = responseDataStartedTime
      request.reject(new HttpClientError('Timeout', null, calculateTimings()))
      process.nextTick(_processQueue, endpoint) // Register for queue processing
    })
    httpRequest.on('error', e => {
      endpoint.outstanding--
      request.reject(e)
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

    if (request.stream) {
      request.stream._addClientRequest(httpRequest)
    } else {
      httpRequest.end()
    }

    // Increment outstanding as we just sent the request
    endpoint.outstanding++

    // Dequeue the request as it has been sent
    endpoint.requests.shift()
  }
}

module.exports = HttpClient
