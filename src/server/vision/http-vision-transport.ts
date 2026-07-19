import { VisionError } from "./vision-errors.js";
import type {
  VisionStreamRequest,
  VisionStreamResponse,
  VisionTransport,
  VisionTransportRequest,
  VisionTransportResponse,
} from "./vision-transport.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_STREAM_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_FRAME_IDLE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

type Fetch = typeof globalThis.fetch;

export interface HttpVisionTransportOptions {
  readonly baseUrl: string;
  readonly requestTimeoutMs?: number;
  readonly streamConnectionTimeoutMs?: number;
  readonly frameIdleTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: Fetch;
}

export class HttpVisionTransport implements VisionTransport {
  readonly #baseUrl: URL;
  readonly #requestTimeoutMs: number;
  readonly #streamConnectionTimeoutMs: number;
  readonly #frameIdleTimeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: Fetch;

  constructor(options: HttpVisionTransportOptions) {
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#requestTimeoutMs = positive(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.#streamConnectionTimeoutMs = positive(
      options.streamConnectionTimeoutMs,
      DEFAULT_STREAM_CONNECTION_TIMEOUT_MS,
    );
    this.#frameIdleTimeoutMs = positive(
      options.frameIdleTimeoutMs,
      DEFAULT_FRAME_IDLE_TIMEOUT_MS,
    );
    this.#maxResponseBytes = positive(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async request(
    request: VisionTransportRequest,
  ): Promise<VisionTransportResponse> {
    const operation = createOperationSignal(
      request.signal,
      this.#requestTimeoutMs,
      "UPSTREAM_TIMEOUT",
      "Vision worker request timed out.",
    );

    try {
      const bodyOptions =
        request.body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request.body),
            };
      const response = await this.#fetch(this.#url(request.path), {
        method: request.method,
        ...bodyOptions,
        cache: "no-store",
        signal: operation.signal,
      });
      const body = await readJsonWithinLimit(response, this.#maxResponseBytes);
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      throw normalizeTransportError(error, operation);
    } finally {
      operation.dispose();
    }
  }

  async stream(request: VisionStreamRequest): Promise<VisionStreamResponse> {
    const operation = createOperationSignal(
      request.signal,
      this.#streamConnectionTimeoutMs,
      "UPSTREAM_TIMEOUT",
      "Vision stream connection timed out.",
    );

    let response: Response;
    try {
      response = await this.#fetch(this.#url(request.path), {
        method: "GET",
        cache: "no-store",
        signal: operation.signal,
      });
    } catch (error) {
      operation.dispose();
      throw normalizeTransportError(error, operation);
    }

    operation.clearTimeout();
    if (!response.ok || response.body === null) {
      operation.abort();
      operation.dispose();
      throw new VisionError({
        code: "UPSTREAM_PROTOCOL_ERROR",
        message: "The vision worker did not provide an active stream.",
        retryable: response.status >= 500,
        status: response.status || 502,
      });
    }

    const body = withIdleTimeout(
      response.body,
      this.#frameIdleTimeoutMs,
      operation,
    );
    return { status: response.status, headers: response.headers, body };
  }

  #url(path: `/${string}`): URL {
    return new URL(path.slice(1), this.#baseUrl);
  }
}

interface OperationSignal {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly downstreamAborted: () => boolean;
  readonly abort: () => void;
  readonly clearTimeout: () => void;
  readonly dispose: () => void;
  readonly timeoutError: VisionError;
}

function createOperationSignal(
  downstream: AbortSignal | undefined,
  timeoutMs: number,
  timeoutCode: "UPSTREAM_TIMEOUT",
  timeoutMessage: string,
): OperationSignal {
  const controller = new AbortController();
  let didTimeOut = false;
  const onAbort = () => controller.abort(downstream?.reason);
  downstream?.addEventListener("abort", onAbort, { once: true });
  if (downstream?.aborted) onAbort();

  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    downstreamAborted: () => downstream?.aborted ?? false,
    abort: () => controller.abort(),
    clearTimeout: () => clearTimeout(timer),
    dispose: () => {
      clearTimeout(timer);
      downstream?.removeEventListener("abort", onAbort);
    },
    timeoutError: new VisionError({
      code: timeoutCode,
      message: timeoutMessage,
      retryable: true,
      status: 504,
    }),
  };
}

async function readJsonWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw responseTooLarge();
  }
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw responseTooLarge();
    }
    chunks.push(value);
  }

  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new VisionError({
      code: "UPSTREAM_PROTOCOL_ERROR",
      message: "The vision worker returned invalid JSON.",
      retryable: false,
      status: 502,
      cause: error,
    });
  }
}

function withIdleTimeout(
  upstream: ReadableStream<Uint8Array>,
  timeoutMs: number,
  operation: OperationSignal,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const arm = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      operation.abort();
      void reader.cancel().catch(() => {
        // The controller error below is the single public timeout signal.
      });
      controller.error(
        new VisionError({
          code: "STREAM_IDLE_TIMEOUT",
          message: "The vision stream stopped producing frames.",
          retryable: true,
          status: 504,
        }),
      );
      operation.dispose();
    }, timeoutMs);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      arm(controller);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (closed) return;
        if (done) {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
          controller.close();
          operation.dispose();
          return;
        }
        controller.enqueue(value);
        arm(controller);
      } catch (error) {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        controller.error(normalizeTransportError(error, operation));
        operation.dispose();
      }
    },
    async cancel(reason) {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      operation.abort();
      await reader.cancel(reason);
      operation.dispose();
    },
  });
}

function normalizeTransportError(
  error: unknown,
  operation: OperationSignal,
): VisionError {
  if (error instanceof VisionError) return error;
  if (operation.timedOut()) return operation.timeoutError;
  if (operation.downstreamAborted()) {
    return new VisionError({
      code: "REQUEST_CANCELLED",
      message: "The downstream request was cancelled.",
      retryable: false,
      status: 499,
      cause: error,
    });
  }
  return new VisionError({
    code: "WORKER_UNAVAILABLE",
    message: "The vision worker is unavailable.",
    retryable: true,
    status: 502,
    cause: error,
  });
}

function responseTooLarge(): VisionError {
  return new VisionError({
    code: "UPSTREAM_RESPONSE_TOO_LARGE",
    message: "The vision worker response exceeded the allowed size.",
    retryable: false,
    status: 502,
  });
}

function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Vision transport limits must be positive numbers.");
  }
  return value;
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value.endsWith("/") ? value : `${value}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Vision transport requires an HTTP or HTTPS base URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Vision transport base URL must not contain credentials, query, or fragment.");
  }
  return url;
}
