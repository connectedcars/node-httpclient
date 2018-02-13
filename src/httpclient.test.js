const expect = require('unexpected')
const fs = require('fs')
const zlib = require('zlib')

const HttpClient = require('./httpclient')
const HttpClientError = require('./httpclienterror')

const { createTestHttpServer, createTestHttpsServer } = require('./testutils')

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

  it('should return 302 from http://google.com', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`http://google.com`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 302
    })
  })

  it('should return 302 from https://google.com', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`https://google.com`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 302
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

  it('should timeout with a little data sent', () => {
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
})
