import { describe, expect, it, vi } from "vitest";

import { HttpVisionTransport } from "./http-vision-transport.js";
import { VisionClient } from "./vision-client.js";
import { VisionError } from "./vision-errors.js";
import type {
  VisionStreamRequest,
  VisionStreamResponse,
  VisionTransport,
  VisionTransportRequest,
  VisionTransportResponse,
} from "./vision-transport.js";

class InMemoryVisionTransport implements VisionTransport {
  readonly requests: VisionTransportRequest[] = [];
  response: VisionTransportResponse = {
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
  };
  streamResponse: VisionStreamResponse = {
    status: 200,
    headers: new Headers({
      "content-type": "multipart/x-mixed-replace; boundary=frame",
    }),
    body: new ReadableStream({ start(controller) { controller.close(); } }),
  };

  async request(request: VisionTransportRequest): Promise<VisionTransportResponse> {
    this.requests.push(request);
    return this.response;
  }

  async stream(_request: VisionStreamRequest): Promise<VisionStreamResponse> {
    return this.streamResponse;
  }
}

describe("VisionClient", () => {
  it("uses an injected transport and validates successful worker responses", async () => {
    const transport = new InMemoryVisionTransport();
    transport.response = {
      status: 200,
      headers: new Headers(),
      body: {
        service: "cras-vision-worker",
        status: "ok",
        camera_detected: true,
        camera_active: false,
        sensor: "ov5647",
        resolution: { width: 640, height: 480 },
        target_fps: 15,
        measured_fps: 0,
        last_frame_at: null,
        error: null,
      },
    };

    await expect(new VisionClient(transport).health()).resolves.toMatchObject({
      sensor: "ov5647",
      camera_active: false,
    });
    expect(transport.requests).toEqual([
      expect.objectContaining({ method: "GET", path: "/health" }),
    ]);
  });

  it("rejects malformed success and error bodies with schema-safe errors", async () => {
    const transport = new InMemoryVisionTransport();
    const client = new VisionClient(transport);
    transport.response = { status: 200, headers: new Headers(), body: { status: "ok" } };
    await expect(client.health()).rejects.toMatchObject({
      code: "UPSTREAM_PROTOCOL_ERROR",
    });

    transport.response = { status: 503, headers: new Headers(), body: { stack: "secret" } };
    await expect(client.health()).rejects.toMatchObject({
      code: "UPSTREAM_PROTOCOL_ERROR",
      message: expect.not.stringContaining("secret"),
    });
  });

  it("accepts MJPEG and rejects other stream content types", async () => {
    const transport = new InMemoryVisionTransport();
    const client = new VisionClient(transport);
    await expect(client.openStream()).resolves.toBeInstanceOf(ReadableStream);

    transport.streamResponse = {
      ...transport.streamResponse,
      headers: new Headers({ "content-type": "text/plain" }),
      body: new ReadableStream({ start(controller) { controller.close(); } }),
    };
    await expect(client.openStream()).rejects.toMatchObject({
      code: "UPSTREAM_PROTOCOL_ERROR",
    });
  });

  it("validates typed marker observations through the injected transport", async () => {
    const transport = new InMemoryVisionTransport();
    const client = new VisionClient(transport);
    transport.response = {
      status: 200,
      headers: new Headers(),
      body: {
        marker_scanner_active: true,
        observations: [{
          sequence: 1,
          observation_id: "marker-00000001",
          marker_id: "PAT-1001",
          kind: "patient",
          payload: "cras:v1:patient:pat-1001",
          observed_at: "2026-07-20T12:00:00.000Z",
          frame_sequence: 42,
          decoder: "opencv-qrcode-detector",
          confidence: null,
          corners: null,
        }],
        error: null,
      },
    };
    await expect(client.markerObservations(0)).resolves.toMatchObject({
      observations: [{ marker_id: "PAT-1001", kind: "patient" }],
    });
    expect(transport.requests.at(-1)).toMatchObject({
      method: "GET",
      path: "/markers/observations?after=0",
    });
  });

  it("rejects malformed marker payloads and invalid cursors", async () => {
    const transport = new InMemoryVisionTransport();
    const client = new VisionClient(transport);
    transport.response = {
      status: 200,
      headers: new Headers(),
      body: {
        marker_scanner_active: true,
        observations: [{ marker_id: "MOVE-FORWARD", payload: "move-forward" }],
        error: null,
      },
    };
    await expect(client.markerObservations()).rejects.toMatchObject({
      code: "UPSTREAM_PROTOCOL_ERROR",
    });
    expect(() => client.markerObservations(-1)).toThrow(TypeError);
  });
});

describe("HttpVisionTransport", () => {
  it("enforces response-size limits", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ value: "too large" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const transport = new HttpVisionTransport({
      baseUrl: "http://127.0.0.1:19100",
      maxResponseBytes: 4,
      fetch,
    });
    await expect(transport.request({ method: "GET", path: "/health" })).rejects.toMatchObject({
      code: "UPSTREAM_RESPONSE_TOO_LARGE",
    });
  });

  it("cancels the upstream stream when its downstream consumer disconnects", async () => {
    const cancelled = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel: cancelled,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(upstream, {
        headers: { "content-type": "multipart/x-mixed-replace; boundary=frame" },
      }),
    );
    const transport = new HttpVisionTransport({
      baseUrl: "http://127.0.0.1:19100",
      fetch,
    });
    const response = await transport.stream({ path: "/stream.mjpg" });
    await response.body.cancel("browser disconnected");
    expect(cancelled).toHaveBeenCalledWith("browser disconnected");
  });

  it("enforces the frame-idle timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "multipart/x-mixed-replace; boundary=frame" },
        }),
      );
      const transport = new HttpVisionTransport({
        baseUrl: "http://127.0.0.1:19100",
        frameIdleTimeoutMs: 10,
        fetch,
      });
      const response = await transport.stream({ path: "/stream.mjpg" });
      const read = response.body.getReader().read();
      const rejected = expect(read).rejects.toMatchObject({
        code: "STREAM_IDLE_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(11);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps request timeouts and downstream cancellation separately", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      throw new Error("unreachable");
    });
    const timed = new HttpVisionTransport({
      baseUrl: "http://127.0.0.1:19100",
      requestTimeoutMs: 5,
      fetch,
    });
    await expect(timed.request({ method: "GET", path: "/health" })).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    });

    const controller = new AbortController();
    const cancelled = new HttpVisionTransport({
      baseUrl: "http://127.0.0.1:19100",
      requestTimeoutMs: 1_000,
      fetch,
    });
    const request = cancelled.request({ method: "GET", path: "/health", signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  });
});

it("serializes only schema-safe VisionError fields", () => {
  const error = new VisionError({
    code: "WORKER_UNAVAILABLE",
    message: "Unavailable.",
    retryable: true,
    cause: new Error("private stack"),
  });
  expect(error.toBody()).toEqual({
    error: { code: "WORKER_UNAVAILABLE", message: "Unavailable.", retryable: true },
  });
  expect(JSON.stringify(error.toBody())).not.toContain("private stack");
});
