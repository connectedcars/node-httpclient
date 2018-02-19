const expect = require('unexpected')

const fs = require('fs')
const zlib = require('zlib')
const http = require('http')

const HttpClient = require('./httpclient')
const HttpClientError = require('./httpclienterror')
const AsyncUtils = require('./asyncutils')

const {
  createTestHttpServer,
  createTestHttpsServer,
  tmpFile
} = require('./testutils')

const localhostCertificate = fs.readFileSync(
  `${__dirname}/../resources/localhost.crt`
)
const localhostPrivateKey = fs.readFileSync(
  `${__dirname}/../resources/localhost.key`
)

describe('HttpClient', () => {
  let [httpServer, httpListenPromise] = createTestHttpServer((req, res) => {
    let match
    if ((match = req.url.match(/^\/delay\/(\d+)/))) {
      setTimeout(() => {
        let chunks = []
        req.on('data', chunk => {
          chunks.push(chunk)
        })
        req.on('end', () => {
          res.end(match[1] + Buffer.concat(chunks).toString('utf8'))
        })
      }, parseInt(match[1]))
    } else if (['PUT', 'PATCH', 'DELETE'].indexOf(req.method) >= 0) {
      res.end(req.method)
    } else if (['HEAD'].indexOf(req.method) >= 0) {
      res.end()
    } else if (req.url === '/timeout') {
      //
    } else if (req.url === '/timeout_with_data') {
      res.write('.')
    } else if (req.url === '/large_response') {
      res.statusCode = 200
      res.end('x'.repeat(1024))
    } else if (req.url === '/chunked') {
      res.statusCode = 200
      res.write('x')
      setTimeout(() => {
        res.end('x')
      })
    } else if (req.url === '/echo') {
      res.statusCode = 200
      req.on('data', data => {
        res.write(data)
      })
      req.on('end', () => {
        res.end()
      })
    } else if (req.url === '/ok') {
      res.end('OK')
    } else if (req.url === '/gzip') {
      let gziped = zlib.gzipSync('ok')
      res.setHeader('content-encoding', 'gzip')
      res.end(gziped)
    } else if (req.url === '/deflate') {
      let deflated = zlib.deflateSync('ok')
      res.setHeader('content-encoding', 'deflate')
      res.end(deflated)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  let [httpsServer, httpsListenPromise] = createTestHttpsServer(
    { cert: localhostCertificate, key: localhostPrivateKey },
    (req, res) => {
      res.statusCode = 200
      res.end()
    }
  )

  let [resetServer, resetServerPromise] = createTestHttpServer((req, res) => {})

  // Setup httpRequestHandler
  let httpBaseUrl = null
  let httpsBaseUrl = null
  let resetPort = null
  before(done => {
    Promise.all([
      httpListenPromise,
      httpsListenPromise,
      resetServerPromise
    ]).then(results => {
      let httpPort = results[0].port
      let httpsPort = results[1].port
      resetPort = results[2].port
      console.log(`    Listining on 127.0.0.1:${httpPort} for http`)
      console.log(`    Listining on 127.0.0.1:${httpsPort} for https`)
      httpBaseUrl = `http://localhost:${httpPort}`
      httpsBaseUrl = `https://localhost:${httpsPort}`
      done()
    })
  })

  after(() => {
    httpServer.close()
    httpsServer.close()
  })

  it('should return 200 ok', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/ok`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok', () => {
    let httpClient = new HttpClient()
    let response = httpClient.request('GET', `${httpBaseUrl}/ok`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok with agent', () => {
    let httpClient = new HttpClient({
      agent: new http.Agent({ keepAlive: true })
    })
    let response = httpClient.get(`${httpBaseUrl}/ok`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok from gzip content-encoding', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/gzip`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('ok')
    })
  })

  it('should return 200 gzip ok because autoContentDecoding is disabled ', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/gzip`, null, {
      autoContentDecoding: false
    })
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: zlib.gzipSync('ok')
    })
  })

  it('should return 200 ok from deflate content-encoding', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/deflate`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('ok')
    })
  })

  it('should return 200: DELETE', () => {
    let httpClient = new HttpClient()
    let response = httpClient.delete(`${httpBaseUrl}/`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('DELETE', 'utf8')
    })
  })

  it('should return 200: PUT', () => {
    let httpClient = new HttpClient()
    let response = httpClient.put(`${httpBaseUrl}/`, null, 'Hello')
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('PUT', 'utf8')
    })
  })

  it('should return 200: PATCH', () => {
    let httpClient = new HttpClient()
    let response = httpClient.patch(`${httpBaseUrl}/`, null, 'Hello')
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('PATCH', 'utf8')
    })
  })

  it('should return 200: HEAD', () => {
    let httpClient = new HttpClient()
    let response = httpClient.head(`${httpBaseUrl}/`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok 4 times with 2 in parallel', () => {
    let httpClient = new HttpClient({ maxConcurrent: 2, keepAlive: true })
    let promises = []
    for (let i = 0; i < 4; i++) {
      promises.push(httpClient.get(`${httpBaseUrl}/ok`))
    }

    return expect(
      Promise.all(promises),
      'to be fulfilled with value satisfying',
      [
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        }
      ]
    )
  })

  it('should return 200 ok 8 times with 2 in parallel on http and https', function() {
    this.slow(500)
    let httpClient = new HttpClient({
      maxConcurrent: 2,
      maxTotalConcurrent: 4,
      keepAlive: true
    })
    let promises = []
    for (let i = 0; i < 4; i++) {
      promises.push(httpClient.get(`${httpBaseUrl}/ok`))
      promises.push(
        httpClient.get(`${httpsBaseUrl}/ok`, null, { ca: localhostCertificate })
      )
    }

    return expect(
      Promise.all(promises),
      'to be fulfilled with value satisfying',
      [
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        },
        {
          statusMessage: 'OK'
        }
      ]
    )
  })

  it('should return 200 ok for chunked reply', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/chunked`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('xx')
    })
  })

  it('should return 200 ok for https', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(httpsBaseUrl, null, {
      ca: localhostCertificate
    })
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200
    })
  })

  it('should return 302 from http://google.com', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let response = httpClient.get(`http://google.com`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: expect.it('to be within', 301, 302)
    })
  })

  it('should return 302 from https://google.com', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let response = httpClient.get(`https://google.com`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: expect.it('to be within', 301, 302)
    })
  })

  it('should return 404', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(httpBaseUrl)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 404
    })
  })

  it('should return too large', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/large_response`, null, {
      maxResponseSize: 512
    })
    return expect(
      response,
      'to be rejected with error satisfying',
      new HttpClientError('Response too lange')
    )
  })

  it('should return POST data', () => {
    let httpClient = new HttpClient()
    let response = httpClient.post(`${httpBaseUrl}/echo`, null, 'Hello')
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200
    })
  })

  it('should timeout', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/timeout`, null, {
      timeout: 1
    })
    return expect(
      response,
      'to be rejected with error satisfying',
      new HttpClientError('Timeout')
    )
  })

  it('should timeout with a little data sent', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/timeout_with_data`, null, {
      timeout: 100
    })
    return expect(
      response,
      'to be rejected with error satisfying',
      new HttpClientError('Timeout')
    )
  })

  it('should fail with ECONNREFUSED', done => {
    let httpClient = new HttpClient()
    resetServer.close(() => {
      let response = httpClient.get(`http://localhost:${resetPort}`, null)
      expect(
        response,
        'to be rejected with error satisfying',
        new Error(`connect ECONNREFUSED 127.0.0.1:${resetPort}`)
      )
        .then(() => {
          done()
        })
        .catch(e => {
          done(e)
        })
    })
  })

  it('should fail with unknown protocol', () => {
    let httpClient = new HttpClient()
    return expect(
      () => {
        httpClient.get(`sftp://localhost/`, null)
      },
      'to throw',
      'Unknown url type: sftp://localhost/'
    )
  })

  it('should fail with batch stream mixed', () => {
    let httpClient = new HttpClient()
    return expect(
      () => {
        httpClient.getBatch([`${httpBaseUrl}/ok`, `${httpBaseUrl}/ok`], null, {
          stream: true
        })
      },
      'to throw',
      'Stream can not be mixed with batch'
    )
  })

  it('should return 200 for stream GET', () => {
    let httpClient = new HttpClient()

    let stream = httpClient.getStream(`${httpBaseUrl}/ok`)
    let chunks = []
    stream.on('data', chunk => {
      chunks.push(chunk)
    })

    return stream.response.then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        Buffer.concat(chunks).toString('utf8'),
        'to equal',
        'OK'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should return 200 for stream GET without error', () => {
    let httpClient = new HttpClient()
    let stream = httpClient.requestStream(
      'GET',
      `${httpBaseUrl}/ok`,
      null,
      null
    )
    let chunks = []
    stream.on('data', chunk => {
      chunks.push(chunk)
    })
    stream.end()

    return stream.response.then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        Buffer.concat(chunks).toString('utf8'),
        'to equal',
        'OK'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should return 200 for stream DELETE', () => {
    let httpClient = new HttpClient()

    let stream = httpClient.deleteStream(`${httpBaseUrl}/`)
    let chunks = []
    stream.on('data', chunk => {
      chunks.push(chunk)
    })

    return stream.response.then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        Buffer.concat(chunks).toString('utf8'),
        'to equal',
        'DELETE'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should return 200 for stream PUT', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let testStream = fs.createWriteStream(testFile)
    let testStreamPromise = AsyncUtils.streamOnAsync(testStream, 'finish')

    let stream = httpClient.putStream(`${httpBaseUrl}/echo`)
    stream.pipe(testStream)
    stream.write('Hello')
    stream.end()

    return testStreamPromise.then(() => stream.response).then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        fs.readFileSync(testFile, 'utf8'),
        'to equal',
        'PUT'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should return 200 for stream PATCH', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let testStream = fs.createWriteStream(testFile)
    let testStreamPromise = AsyncUtils.streamOnAsync(testStream, 'finish')

    let stream = httpClient.patchStream(`${httpBaseUrl}/echo`)
    stream.pipe(testStream)
    stream.write('Hello')
    stream.end()

    return testStreamPromise.then(() => stream.response).then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        fs.readFileSync(testFile, 'utf8'),
        'to equal',
        'PATCH'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should return 200 for stream request', () => {
    let httpClient = new HttpClient()

    let stream = httpClient.requestStream('GET', `${httpBaseUrl}/ok`)
    stream.end()
    let chunks = []
    stream.on('data', chunk => {
      chunks.push(chunk)
    })

    return stream.response.then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        Buffer.concat(chunks).toString('utf8'),
        'to equal',
        'OK'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should post stream Hello with postStream and get body in response', () => {
    let httpClient = new HttpClient()

    let stream = httpClient.postStream(`${httpBaseUrl}/echo`, null, {
      writeStream: true
    })
    stream.end('Hello')

    return stream.response.then(response => {
      return expect(response, 'to satisfy', {
        statusCode: 200,
        data: Buffer.from('Hello', 'utf8')
      })
    })
  })

  it('should post stream Hello with postStream', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let testStream = fs.createWriteStream(testFile)
    let testStreamPromise = AsyncUtils.streamOnAsync(testStream, 'finish')

    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.pipe(testStream)
    stream.write('Hello')
    stream.end()

    return testStreamPromise.then(() => stream.response).then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        fs.readFileSync(testFile, 'utf8'),
        'to equal',
        'Hello'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should stream HelloHelloHello with postStream and delayed writes', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let testStream = fs.createWriteStream(testFile)
    let testStreamPromise = AsyncUtils.streamOnAsync(testStream, 'finish')

    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.pipe(testStream)
    stream.write('Hello')
    setTimeout(() => {
      stream.write('Hello')
    }, 10)
    setTimeout(() => {
      stream.write('Hello')
      stream.end()
    }, 20)

    return testStreamPromise.then(() => stream.response).then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        fs.readFileSync(testFile, 'utf8'),
        'to equal',
        'HelloHelloHello'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should stream HelloHello with postStream and delayed pipe setup', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let testStream = fs.createWriteStream(testFile)
    let testStreamPromise = AsyncUtils.streamOnAsync(testStream, 'finish')

    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.write('Hello')
    setTimeout(() => {
      stream.pipe(testStream)
      stream.write('Hello')
    }, 10)
    setTimeout(() => {
      stream.write('Hello')
      stream.end()
    }, 20)

    return testStreamPromise.then(() => stream.response).then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(
        fs.readFileSync(testFile, 'utf8'),
        'to equal',
        'HelloHelloHello'
      )
      return Promise.all([responseRes, chunksRes])
    })
  })

  it('should stream HelloHello with postStream and own setup', () => {
    let httpClient = new HttpClient()

    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.write('Hello')

    let chunks = []
    let endCount = 0
    setTimeout(() => {
      stream.on('data', chunk => {
        chunks.push(chunk.toString('utf8'))
      })
      stream.on('end', () => {
        endCount++
      })
      stream.write('Hello')
    }, 10)
    setTimeout(() => {
      stream.write('Hello')
      stream.end()
    }, 20)

    return stream.response.then(response => {
      let responseRes = expect(response, 'to satisfy', {
        statusCode: 200
      })
      let chunksRes = expect(chunks.join(''), 'to equal', 'HelloHelloHello')
      let endCountRes = expect(endCount, 'to equal', 1)
      return Promise.all([responseRes, chunksRes, endCountRes])
    })
  })

  it('should fail on stream destroy with socket hang up', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    stream.destroy()

    return expect(
      stream.response,
      'to be rejected with error satisfying',
      new Error('socket hang up')
    )
  })

  it('should succeed on stream destroy after data recieved', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let stream = httpClient.postStream(`${httpBaseUrl}/timeout_with_data`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.end()
    stream.on('data', () => {
      stream.destroy()
    })

    return expect(stream.response, 'to be fulfilled with value satisfying', {
      statusCode: 200
    })
  })

  it('should return bulk get results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.getBatch(
      [
        `${httpBaseUrl}/delay/300`,
        `${httpBaseUrl}/delay/100`,
        `${httpBaseUrl}/delay/200`,
        `${httpBaseUrl}/delay/400`
      ],
      [
        {
          'Content-type': 'application/json'
        },
        {
          'Content-type': 'application/json'
        },
        {
          'Content-type': 'application/json'
        },
        {
          'Content-type': 'application/json'
        }
      ]
    )

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          data: Buffer.from('100')
        },
        {
          statusCode: 200,
          data: Buffer.from('200')
        },
        {
          statusCode: 200,
          data: Buffer.from('300')
        },
        {
          statusCode: 200,
          data: Buffer.from('400')
        }
      ]
    )
  })

  it('should return bulk post results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.postBatch(
      [`${httpBaseUrl}/delay/200`, `${httpBaseUrl}/delay/100`],
      null,
      ['Hello1', 'Hello2']
    )

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          data: Buffer.from('100Hello2')
        },
        {
          statusCode: 200,
          data: Buffer.from('200Hello1')
        }
      ]
    )
  })

  it('should return bulk patch results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.putBatch(
      [`${httpBaseUrl}/delay/200`, `${httpBaseUrl}/delay/100`],
      null,
      'Hello'
    )

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          data: Buffer.from('100Hello')
        },
        {
          statusCode: 200,
          data: Buffer.from('200Hello')
        }
      ]
    )
  })

  it('should return bulk patch results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.patchBatch(
      [`${httpBaseUrl}/delay/200`, `${httpBaseUrl}/delay/100`],
      null,
      'Hello'
    )

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          data: Buffer.from('100Hello')
        },
        {
          statusCode: 200,
          data: Buffer.from('200Hello')
        }
      ]
    )
  })

  it('should return bulk delete results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.deleteBatch([
      `${httpBaseUrl}/delay/300`,
      `${httpBaseUrl}/delay/100`,
      `${httpBaseUrl}/delay/200`,
      `${httpBaseUrl}/delay/400`
    ])

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          data: Buffer.from('100')
        },
        {
          statusCode: 200,
          data: Buffer.from('200')
        },
        {
          statusCode: 200,
          data: Buffer.from('300')
        },
        {
          statusCode: 200,
          data: Buffer.from('400')
        }
      ]
    )
  })

  it('should return bulk head results in order of resolve', function() {
    this.slow(1000)
    let httpClient = new HttpClient()
    let responses = httpClient.headBatch([
      `${httpBaseUrl}/delay/300`,
      `${httpBaseUrl}/delay/100`,
      `${httpBaseUrl}/delay/200`,
      `${httpBaseUrl}/delay/400`
    ])

    return expect(
      Promise.all(responses),
      'to be fulfilled with value satisfying',
      [
        {
          statusCode: 200,
          request: {
            url: `${httpBaseUrl}/delay/100`
          }
        },
        {
          statusCode: 200,
          request: {
            url: `${httpBaseUrl}/delay/200`
          }
        },
        {
          statusCode: 200,
          request: {
            url: `${httpBaseUrl}/delay/300`
          }
        },
        {
          statusCode: 200,
          request: {
            url: `${httpBaseUrl}/delay/400`
          }
        }
      ]
    )
  })
})
