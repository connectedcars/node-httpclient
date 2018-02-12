const UrlParser = require('url')
const http = require('http')
const https = require('https')
const zlib = require('zlib')

const HttpClientError = require('./httpclienterror')

class HttpClient {
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
    return new Promise((resolve, reject) => {
      endpoint.requests.push({
        httpRequester,
        httpOptions,
        data,
        maxResponseSize: options.maxResponseSize || this._maxResponseSize,
        resolve,
        reject,
        queuedTime: new Date().getTime(),
        queuedHrTime: process.hrtime()
      })
    })
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
    var httpRequest = httpRequester(httpOptions, response => {
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

      // Register data listeners
      let responseDataLength = 0
      let error = null
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
    httpRequest.end()

    // Increment outstanding as we just sent the request
    endpoint.outstanding++

    // Dequeue the request as it has been sent
    endpoint.requests.shift()
  }
}

module.exports = HttpClient
