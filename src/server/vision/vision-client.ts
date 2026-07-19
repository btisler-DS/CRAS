import { z } from "zod";

import { HttpVisionTransport } from "./http-vision-transport.js";
import { parseVisionError, VisionError } from "./vision-errors.js";
import type { VisionTransport } from "./vision-transport.js";

const timestamp = z.string().datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();

export const visionHealthSchema = z
  .object({
    service: z.literal("cras-vision-worker"),
    status: z.enum(["ok", "degraded", "error"]),
    camera_detected: z.boolean(),
    camera_active: z.boolean(),
    sensor: z.string().nullable(),
    resolution: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .nullable(),
    target_fps: z.number().nonnegative(),
    measured_fps: z.number().nonnegative(),
    last_frame_at: nullableTimestamp,
    error: z.string().nullable(),
  })
  .strict();

export const streamStateSchema = z
  .object({
    camera_active: z.boolean(),
    changed: z.boolean(),
  })
  .strict();

export const captureResultSchema = z
  .object({
    capture_id: z.string().min(1).max(200),
    timestamp,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.literal("jpeg"),
    size_bytes: z.number().int().nonnegative(),
  })
  .strict();

export const batteryStateSchema = z.enum(["normal", "low", "critical", "unknown"]);
export const telemetrySchema = z
  .object({
    battery_voltage: z.number().nonnegative().nullable(),
    battery_state: batteryStateSchema,
    battery_estimate_kind: z.literal("raw_voltage"),
    battery_sampled_at: nullableTimestamp,
    camera_temperature: z.number().nullable(),
    telemetry_stale: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();

export type VisionHealth = z.infer<typeof visionHealthSchema>;
export type VisionStreamState = z.infer<typeof streamStateSchema>;
export type CaptureResult = z.infer<typeof captureResultSchema>;
export type VisionTelemetry = z.infer<typeof telemetrySchema>;

export class VisionClient {
  readonly #transport: VisionTransport;

  constructor(transport: VisionTransport) {
    this.#transport = transport;
  }

  health(signal?: AbortSignal): Promise<VisionHealth> {
    return this.#request("GET", "/health", visionHealthSchema, signal);
  }

  startStream(signal?: AbortSignal): Promise<VisionStreamState> {
    return this.#request("POST", "/stream/start", streamStateSchema, signal);
  }

  stopStream(signal?: AbortSignal): Promise<VisionStreamState> {
    return this.#request("POST", "/stream/stop", streamStateSchema, signal);
  }

  async openStream(signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.#transport.stream({
      path: "/stream.mjpg",
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body.cancel();
      throw new VisionError({
        code: "UPSTREAM_PROTOCOL_ERROR",
        message: "The vision worker rejected the stream request.",
        retryable: response.status >= 500,
        status: response.status,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/x-mixed-replace")) {
      await response.body.cancel();
      throw new VisionError({
        code: "UPSTREAM_PROTOCOL_ERROR",
        message: "The vision worker returned an invalid stream format.",
        retryable: false,
        status: 502,
      });
    }
    return response.body;
  }

  capture(signal?: AbortSignal): Promise<CaptureResult> {
    return this.#request("POST", "/capture", captureResultSchema, signal);
  }

  telemetry(signal?: AbortSignal): Promise<VisionTelemetry> {
    return this.#request("GET", "/telemetry", telemetrySchema, signal);
  }

  async #request<T>(
    method: "GET" | "POST",
    path: `/${string}`,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.#transport.request({
      method,
      path,
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw parseVisionError(response.body, response.status);
    }
    const parsed = schema.safeParse(response.body);
    if (!parsed.success) {
      throw new VisionError({
        code: "UPSTREAM_PROTOCOL_ERROR",
        message: "The vision worker returned a response that violates its contract.",
        retryable: false,
        status: 502,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

let productionClient: VisionClient | undefined;

/** Lazily resolves server-only configuration so `next build` needs no robot connection. */
export function getVisionClient(): VisionClient {
  if (productionClient !== undefined) return productionClient;
  const baseUrl = process.env.ROBOT_VISION_BASE_URL;
  if (!baseUrl) {
    throw new VisionError({
      code: "WORKER_UNAVAILABLE",
      message: "Robot vision is not configured on this server.",
      retryable: false,
      status: 503,
    });
  }
  productionClient = new VisionClient(new HttpVisionTransport({ baseUrl }));
  return productionClient;
}
