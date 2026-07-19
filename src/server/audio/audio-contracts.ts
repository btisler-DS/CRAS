const approvedSpeechBrand: unique symbol = Symbol("ApprovedSpeech");
const audioInputBrand: unique symbol = Symbol("AudioInput");

const MAX_AUDIO_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_APPROVED_TEXT_LENGTH = 500;
const MIN_TONE_FREQUENCY_HZ = 100;
const MAX_TONE_FREQUENCY_HZ = 2_000;
const MIN_TONE_DURATION_MS = 50;
const MAX_TONE_DURATION_MS = 2_000;

export interface AudioInput {
  readonly [audioInputBrand]: true;
  readonly bytes: Uint8Array;
  readonly format: "pcm_s16le" | "wav";
  readonly sampleRateHz: number;
  readonly channels: 1 | 2;
  readonly source: "test" | "transient_buffer";
}

export interface TranscriptProvenance {
  readonly source: "test" | "transient_audio";
  readonly processing: "local";
  readonly audioRetained: false;
}

export interface TranscriptResult {
  readonly status: "complete" | "unintelligible" | "failed" | "timed_out";
  readonly text: string;
  readonly engine: string;
  readonly model: string;
  readonly language: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly confidence_optional?: number;
  readonly error_optional?: string;
  readonly provenance: TranscriptProvenance;
}

export interface MicrophoneCaptureAdapter {
  readonly device: string;
  capture(signal?: AbortSignal): Promise<AudioInput>;
}

export interface BoundedToneRequest {
  readonly kind: "tone";
  readonly frequencyHz: number;
  readonly durationMs: number;
}

export interface ApprovedSpeech {
  readonly [approvedSpeechBrand]: true;
  readonly speechId: string;
  readonly originatingResponseId: string;
  readonly language: string;
  readonly output:
    | { readonly kind: "text"; readonly text: string }
    | BoundedToneRequest;
}

export type SpeechStatus = "completed" | "failed" | "timed_out";

export interface SpeechResult {
  readonly status: SpeechStatus;
  readonly engine: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly cleanup_completed: boolean;
  readonly error_optional?: string;
}

export interface SpeechToTextAdapter {
  readonly engine: string;
  transcribe(audioInput: AudioInput, signal?: AbortSignal): Promise<TranscriptResult>;
}

export interface TextToSpeechAdapter {
  readonly engine: string;
  speak(approvedSpeech: ApprovedSpeech, signal?: AbortSignal): Promise<SpeechResult>;
}

/** Server-side construction boundary. Browser payloads must never be cast to this type. */
export function createApprovedSpeech(input: {
  speechId: string;
  originatingResponseId: string;
  language: string;
  output:
    | { readonly kind: "text"; readonly text: string }
    | BoundedToneRequest;
}): ApprovedSpeech {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.speechId)) {
    throw new TypeError("Invalid speech ID.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.originatingResponseId)) {
    throw new TypeError("Invalid originating response ID.");
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(input.language)) {
    throw new TypeError("Invalid speech language.");
  }
  if (input.output.kind === "text") {
    const text = input.output.text.trim();
    if (text.length === 0 || text.length > MAX_APPROVED_TEXT_LENGTH) {
      throw new TypeError("Approved speech text is outside its allowed bounds.");
    }
    return { ...input, output: { kind: "text", text }, [approvedSpeechBrand]: true };
  }
  return { ...input, output: createBoundedToneRequest(input.output), [approvedSpeechBrand]: true };
}

export function createBoundedToneRequest(input: {
  frequencyHz: number;
  durationMs: number;
}): BoundedToneRequest {
  if (
    !Number.isFinite(input.frequencyHz) ||
    input.frequencyHz < MIN_TONE_FREQUENCY_HZ ||
    input.frequencyHz > MAX_TONE_FREQUENCY_HZ
  ) {
    throw new TypeError("Tone frequency is outside its allowed bounds.");
  }
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs < MIN_TONE_DURATION_MS ||
    input.durationMs > MAX_TONE_DURATION_MS
  ) {
    throw new TypeError("Tone duration is outside its allowed bounds.");
  }
  return { kind: "tone", ...input };
}

/** Creates bounded transient input; it does not capture or retain microphone audio. */
export function createAudioInput(input: {
  bytes: Uint8Array;
  format: AudioInput["format"];
  sampleRateHz: number;
  channels: AudioInput["channels"];
  source: AudioInput["source"];
}): AudioInput {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_AUDIO_INPUT_BYTES) {
    throw new TypeError("Audio input is outside its allowed size bounds.");
  }
  if (!Number.isInteger(input.sampleRateHz) || input.sampleRateHz < 8_000 || input.sampleRateHz > 48_000) {
    throw new TypeError("Audio sample rate is outside its allowed bounds.");
  }
  return { ...input, bytes: input.bytes.slice(), [audioInputBrand]: true };
}

export function isApprovedSpeech(value: unknown): value is ApprovedSpeech {
  return typeof value === "object" && value !== null && approvedSpeechBrand in value;
}
