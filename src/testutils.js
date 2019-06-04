// @ts-check
'use strict'

const http = require('http')
const https = require('https')

const os = require('os')
const crypto = require('crypto')

// Make ts-check happy
const HttpServer = http.Server
const HttpsServer = https.Server
const IncomingMessage = http.IncomingMessage
const ServerResponse = http.ServerResponse

/**
 * @typedef {Object} listenResponse
 * @property {string} hostname
 * @property {number} port
 */

/**
 * Start a test http server
 * @param {(request: IncomingMessage, response: ServerResponse) => void} requestHandler
 * @returns {[HttpServer,Promise<listenResponse>]}
 */
function createTestHttpServer(requestHandler) {
  const httpServer = http.createServer(requestHandler)
  return [
    httpServer,
    new Promise((resolve, reject) => {
      httpServer.listen(0, () => {
        resolve({
          hostname: httpServer.address().address,
          port: httpServer.address().port
        })
      })
    })
  ]
}

/**
 * Start a test http server
 * @param {(IncomingMessage, ServerResponse) => void} requestHandler
 * @returns {[HttpsServer,Promise<listenResponse>]}
 */
function createTestHttpsServer(options, requestHandler) {
  const httpsServer = https.createServer(options, requestHandler)
  return [
    httpsServer,
    new Promise((resolve, reject) => {
      httpsServer.listen(0, () => {
        resolve({
          hostname: httpsServer.address().address,
          port: httpsServer.address().port
        })
      })
    })
  ]
}

function tmpFile() {
  let tmpdir = os.tmpdir()
  let randomName = crypto.randomBytes(32).toString('hex')
  return `${tmpdir}/${randomName}`
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

module.exports = {
  createTestHttpServer,
  createTestHttpsServer,
  tmpFile,
  shuffleArray
}
