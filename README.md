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

## Basic usage

Installation:

``` bash
npm install @connectedcars/httpclient
```

``` javascript
const { HttpClient } = require('@connectedcars/httpclient')
let httpClient = new HttpClient()
httpClient.get('http://localhost:3000/')
```

## Queuing

Queuing is done on each endpoint(protocol, host and port combination,
fx. https://localhost:3000/. Limits are applied globally and per endpoint.

``` javascript
let httpClient = new HttpClient({ maxTotalConcurrent: 4, maxConcurrent: 2, keepAlive: true })
let promises = []
for (let i = 0; i < 4; i++) {
  promises.push(httpClient.get(`http://host1/ok`), null)
  promises.push(httpClient.get(`http://host2/ok`), null)
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

Do bulk request and return in order of resolve:

``` javascript
let responses = httpClient.requestBulk('GET', [
  `http://localhost/delay/300`,
  `http://localhost/delay/100`,
  `http://localhost/delay/200`,
  `http://localhost/delay/400`
])
for(let responsePromise of responses) {
  let response = await responsePromise
}
```
