const expect = require('unexpected')
const fs = require('fs')

const HttpClient = require('./httpclient')
const HttpClientError = require('./httpclienterror')

const { createTestHttpServer, createTestHttpsServer } = require('./testutils')
const net = require('net')

const localhostCertificate = fs.readFileSync(
  `${__dirname}/../resources/localhost.crt`
)
const localhostPrivateKey = fs.readFileSync(
  `${__dirname}/../resources/localhost.key`
)

describe('HttpClient', () => {
  let [httpServer, httpListenPromise] = createTestHttpServer((req, res) => {
    if (req.url === '/timeout') {
      //
    } else if (req.url === '/timeout_with_data') {
      res.write('.')
    } else if (req.url === '/large_response') {
      res.statusCode = 200
      res.end('x'.repeat(1024))
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

  it('should return 200 ok")', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(`${httpBaseUrl}/ok`)
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200,
      statusMessage: 'OK'
    })
  })

  it('should return 200 ok 4 times with 2 in parallel', () => {
    let httpClient = new HttpClient({ maxConcurrent: 2, timeout: 100 })
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

  it('should fail', done => {
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

  it('https connected', () => {
    let httpClient = new HttpClient()
    let response = httpClient.get(httpsBaseUrl, null, {
      ca: localhostCertificate
    })
    return expect(response, 'to be fulfilled with value satisfying', {
      statusCode: 200
    })
  })
})
