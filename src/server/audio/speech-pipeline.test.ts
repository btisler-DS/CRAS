import { describe, expect, it } from "vitest";

import { createAudioInput, type MicrophoneCaptureAdapter, type SpeechToTextAdapter } from "./audio-contracts.js";
import { SpeechPipeline } from "./speech-pipeline.js";
import { TestSpeechToTextAdapter } from "./test-speech-adapters.js";

class TestMicrophone implements MicrophoneCaptureAdapter {
  readonly device = "test:microphone";
  calls = 0;
  async capture() {
    this.calls += 1;
    return createAudioInput({
      bytes: new Uint8Array([1, 2, 3, 4]),
      format: "pcm_s16le",
      sampleRateHz: 16_000,
      channels: 1,
      source: "test",
    });
  }
}

describe("SpeechPipeline", () => {
  it("is passive until explicitly invoked", () => {
    const microphone = new TestMicrophone();
    new SpeechPipeline({ microphone, speechToText: new TestSpeechToTextAdapter() });
    expect(microphone.calls).toBe(0);
  });

  it("connects exactly one capture to exactly one injected transcription", async () => {
    const microphone = new TestMicrophone();
    let transcriptions = 0;
    const speechToText: SpeechToTextAdapter = {
      engine: "test",
      async transcribe(audio) {
        transcriptions += 1;
        expect(audio.source).toBe("test");
        return {
          status: "complete", text: "deliver medication", engine: "test", model: "fixed",
          language: "en-US", started_at: "2026-07-19T00:00:00.000Z",
          completed_at: "2026-07-19T00:00:00.010Z", duration_ms: 10,
          provenance: { source: "test", processing: "local", audioRetained: false },
        };
      },
    };
    const result = await new SpeechPipeline({ microphone, speechToText }).transcribeOnce();
    expect(result).toMatchObject({ status: "complete", text: "deliver medication" });
    expect(microphone.calls).toBe(1);
    expect(transcriptions).toBe(1);
  });

  it("does not transcribe when capture fails", async () => {
    const failure = new Error("microphone unavailable");
    const microphone: MicrophoneCaptureAdapter = {
      device: "test:missing",
      async capture() { throw failure; },
    };
    let transcriptions = 0;
    const speechToText: SpeechToTextAdapter = {
      engine: "test",
      async transcribe() { transcriptions += 1; throw new Error("should not run"); },
    };
    await expect(new SpeechPipeline({ microphone, speechToText }).transcribeOnce()).rejects.toBe(failure);
    expect(transcriptions).toBe(0);
  });

  it("honors cancellation before microphone access", async () => {
    const microphone = new TestMicrophone();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      new SpeechPipeline({ microphone, speechToText: new TestSpeechToTextAdapter() }).transcribeOnce(controller.signal),
    ).rejects.toThrow("cancelled");
    expect(microphone.calls).toBe(0);
  });
});
