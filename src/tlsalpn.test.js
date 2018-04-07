const expect = require('unexpected')

const http = require('http')
const tls = require('tls')
const fs = require('fs')
const http2 = require('http2')

const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_CONTENT_TYPE
} = http2.constants

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

describe('tls ALPN', () => {
  let http2Server = http2.createSecureServer(
    {
      cert: localhostCertificate,
      key: localhostPrivateKey,
      allowHTTP1: true
    },
    (req, res) => {
      const alpnProtocol = (req.httpVersion === '2.0'
        ? req.stream.session
        : req
      ).socket.alpnProtocol
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          alpnProtocol,
          httpVersion: req.httpVersion
        })
      )
    }
  )
  http2Server.on('error', err => {
    console.error(err)
  })
  /*http2Server.on('stream', (stream, headers, flags) => {
    const method = headers[HTTP2_HEADER_METHOD]
    const path = headers[HTTP2_HEADER_PATH]
    stream.respond({
      'content-type': 'application/json',
      ':status': 200
    })
    stream.end('{}')
  })*/
  let httpsPort

  before(done => {
    http2Server.listen(0, () => {
      httpsPort = http2Server.address().port
      console.log(`    Listining on 127.0.0.1:${httpsPort} for https`)
      done()
    })
  })
  after(() => {
    http2Server.close()
  })

  it('should return 200 ok', done => {
    let tlsSocket = tls.connect(
      {
        port: httpsPort,
        ca: localhostCertificate,
        ALPNProtocols: ['http/1.1', 'h2']
      },
      () => {
        if (tlsSocket.alpnProtocol === 'h2') {
          let client = http2.connect(`https://localhost:${httpsPort}/`, {
            createConnection: options => {
              return tlsSocket
            }
          })
          let req = client.request({
            ':path': '/'
          })
          req.on('response', (headers, flags) => {
            console.log(headers[':status'])
          })
          req.on('data', chunk => {
            console.log(chunk.toString('utf8'))
          })
          req.on('end', () => {
            client.close()
            done()
          })
          req.on('error', err => {
            console.error(err)
          })
          req.end()
        } else {
          let request = http.get(
            {
              host: 'localhost',
              path: '/',
              createConnection: options => {
                return tlsSocket
              }
            },
            res => {
              res.on('data', chunk => {
                console.log(chunk.toString('utf8'))
              })
              res.on('end', () => {
                done()
              })
              res.on('error', err => {
                console.error(err)
              })
            }
          )
          request.on('error', err => {
            console.error(err)
          })
        }
      }
    )
    //tlsSocket.on('data', chunk => {
    //  console.log(chunk.toString('utf8'))
    //})
    tlsSocket.on('end', () => {
      console.log('socket end')
    })
  })
})
