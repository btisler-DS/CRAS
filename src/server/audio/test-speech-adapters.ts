import type {
  ApprovedSpeech,
  AudioInput,
  SpeechResult,
  SpeechToTextAdapter,
  TextToSpeechAdapter,
  TranscriptResult,
} from "./audio-contracts.js";

interface TestAdapterOptions {
  readonly delayMs?: number;
  readonly failWith?: string;
  readonly now?: () => number;
}

export class TestSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly engine = "test-stt";
  readonly #text: string;
  readonly #confidence: number | undefined;
  readonly #options: TestAdapterOptions;

  constructor(options: TestAdapterOptions & { text?: string; confidence?: number } = {}) {
    this.#text = options.text ?? "test transcript";
    this.#confidence = options.confidence;
    this.#options = options;
  }

  async transcribe(audioInput: AudioInput, signal?: AbortSignal): Promise<TranscriptResult> {
    const now = this.#options.now ?? Date.now;
    const started = now();
    await boundedDelay(this.#options.delayMs ?? 0, signal);
    if (this.#options.failWith) throw new Error(this.#options.failWith);
    const completed = now();
    return {
      status: "complete",
      text: this.#text,
      engine: this.engine,
      model: "deterministic-test-model",
      language: "en-US",
      started_at: new Date(started).toISOString(),
      completed_at: new Date(completed).toISOString(),
      duration_ms: Math.max(0, completed - started),
      ...(this.#confidence === undefined ? {} : { confidence_optional: this.#confidence }),
      provenance: {
        source: audioInput.source === "test" ? "test" : "transient_audio",
        processing: "local",
        audioRetained: false,
      },
    };
  }
}

export class TestTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly engine = "test-tts";
  readonly calls: ApprovedSpeech[] = [];
  readonly #options: TestAdapterOptions;

  constructor(options: TestAdapterOptions = {}) {
    this.#options = options;
  }

  async speak(approvedSpeech: ApprovedSpeech, signal?: AbortSignal): Promise<SpeechResult> {
    const now = this.#options.now ?? Date.now;
    const started = now();
    this.calls.push(approvedSpeech);
    try {
      await boundedDelay(this.#options.delayMs ?? 0, signal);
      if (this.#options.failWith) throw new Error(this.#options.failWith);
      return result("completed", this.engine, started, now(), true);
    } catch (error) {
      return result(
        signal?.aborted ? "timed_out" : "failed",
        this.engine,
        started,
        now(),
        true,
        safeMessage(error),
      );
    }
  }
}

function result(
  status: SpeechResult["status"],
  engine: string,
  started: number,
  completed: number,
  cleanup: boolean,
  error?: string,
): SpeechResult {
  return {
    status,
    engine,
    started_at: new Date(started).toISOString(),
    completed_at: new Date(completed).toISOString(),
    duration_ms: Math.max(0, completed - started),
    cleanup_completed: cleanup,
    ...(error === undefined ? {} : { error_optional: error }),
  };
}

async function boundedDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Operation cancelled.");
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Operation cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "Speech operation failed.";
}
