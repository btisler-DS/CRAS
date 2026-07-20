import { getVisionClient } from "../../../../../server/vision/vision-client.js";
import { VisionError } from "../../../../../server/vision/vision-errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const body = await getVisionClient().openStream(request.signal);
    return new Response(body, {
      headers: {
        "content-type": "multipart/x-mixed-replace; boundary=frame",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    const safe = error instanceof VisionError ? error : new VisionError({ code: "INTERNAL_ERROR", message: "Camera stream is unavailable.", retryable: true, status: 500 });
    return Response.json(safe.toBody(), { status: safe.status });
  }
}
