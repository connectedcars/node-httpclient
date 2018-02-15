const expect = require('unexpected')
const fs = require('fs')

const zlib = require('zlib')

const HttpClient = require('./httpclient')
const HttpClientError = require('./httpclienterror')

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
    if (['PUT', 'PATCH', 'DELETE'].indexOf(req.method) >= 0) {
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

  it('should return 200 ok from gzip content-encoding', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/gzip`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok from deflate content-encoding', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/deflate`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
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
    let response = httpClient.put(`${httpBaseUrl}/`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK',
      data: Buffer.from('PUT', 'utf8')
    })
  })

  it('should return 200: PATCH', () => {
    let httpClient = new HttpClient()
    let response = httpClient.patch(`${httpBaseUrl}/`)
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
    let stream = httpClient.putStream(`${httpBaseUrl}/echo`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    stream.end()

    return stream.response.then(response => {
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
    let stream = httpClient.patchStream(`${httpBaseUrl}/echo`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    stream.end()

    return stream.response.then(response => {
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

  /* TODO: Think more about the API here, should we default to returning the
  it('should post stream Hello with postStream and get body in response', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    //stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    stream.end()

    return stream.response.then(response => {
      return expect(response, 'to satisfy', {
        statusCode: 200,
        data: Buffer.from('Hello', 'utf8')
      })
    })
  }) */

  it('should post stream Hello with postStream', () => {
    let httpClient = new HttpClient()

    let testFile = tmpFile()
    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    stream.end()

    return stream.response.then(response => {
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
    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.pipe(fs.createWriteStream(testFile))
    stream.write('Hello')
    setTimeout(() => {
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
    let stream = httpClient.postStream(`${httpBaseUrl}/echo`)
    stream.write('Hello')
    setTimeout(() => {
      stream.pipe(fs.createWriteStream(testFile))
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
})
