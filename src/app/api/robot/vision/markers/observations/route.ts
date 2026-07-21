import { getVisionClient } from "../../../../../../server/vision/vision-client.js";
import { VisionError } from "../../../../../../server/vision/vision-errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const value = new URL(request.url).searchParams.get("after") ?? "0";
    if (!/^[0-9]+$/.test(value)) return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid observation cursor.", retryable: false } }, { status: 400 });
    return Response.json(await getVisionClient().markerObservations(Number(value), request.signal), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const safe = error instanceof VisionError ? error : new VisionError({ code: "INTERNAL_ERROR", message: "Marker observations are unavailable.", retryable: true, status: 500 });
    return Response.json(safe.toBody(), { status: safe.status });
  }
}
