# node-httpclient

WORK IN PROGRESS - API might change before first release

Thin wrapper around node's http/https client that provides promises based api.

## Features

* [Queuing](#queuing)
* [Streaming](#streaming)
* [Automatic content decoding](#automatic-content-decoding)
* Custom CA and SSL/TLS validation
* Client side certificates
* Precise timing
* [Bulk request](#bulk-request)

## Basic usage

Installation:

``` bash
npm install @connectedcars/httpclient
```

``` javascript
const { HttpClient } = require('@connectedcars/httpclient')
let httpClient = new HttpClient()
let response = await httpClient.get('http://localhost:3000/')
// {
//    statusCode: 200,
//    statusMessage: 'OK',
//    data: Buffer([...])
//    extras: [{...}] // http2 push responses
// }
```

## Queuing

Queuing is done on each endpoint(protocol, host and port combination,
fx. https://localhost:3000/. Limits are applied globally and per endpoint.

``` javascript
let httpClient = new HttpClient({ maxTotalConcurrent: 4, maxConcurrent: 2, keepAlive: true })
let promises = []
for (let i = 0; i < 4; i++) {
  promises.push(httpClient.get(`http://host1/ok`))
  promises.push(httpClient.get(`http://host2/ok`))
  promises.push(httpClient.post(`http://host2/ok`), null, 'Post data')
}
let results = await Promise.all(promises),
```

## Streaming

Download large file and pipe it to a write stream:

``` javascript
let stream = httpClient.getStream(`http://localhost/largefile`)
stream.pipe(fs.createWriteStream('/tmp/largefile'))
let response = await stream.response
```

Upload large file from read stream and save response body to file:

``` javascript
let response = httpClient.postStream(`http://localhost/echo`)
fs.createReadStream('/tmp/largefile').pipe(response)
response.pipe(fs.createWriteStream('/tmp/uploadresponsebody'))
let res = await response

let stream = httpClient.postStream(`http://localhost/echo`)
fs.createReadStream('/tmp/largefile').pipe(stream)
stream.pipe(fs.createWriteStream('/tmp/uploadresponsebody'))
let response = await stream.response
```

Upload large file from read stream and get body in response promise:

``` javascript
let stream = httpClient.postStream(`http://localhost/echo`, null, { writeStream: true })
fs.createReadStream('/tmp/largefile').pipe(stream)
let response = await stream.response
let data = response.data
```

## Automatic content decoding

Gzip and deflate are supported.

``` javascript
let response = await httpClient.get('http://localhost:3000/', {
   "Accept-Encoding": 'gzip, deflate'
})
let data = response.data
```

## Bulk request

Do bulk GET request and return in order of resolve:

``` javascript
let responses = httpClient.getBatch([
  `http://localhost/delay/300`,
  `http://localhost/delay/100`,
  `http://localhost/delay/200`,
  `http://localhost/delay/400`
])

for await (let response of responses) {
    console.log(response.statusCode)
    // Order would be 100, 200, 300, 400
}
```

Do bulk POST request and return in order of resolve:

``` javascript
let responses = httpClient.postBatch([
  { url: `http://localhost/echo`, headers: { 'Content-Type': 'application/json' }, data: '{ "payload": "1" }' },
  { url: `http://localhost/echo`, headers: { 'Content-Type': 'application/json' }, data: '{ "payload": "2" }' }
])

for await (let response of responses) {
    console.log(response.statusCode)
}
```

## Response handler (Not implemented)

Global http authentication handler:

``` javascript
let httpClient = new HttpClient( {
  responseHandler: (res, nextReq, reqCount, options) => {
    if(res.statusCode === 401 && reqCount < 2) {
      nextReq.headers['Authorization'] = 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'
      return new Promise(resolve => setTimeout(resolve, 1000 * count)) // Delay next request
    }
    if(res.statusCode === 403) {
      throw new Error("Failed")
    }
    return res
  }
} )
let response = httpClient.get('http://localhost/test')
```

Local http authentication handler:

``` javascript
let response = httpClient.get('http://localhost/test', {
  Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'
}, {
  responseHandler: (res, nextReq, reqCount) => {
    if(res.statusCode === 401 && reqCount < 2) {
      nextReq.headers['Authorization'] = 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'
      return false
    }
    return res
  }
})
```
