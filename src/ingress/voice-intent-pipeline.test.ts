import { describe, expect, it } from "vitest";

import type { TranscriptResult } from "../server/audio/audio-contracts.js";
import { VoiceIntentPipeline } from "./voice-intent-pipeline.js";

function transcript(overrides: Partial<TranscriptResult> = {}): TranscriptResult {
  return {
    status: "complete", text: "deliver medication to room three twelve", engine: "test", model: "fixed",
    language: "en-US", started_at: "2026-07-19T00:00:00.000Z", completed_at: "2026-07-19T00:00:00.010Z",
    duration_ms: 10, confidence_optional: 0.95,
    provenance: { source: "test", processing: "local", audioRetained: false },
    ...overrides,
  };
}

describe("VoiceIntentPipeline", () => {
  it("routes a complete transcript without adding authority", async () => {
    const pipeline = new VoiceIntentPipeline({ speech: { transcribeOnce: async () => transcript() } });
    await expect(pipeline.resolveOnce()).resolves.toMatchObject({
      status: "routed",
      resolution: { intent: "action_request", destination: "ACTION_NORMALIZER", authority: "NONE" },
    });
  });

  it.each([
    transcript({ status: "unintelligible", text: "" }),
    transcript({ status: "timed_out", text: "" }),
    transcript({ confidence_optional: 0.4 }),
  ])("withholds incomplete or low-confidence speech from every route", async (result) => {
    const pipeline = new VoiceIntentPipeline({ speech: { transcribeOnce: async () => result } });
    await expect(pipeline.resolveOnce()).resolves.toMatchObject({ status: "unresolved", resolution: null });
  });
});
