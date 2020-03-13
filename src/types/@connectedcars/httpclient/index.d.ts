declare module '@connectedcars/httpclient' {
  import http from 'http'
  export interface RequestOptions {
    agent?: http.Agent
    timeout?: number
    maxResponseSize?: number
    keepAlive?: boolean
    ca?: string | Buffer
    clientKey?: string | Buffer
    clientCert?: string | Buffer
    clientPfx?: string | Buffer
    clientPassphrase?: string | Buffer
    rejectUnauthorized?: string | Buffer
    secureProtocol?: string | Buffer
    ciphers?: string | Buffer
    maxConcurrent?: number
    maxTotalConcurrent?: number
    autoContentDecoding?: boolean
    headers?: object
  }
  export interface HttpResponse {
    statusCode: number
    statusMessage: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headers: Record<string, any>
    data: Buffer
    timings: {
      queued: number
      initialRequest: number
      requestDataStarted: number
      requestSent: number
      initialResponse: number
      responseDataStarted: number
      responseReceived: number
    }
  }
  export class HttpClient {
    constructor(options?: RequestOptions)
    request(
      method: string,
      url: string,
      headers?: object,
      data?: Buffer | string,
      options?: RequestOptions
    ): Promise<HttpResponse>
    get(url: string, headers?: object, options?: RequestOptions): Promise<HttpResponse>
    post(url: string, headers?: object, data?: Buffer | string, options?: RequestOptions): Promise<HttpResponse>
    patch(url: string, headers?: object, data?: Buffer | string, options?: RequestOptions): Promise<HttpResponse>
    put(url: string, headers?: object, data?: Buffer | string, options?: RequestOptions): Promise<HttpResponse>
    delete(url: string, headers?: object, options?: RequestOptions): Promise<HttpResponse>
    head(url: string, headers?: object, options?: RequestOptions): Promise<HttpResponse>
  }
}
