import { stat } from "node:fs/promises";

import type { AudioInput, SpeechToTextAdapter, TranscriptResult } from "./audio-contracts.js";
import {
  AudioProcessError,
  NodeAudioProcessRunner,
  type AudioProcessRunner,
} from "./audio-binary-process.js";

const DEFAULT_MODEL_PATH = "/opt/cras-runtime/models/vosk-model-small-en-us-0.15";
const MAX_MODEL_PATH_LENGTH = 500;

const VOSK_SCRIPT = String.raw`
import json
import sys
try:
    from vosk import Model, KaldiRecognizer
except ModuleNotFoundError as error:
    sys.stderr.write("CRAS_ERROR:VOSK_UNAVAILABLE:" + str(error))
    raise SystemExit(41)
try:
    model_path = sys.argv[1]
    sample_rate = int(sys.argv[2])
    model = Model(model_path)
    recognizer = KaldiRecognizer(model, sample_rate)
    recognizer.SetWords(True)
    audio = sys.stdin.buffer.read()
    recognizer.AcceptWaveform(audio)
    result = json.loads(recognizer.FinalResult())
    words = result.get("result", [])
    confidences = [float(word["conf"]) for word in words if "conf" in word]
    output = {
        "text": str(result.get("text", "")).strip(),
        "confidence": (sum(confidences) / len(confidences)) if confidences else None,
    }
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
except BaseException as error:
    sys.stderr.write("CRAS_ERROR:RECOGNITION_FAILURE:" + type(error).__name__ + ":" + str(error))
    raise SystemExit(42)
`;

export type SpeechRecognitionErrorCode =
  | "MODEL_NOT_FOUND"
  | "VOSK_UNAVAILABLE"
  | "RECOGNITION_TIMEOUT"
  | "RECOGNITION_FAILED";

export class SpeechRecognitionError extends Error {
  readonly code: SpeechRecognitionErrorCode;
  constructor(code: SpeechRecognitionErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SpeechRecognitionError";
    this.code = code;
  }
}

export interface ModelInspector {
  isDirectory(path: string): Promise<boolean>;
}

export interface VoskSpeechToTextAdapterOptions {
  readonly modelPath?: string;
  readonly modelName?: string;
  readonly language?: string;
  readonly pythonExecutable?: string;
  readonly timeoutMs?: number;
  readonly runner?: AudioProcessRunner;
  readonly modelInspector?: ModelInspector;
  readonly now?: () => number;
}

export class VoskSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly engine = "vosk";
  readonly #modelPath: string;
  readonly #modelName: string;
  readonly #language: string;
  readonly #pythonExecutable: string;
  readonly #timeoutMs: number;
  readonly #runner: AudioProcessRunner;
  readonly #now: () => number;

  private constructor(options: VoskSpeechToTextAdapterOptions) {
    this.#modelPath = validateModelPath(options.modelPath ?? DEFAULT_MODEL_PATH);
    this.#modelName = options.modelName ?? "vosk-model-small-en-us-0.15";
    this.#language = options.language ?? "en-US";
    this.#pythonExecutable = validateExecutable(options.pythonExecutable ?? "python3");
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 500 || this.#timeoutMs > 30_000) {
      throw new TypeError("Vosk timeout is outside its allowed bounds.");
    }
    this.#runner = options.runner ?? new NodeAudioProcessRunner();
    this.#now = options.now ?? Date.now;
  }

  static async create(options: VoskSpeechToTextAdapterOptions = {}): Promise<VoskSpeechToTextAdapter> {
    const adapter = new VoskSpeechToTextAdapter(options);
    const inspector = options.modelInspector ?? FILESYSTEM_MODEL_INSPECTOR;
    if (!(await inspector.isDirectory(adapter.#modelPath))) {
      throw new SpeechRecognitionError(
        "MODEL_NOT_FOUND",
        `Configured Vosk model is absent: ${adapter.#modelPath}`,
      );
    }
    return adapter;
  }

  async transcribe(audioInput: AudioInput, signal?: AbortSignal): Promise<TranscriptResult> {
    const started = this.#now();
    let status: TranscriptResult["status"] = "failed";
    let text = "";
    let confidence: number | undefined;
    let errorMessage: string | undefined;
    try {
      const result = await this.#runner.run({
        executable: this.#pythonExecutable,
        args: ["-c", VOSK_SCRIPT, this.#modelPath, String(audioInput.sampleRateHz)],
        stdin: audioInput.bytes,
        timeoutMs: this.#timeoutMs,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
        ...(signal === undefined ? {} : { signal }),
      });
      if (result.exitCode === 41 || result.stderr.includes("VOSK_UNAVAILABLE")) {
        throw new SpeechRecognitionError("VOSK_UNAVAILABLE", "The Vosk runtime is unavailable.");
      }
      if (result.exitCode !== 0) {
        throw new SpeechRecognitionError("RECOGNITION_FAILED", "Vosk recognition failed.");
      }
      const parsed = parseRecognizerOutput(new TextDecoder().decode(result.stdout));
      text = parsed.text;
      confidence = parsed.confidence;
      status = text.length === 0 ? "unintelligible" : "complete";
    } catch (error) {
      if (error instanceof AudioProcessError && (error.code === "TIMEOUT" || error.code === "ABORTED")) {
        status = "timed_out";
        errorMessage = "Speech recognition timed out.";
      } else {
        status = "failed";
        errorMessage = safeError(error);
      }
    } finally {
      audioInput.bytes.fill(0);
    }
    const completed = this.#now();
    return {
      status,
      text,
      engine: this.engine,
      model: this.#modelName,
      language: this.#language,
      started_at: new Date(started).toISOString(),
      completed_at: new Date(completed).toISOString(),
      duration_ms: Math.max(0, completed - started),
      ...(confidence === undefined ? {} : { confidence_optional: confidence }),
      ...(errorMessage === undefined ? {} : { error_optional: errorMessage.slice(0, 300) }),
      provenance: { source: "transient_audio", processing: "local", audioRetained: false },
    };
  }
}

const FILESYSTEM_MODEL_INSPECTOR: ModelInspector = {
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
};

function parseRecognizerOutput(output: string): { text: string; confidence?: number } {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new SpeechRecognitionError("RECOGNITION_FAILED", "Vosk returned invalid JSON.", error);
  }
  if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
    throw new SpeechRecognitionError("RECOGNITION_FAILED", "Vosk returned an invalid result.");
  }
  const confidenceValue = "confidence" in value ? value.confidence : undefined;
  if (confidenceValue !== null && confidenceValue !== undefined && typeof confidenceValue !== "number") {
    throw new SpeechRecognitionError("RECOGNITION_FAILED", "Vosk returned invalid confidence.");
  }
  return {
    text: value.text.trim(),
    ...(typeof confidenceValue === "number" ? { confidence: confidenceValue } : {}),
  };
}

function validateModelPath(value: string): string {
  if (!value.startsWith("/") || value.length > MAX_MODEL_PATH_LENGTH || value.includes("\0")) {
    throw new TypeError("Vosk model path must be a bounded absolute server path.");
  }
  return value;
}

function validateExecutable(value: string): string {
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(value)) throw new TypeError("Invalid Python executable.");
  return value;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Speech recognition failed.";
}
