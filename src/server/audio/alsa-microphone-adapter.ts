import { createAudioInput, type AudioInput, type MicrophoneCaptureAdapter } from "./audio-contracts.js";
import {
  AudioProcessError,
  NodeAudioProcessRunner,
  type AudioProcessRunner,
} from "./audio-binary-process.js";

const SAMPLE_RATE_HZ = 48_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

export type MicrophoneErrorCode =
  | "MICROPHONE_UNAVAILABLE"
  | "CAPTURE_TIMEOUT"
  | "CAPTURE_FAILED"
  | "CAPTURE_SIZE_EXCEEDED";

export class MicrophoneError extends Error {
  readonly code: MicrophoneErrorCode;
  constructor(code: MicrophoneErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MicrophoneError";
    this.code = code;
  }
}

export interface AlsaMicrophoneAdapterOptions {
  readonly runner?: AudioProcessRunner;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly arecordExecutable?: string;
}

/** Passive until capture() is explicitly invoked. */
export class AlsaMicrophoneCaptureAdapter implements MicrophoneCaptureAdapter {
  readonly device = "hw:CARD=Device,DEV=0";
  readonly #runner: AudioProcessRunner;
  readonly #durationMs: number;
  readonly #timeoutMs: number;
  readonly #arecordExecutable: string;
  readonly #maxAudioBytes: number;

  constructor(options: AlsaMicrophoneAdapterOptions = {}) {
    this.#runner = options.runner ?? new NodeAudioProcessRunner();
    this.#durationMs = options.durationMs ?? 3_000;
    this.#timeoutMs = options.timeoutMs ?? 4_000;
    if (
      !Number.isInteger(this.#durationMs) ||
      this.#durationMs < 1_000 ||
      this.#durationMs > 3_000 ||
      this.#durationMs % 1_000 !== 0
    ) {
      throw new TypeError("Microphone duration must be one, two, or three seconds.");
    }
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= this.#durationMs || this.#timeoutMs > 10_000) {
      throw new TypeError("Microphone timeout is outside its allowed bounds.");
    }
    this.#arecordExecutable = validateExecutable(options.arecordExecutable ?? "arecord");
    this.#maxAudioBytes = Math.ceil(
      (SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE * this.#durationMs) / 1_000,
    );
  }

  async capture(signal?: AbortSignal): Promise<AudioInput> {
    let result;
    try {
      result = await this.#runner.run({
        executable: this.#arecordExecutable,
        args: [
          "-q", "-D", this.device, "-t", "raw", "-f", "S16_LE",
          "-r", String(SAMPLE_RATE_HZ), "-c", String(CHANNELS),
          "-d", String(this.#durationMs / 1_000), "-",
        ],
        timeoutMs: this.#timeoutMs,
        maxStdoutBytes: this.#maxAudioBytes,
        maxStderrBytes: 8_192,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof AudioProcessError && error.code === "NOT_FOUND") {
        throw new MicrophoneError("MICROPHONE_UNAVAILABLE", "ALSA capture is unavailable.", error);
      }
      if (error instanceof AudioProcessError && (error.code === "TIMEOUT" || error.code === "ABORTED")) {
        throw new MicrophoneError("CAPTURE_TIMEOUT", "Microphone capture timed out.", error);
      }
      if (error instanceof AudioProcessError && error.code === "OUTPUT_LIMIT") {
        throw new MicrophoneError("CAPTURE_SIZE_EXCEEDED", "Microphone capture exceeded its size bound.", error);
      }
      throw new MicrophoneError("CAPTURE_FAILED", "Microphone capture failed.", error);
    }
    if (result.exitCode !== 0 || result.stdout.byteLength === 0) {
      throw new MicrophoneError("CAPTURE_FAILED", `ALSA capture exited abnormally (${result.exitCode}).`);
    }
    return createAudioInput({
      bytes: result.stdout,
      format: "pcm_s16le",
      sampleRateHz: SAMPLE_RATE_HZ,
      channels: CHANNELS,
      source: "transient_buffer",
    });
  }
}

function validateExecutable(value: string): string {
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(value)) throw new TypeError("Invalid arecord executable.");
  return value;
}
