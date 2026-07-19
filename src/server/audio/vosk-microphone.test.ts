import { describe, expect, it, vi } from "vitest";

import { AlsaMicrophoneCaptureAdapter } from "./alsa-microphone-adapter.js";
import { AudioProcessError, type AudioProcessRequest, type AudioProcessResult, type AudioProcessRunner } from "./audio-binary-process.js";
import { createAudioInput } from "./audio-contracts.js";
import { SpeechRecognitionError, VoskSpeechToTextAdapter } from "./vosk-speech-to-text-adapter.js";

class FakeAudioRunner implements AudioProcessRunner {
  readonly requests: AudioProcessRequest[] = [];
  results: Array<AudioProcessResult | Error> = [];
  async run(request: AudioProcessRequest): Promise<AudioProcessResult> {
    this.requests.push(request);
    const result = this.results.shift() ?? { exitCode: 0, stdout: new Uint8Array([1, 2]), stderr: "" };
    if (result instanceof Error) throw result;
    return result;
  }
}

const MODEL_PRESENT = { isDirectory: async () => true };

describe("AlsaMicrophoneCaptureAdapter", () => {
  it("is passive on import and construction", () => {
    const runner = new FakeAudioRunner();
    new AlsaMicrophoneCaptureAdapter({ runner });
    expect(runner.requests).toEqual([]);
  });

  it("captures once from the fixed explicit ALSA device with bounded output", async () => {
    const runner = new FakeAudioRunner();
    runner.results.push({ exitCode: 0, stdout: new Uint8Array([1, 2, 3, 4]), stderr: "" });
    const input = await new AlsaMicrophoneCaptureAdapter({ runner }).capture();
    expect(input.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.args).toContain("hw:CARD=Device,DEV=0");
    expect(runner.requests[0]?.maxStdoutBytes).toBe(288_000);
  });

  it("returns typed timeout and size errors", async () => {
    const timeoutRunner = new FakeAudioRunner();
    timeoutRunner.results.push(new AudioProcessError("TIMEOUT", "late"));
    await expect(new AlsaMicrophoneCaptureAdapter({ runner: timeoutRunner }).capture()).rejects.toMatchObject({ code: "CAPTURE_TIMEOUT" });

    const sizeRunner = new FakeAudioRunner();
    sizeRunner.results.push(new AudioProcessError("OUTPUT_LIMIT", "large"));
    await expect(new AlsaMicrophoneCaptureAdapter({ runner: sizeRunner }).capture()).rejects.toMatchObject({ code: "CAPTURE_SIZE_EXCEEDED" });
  });

  it("rejects capture durations ALSA cannot represent exactly", () => {
    expect(() => new AlsaMicrophoneCaptureAdapter({ durationMs: 1_500 })).toThrow(
      "must be one, two, or three seconds",
    );
  });
});

describe("VoskSpeechToTextAdapter", () => {
  it("refuses configuration when the model is absent", async () => {
    await expect(VoskSpeechToTextAdapter.create({ modelInspector: { isDirectory: async () => false } })).rejects.toEqual(
      expect.objectContaining({ code: "MODEL_NOT_FOUND" }),
    );
  });

  it("constructs without microphone or recognizer activity", async () => {
    const runner = new FakeAudioRunner();
    await VoskSpeechToTextAdapter.create({ runner, modelInspector: MODEL_PRESENT });
    expect(runner.requests).toEqual([]);
  });

  it("returns typed transcript provenance and deletes transient audio", async () => {
    const runner = new FakeAudioRunner();
    runner.results.push({
      exitCode: 0,
      stdout: new TextEncoder().encode('{"text":"deliver medication","confidence":0.91}'),
      stderr: "",
    });
    let now = 1_000;
    const adapter = await VoskSpeechToTextAdapter.create({
      runner,
      modelInspector: MODEL_PRESENT,
      now: () => (now += 50),
    });
    const input = createAudioInput({
      bytes: new Uint8Array([1, 2, 3, 4]), format: "pcm_s16le", sampleRateHz: 48_000,
      channels: 1, source: "transient_buffer",
    });
    await expect(adapter.transcribe(input)).resolves.toMatchObject({
      status: "complete",
      text: "deliver medication",
      engine: "vosk",
      model: "vosk-model-small-en-us-0.15",
      language: "en-US",
      confidence_optional: 0.91,
      provenance: { source: "transient_audio", processing: "local", audioRetained: false },
    });
    expect(input.bytes.every((byte) => byte === 0)).toBe(true);
    expect(runner.requests[0]?.stdin).toEqual(new Uint8Array([0, 0, 0, 0]));
  });

  it("returns timed_out and clears audio when recognition exceeds its bound", async () => {
    const runner = new FakeAudioRunner();
    runner.results.push(new AudioProcessError("TIMEOUT", "late"));
    const adapter = await VoskSpeechToTextAdapter.create({ runner, modelInspector: MODEL_PRESENT });
    const input = createAudioInput({
      bytes: new Uint8Array([9, 8]), format: "pcm_s16le", sampleRateHz: 16_000,
      channels: 1, source: "transient_buffer",
    });
    await expect(adapter.transcribe(input)).resolves.toMatchObject({ status: "timed_out" });
    expect(input.bytes).toEqual(new Uint8Array([0, 0]));
  });

  it("returns deterministic failure when Vosk is unavailable", async () => {
    const runner = new FakeAudioRunner();
    runner.results.push({ exitCode: 41, stdout: new Uint8Array(), stderr: "VOSK_UNAVAILABLE" });
    const adapter = await VoskSpeechToTextAdapter.create({ runner, modelInspector: MODEL_PRESENT });
    const input = createAudioInput({
      bytes: new Uint8Array([1]), format: "pcm_s16le", sampleRateHz: 16_000,
      channels: 1, source: "transient_buffer",
    });
    const result = await adapter.transcribe(input);
    expect(result.status).toBe("failed");
    expect(result.error_optional).toContain("Vosk runtime");
  });
});
