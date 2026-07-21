import { z } from "zod";

import { REQUIRED_CONDITION_IDS } from "../../../domain.js";
import { getRuntimeSession } from "../../../server/runtime-session.js";
import { getVisionClient } from "../../../server/vision/vision-client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("reset") }).strict(),
  z.object({ command: z.literal("begin-mission") }).strict(),
  z.object({ command: z.literal("alert-robot") }).strict(),
  z.object({ command: z.literal("issue-instruction") }).strict(),
  z.object({ command: z.literal("resolve-observations") }).strict(),
  z.object({ command: z.literal("load-hospital-record") }).strict(),
  z
    .object({
      command: z.literal("preset"),
      preset: z.enum(["blocked", "successful", "evidence-failure"]),
    })
    .strict(),
  z
    .object({
      command: z.literal("set-condition"),
      conditionId: z.enum(REQUIRED_CONDITION_IDS),
      satisfied: z.boolean(),
    })
    .strict(),
  z.object({ command: z.literal("commit-and-dispatch") }).strict(),
]);

export function GET(request: Request): Response {
  const session = getRuntimeSession();
  const url = new URL(request.url);
  if (url.searchParams.get("export") === "1") {
    try {
      return new Response(session.exportEvidence(), {
        headers: {
          "content-disposition": "attachment; filename=evidence-record.json",
          "content-type": "application/json; charset=utf-8",
        },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Export failed." },
        { status: 404 },
      );
    }
  }
  return Response.json(session.view(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = commandSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Unsupported runtime command." },
      { status: 400 },
    );
  }

  const session = getRuntimeSession();
  const command = parsed.data;
  if (command.command === "reset") return Response.json(session.reset());
  if (command.command === "begin-mission") {
    return Response.json(session.beginMission());
  }
  if (command.command === "alert-robot") {
    return Response.json(session.alertRobot());
  }
  if (command.command === "issue-instruction") {
    return Response.json(session.issueInstruction());
  }
  if (command.command === "resolve-observations") {
    const batch = await getVisionClient().markerObservations(0, request.signal);
    return Response.json(session.resolveObservedConditions(batch.observations));
  }
  if (command.command === "load-hospital-record") {
    return Response.json(session.loadPreparedHospitalRecord());
  }
  if (command.command === "preset") {
    return Response.json(session.reset(command.preset));
  }
  if (command.command === "set-condition") {
    return Response.json(
      session.setCondition(command.conditionId, command.satisfied),
    );
  }
  return Response.json(session.commitAndDispatch());
}
