import { getVisionClient } from "../../../../../server/vision/vision-client.js";
import { VisionError } from "../../../../../server/vision/vision-errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await getVisionClient().startStream(request.signal));
  } catch (error) {
    const safe = error instanceof VisionError ? error : new VisionError({ code: "INTERNAL_ERROR", message: "Camera could not start.", retryable: true, status: 500 });
    return Response.json(safe.toBody(), { status: safe.status });
  }
}
