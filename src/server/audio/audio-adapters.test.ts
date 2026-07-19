import { describe, expect, it, vi } from "vitest";

import {
  createApprovedSpeech,
  createAudioInput,
  createBoundedToneRequest,
  type BoundedToneRequest,
} from "./audio-contracts.js";
import { createAudioAdapters, readAudioAdapterSelection } from "./audio-adapter-config.js";
import {
  RobotHatToneAdapter,
  type RobotHatPin20State,
  type RobotHatToneController,
} from "./robot-hat-tone-adapter.js";
import { TestSpeechToTextAdapter, TestTextToSpeechAdapter } from "./test-speech-adapters.js";

const PIN_STATE: RobotHatPin20State = {
  mode: "a0",
  pull: "pd",
  level: "low",
  opaque: "20: a0 pd | lo",
};

function approvedTone(frequencyHz = 440, durationMs = 1_000) {
  return createApprovedSpeech({
    speechId: `spk_${frequencyHz}_${durationMs}`,
    originatingResponseId: "rsp_tone_test",
    language: "en-US",
    output: createBoundedToneRequest({ frequencyHz, durationMs }),
  });
}

class InertRobotHatController implements RobotHatToneController {
  readonly calls: string[] = [];
  play: (request: BoundedToneRequest, signal: AbortSignal) => Promise<void> = async () => {};
  disable: () => Promise<void> = async () => {};
  restore: (state: RobotHatPin20State) => Promise<void> = async () => {};

  async recordPin20State(): Promise<RobotHatPin20State> {
    this.calls.push("record");
    return PIN_STATE;
  }
  async enableAmplifier(): Promise<void> {
    this.calls.push("enable");
  }
  async playToneWithMusic(request: BoundedToneRequest, signal: AbortSignal): Promise<void> {
    this.calls.push(`play:${request.frequencyHz}:${request.durationMs}`);
    return this.play(request, signal);
  }
  async disableAmplifier(): Promise<void> {
    this.calls.push("disable");
    return this.disable();
  }
  async restorePin20(state: RobotHatPin20State): Promise<void> {
    this.calls.push(`restore:${state.opaque}`);
    return this.restore(state);
  }
}

describe("speech adapter contracts", () => {
  it("returns complete transcript provenance from the hardware-free test adapter", async () => {
    const input = createAudioInput({
      bytes: new Uint8Array([1, 2]),
      format: "pcm_s16le",
      sampleRateHz: 16_000,
      channels: 1,
      source: "test",
    });
    const adapter = new TestSpeechToTextAdapter({ text: "status", confidence: 0.9, now: () => 1_000 });
    await expect(adapter.transcribe(input)).resolves.toEqual({
      status: "complete",
      text: "status",
      engine: "test-stt",
      model: "deterministic-test-model",
      language: "en-US",
      started_at: "1970-01-01T00:00:01.000Z",
      completed_at: "1970-01-01T00:00:01.000Z",
      duration_ms: 0,
      confidence_optional: 0.9,
      provenance: { source: "test", processing: "local", audioRetained: false },
    });
  });

  it("test TTS records approved speech without audio or GPIO", async () => {
    const adapter = new TestTextToSpeechAdapter({ now: () => 2_000 });
    const speech = createApprovedSpeech({
      speechId: "spk_test",
      originatingResponseId: "rsp_test",
      language: "en-US",
      output: { kind: "text", text: "Authorization remains blocked." },
    });
    await expect(adapter.speak(speech)).resolves.toMatchObject({ status: "completed", cleanup_completed: true });
    expect(adapter.calls).toEqual([speech]);
  });

  it("enforces bounded tone and audio inputs", () => {
    expect(() => createBoundedToneRequest({ frequencyHz: 99, durationMs: 100 })).toThrow();
    expect(() => createBoundedToneRequest({ frequencyHz: 440, durationMs: 2_001 })).toThrow();
    expect(() =>
      createAudioInput({ bytes: new Uint8Array(), format: "wav", sampleRateHz: 48_000, channels: 1, source: "test" }),
    ).toThrow();
  });
});

describe("RobotHatToneAdapter", () => {
  it("imports and constructs without calling the injected hardware controller", () => {
    const controller = new InertRobotHatController();
    new RobotHatToneAdapter({ controller });
    expect(controller.calls).toEqual([]);
  });

  it("uses the verified Music tone boundary and always cleans up in order", async () => {
    const controller = new InertRobotHatController();
    const adapter = new RobotHatToneAdapter({ controller });
    const speech = createApprovedSpeech({
      speechId: "spk_tone",
      originatingResponseId: "rsp_tone",
      language: "en-US",
      output: createBoundedToneRequest({ frequencyHz: 440, durationMs: 1_000 }),
    });
    await expect(adapter.speak(speech)).resolves.toMatchObject({ status: "completed", cleanup_completed: true });
    expect(controller.calls).toEqual([
      "record",
      "enable",
      "play:440:1000",
      "disable",
      `restore:${PIN_STATE.opaque}`,
    ]);
  });

  it("times out, aborts playback, and still disables and restores", async () => {
    vi.useFakeTimers();
    try {
      const controller = new InertRobotHatController();
      controller.play = async (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      const adapter = new RobotHatToneAdapter({ controller, timeoutMs: 100 });
      const result = adapter.speak(approvedTone());
      await vi.advanceTimersByTimeAsync(101);
      await expect(result).resolves.toMatchObject({ status: "timed_out", cleanup_completed: true });
      expect(controller.calls.slice(-2)).toEqual(["disable", `restore:${PIN_STATE.opaque}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates playback failure while completing cleanup", async () => {
    const controller = new InertRobotHatController();
    controller.play = async () => { throw new Error("PyAudio failed"); };
    const adapter = new RobotHatToneAdapter({ controller });
    await expect(adapter.speak(approvedTone(440, 500))).resolves.toMatchObject({
      status: "failed",
      cleanup_completed: true,
      error_optional: "PyAudio failed",
    });
  });

  it("returns failure when disable or pin restoration fails", async () => {
    const controller = new InertRobotHatController();
    controller.disable = async () => { throw new Error("disable failed"); };
    controller.restore = async () => { throw new Error("restore failed"); };
    const adapter = new RobotHatToneAdapter({ controller });
    const result = await adapter.speak(approvedTone(440, 500));
    expect(result).toMatchObject({ status: "failed", cleanup_completed: false });
    expect(result.error_optional).toContain("disable failed");
    expect(result.error_optional).toContain("restore failed");
  });

  it("rejects approved text without touching hardware", async () => {
    const controller = new InertRobotHatController();
    const adapter = new RobotHatToneAdapter({ controller });
    const speech = createApprovedSpeech({
      speechId: "spk_text",
      originatingResponseId: "rsp_text",
      language: "en-US",
      output: { kind: "text", text: "No direct text playback." },
    });
    await expect(adapter.speak(speech)).resolves.toMatchObject({ status: "failed", cleanup_completed: true });
    expect(controller.calls).toEqual([]);
  });
});

describe("server-side adapter selection", () => {
  it("defaults both production engines to disabled", () => {
    expect(readAudioAdapterSelection({})).toEqual({ speechToText: "disabled", textToSpeech: "disabled" });
    const adapters = createAudioAdapters({ speechToText: "disabled", textToSpeech: "disabled" });
    expect(adapters.speechToText.engine).toBe("disabled");
    expect(adapters.textToSpeech.engine).toBe("disabled");
  });

  it("requires an injected controller before selecting Robot HAT tone output", () => {
    expect(() => createAudioAdapters({ speechToText: "test", textToSpeech: "robot-hat-tone" })).toThrow(
      "requires an injected controller",
    );
  });

  it("requires an injected, provisioned adapter for Vosk selection", () => {
    expect(() =>
      createAudioAdapters({ speechToText: "vosk", textToSpeech: "disabled" }),
    ).toThrow("requires an injected, provisioned adapter");

    const vosk = new TestSpeechToTextAdapter();
    expect(
      createAudioAdapters({
        speechToText: "vosk",
        textToSpeech: "disabled",
        voskAdapter: vosk,
      }).speechToText,
    ).toBe(vosk);
    expect(readAudioAdapterSelection({ CRAS_STT_ENGINE: "vosk" }).speechToText).toBe("vosk");
  });

  it("rejects arbitrary environment or browser-like engine names", () => {
    expect(() => readAudioAdapterSelection({ CRAS_TTS_ENGINE: "http://robot/shell" })).toThrow();
    expect(() => readAudioAdapterSelection({ CRAS_STT_ENGINE: "whisper-cloud" })).toThrow();
  });
});
