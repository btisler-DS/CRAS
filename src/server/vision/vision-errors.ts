import { z } from "zod";

export const visionErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "CAMERA_UNAVAILABLE",
  "CAMERA_BUSY",
  "STREAM_INACTIVE",
  "WORKER_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_RESPONSE_TOO_LARGE",
  "UPSTREAM_PROTOCOL_ERROR",
  "STREAM_IDLE_TIMEOUT",
  "REQUEST_CANCELLED",
  "INTERNAL_ERROR",
]);

export type VisionErrorCode = z.infer<typeof visionErrorCodeSchema>;

export const visionErrorBodySchema = z
  .object({
    error: z
      .object({
        code: visionErrorCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type VisionErrorBody = z.infer<typeof visionErrorBodySchema>;

export class VisionError extends Error {
  readonly code: VisionErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(options: {
    code: VisionErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "VisionError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? 502;
  }

  toBody(): VisionErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
      },
    };
  }
}

export function parseVisionError(
  value: unknown,
  status: number,
): VisionError {
  const parsed = visionErrorBodySchema.safeParse(value);
  if (!parsed.success) {
    return new VisionError({
      code: "UPSTREAM_PROTOCOL_ERROR",
      message: "The vision worker returned an invalid error response.",
      retryable: false,
      status: 502,
    });
  }

  return new VisionError({
    ...parsed.data.error,
    status,
  });
}
