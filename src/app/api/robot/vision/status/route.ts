import { getVisionClient } from "../../../../../server/vision/vision-client.js";
import { VisionError } from "../../../../../server/vision/vision-errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(await getVisionClient().health(request.signal), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return visionFailure(error);
  }
}

function visionFailure(error: unknown): Response {
  const safe =
    error instanceof VisionError
      ? error
      : new VisionError({
          code: "INTERNAL_ERROR",
          message: "Vision status is unavailable.",
          retryable: true,
          status: 500,
        });
  return Response.json(safe.toBody(), { status: safe.status });
}
