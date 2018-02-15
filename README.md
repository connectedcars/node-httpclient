# node-httpclient

WORK IN PROGRESS - API might change before first release

Thin wrapper around node's http/https client that provides promises based api.

## Features

* [Queuing](#Queuing)
* [Streaming](#smart-queuing)
* Automatic content decoding(gzip and deflate)
* Custom CA and SSL/TLS validation
* Client side certificates
* Precise timing

## Queuing

``` javascript
let httpClient = new HttpClient({ maxConcurrent: 2, keepAlive: true })
let promises = []
for (let i = 0; i < 4; i++) {
    promises.push(httpClient.get(`http://localhost/ok`), null)
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

Upload large file from read stream and get body in response:

``` javascript
let stream = httpClient.postStream(`http://localhost/echo`, null, { writeStream: true })
fs.createReadStream('/tmp/largefile').pipe(stream)
let response = await stream.response
let data = response.getJSON()
```
