export type VisionHttpMethod = "GET" | "POST";

export interface VisionTransportRequest {
  readonly method: VisionHttpMethod;
  readonly path: `/${string}`;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface VisionTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface VisionStreamRequest {
  readonly path: `/${string}`;
  readonly signal?: AbortSignal;
}

export interface VisionStreamResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array>;
}

/** The only dependency VisionClient needs for communication with a worker. */
export interface VisionTransport {
  request(request: VisionTransportRequest): Promise<VisionTransportResponse>;
  stream(request: VisionStreamRequest): Promise<VisionStreamResponse>;
}
