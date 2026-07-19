import type {
  ApprovedSpeech,
  BoundedToneRequest,
  SpeechResult,
  TextToSpeechAdapter,
} from "./audio-contracts.js";
import { isApprovedSpeech } from "./audio-contracts.js";

export interface RobotHatPin20State {
  readonly mode: string;
  readonly pull: string;
  readonly level: "low" | "high";
  readonly opaque: string;
}

/**
 * Narrow hardware boundary for a future robot-local implementation.
 * `playToneWithMusic` must use `Music.play_tone_for()` and honor cancellation.
 */
export interface RobotHatToneController {
  recordPin20State(): Promise<RobotHatPin20State>;
  enableAmplifier(): Promise<void>;
  playToneWithMusic(request: BoundedToneRequest, signal: AbortSignal): Promise<void>;
  disableAmplifier(): Promise<void>;
  restorePin20(state: RobotHatPin20State): Promise<void>;
}

export interface RobotHatToneAdapterOptions {
  readonly controller: RobotHatToneController;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export class RobotHatToneAdapter implements TextToSpeechAdapter {
  readonly engine = "robot-hat-music-pyaudio";
  readonly #controller: RobotHatToneController;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(options: RobotHatToneAdapterOptions) {
    this.#controller = options.controller;
    this.#timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 10_000) {
      throw new TypeError("Robot HAT tone timeout is outside its allowed bounds.");
    }
    this.#now = options.now ?? Date.now;
  }

  async speak(approvedSpeech: ApprovedSpeech, signal?: AbortSignal): Promise<SpeechResult> {
    if (!isApprovedSpeech(approvedSpeech) || approvedSpeech.output.kind !== "tone") {
      return this.#unsupported();
    }
    return this.#speakTone(approvedSpeech.output, signal);
  }

  async #speakTone(request: BoundedToneRequest, downstream?: AbortSignal): Promise<SpeechResult> {
    const started = this.#now();
    const controller = new AbortController();
    let pinState: RobotHatPin20State | undefined;
    let status: SpeechResult["status"] = "completed";
    let error: string | undefined;
    let disableSucceeded = false;
    let restoreSucceeded = false;
    let timedOut = false;

    const onDownstreamAbort = () => controller.abort(downstream?.reason);
    downstream?.addEventListener("abort", onDownstreamAbort, { once: true });
    if (downstream?.aborted) onDownstreamAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Robot HAT tone timed out."));
    }, this.#timeoutMs);

    try {
      pinState = await this.#controller.recordPin20State();
      await this.#controller.enableAmplifier();
      await rejectOnAbort(
        this.#controller.playToneWithMusic(request, controller.signal),
        controller.signal,
      );
    } catch (cause) {
      status = timedOut ? "timed_out" : "failed";
      error = safeError(cause);
    } finally {
      clearTimeout(timer);
      downstream?.removeEventListener("abort", onDownstreamAbort);
      try {
        await this.#controller.disableAmplifier();
        disableSucceeded = true;
      } catch (cause) {
        status = "failed";
        error = appendError(error, `Amplifier cleanup failed: ${safeError(cause)}`);
      }
      if (pinState !== undefined) {
        try {
          await this.#controller.restorePin20(pinState);
          restoreSucceeded = true;
        } catch (cause) {
          status = "failed";
          error = appendError(error, `Pin restoration failed: ${safeError(cause)}`);
        }
      } else {
        status = "failed";
        error = appendError(error, "Pin state was not recorded; restoration was impossible.");
      }
    }

    const completed = this.#now();
    return {
      status,
      engine: this.engine,
      started_at: new Date(started).toISOString(),
      completed_at: new Date(completed).toISOString(),
      duration_ms: Math.max(0, completed - started),
      cleanup_completed: disableSucceeded && restoreSucceeded,
      ...(error === undefined ? {} : { error_optional: error.slice(0, 500) }),
    };
  }

  #unsupported(): SpeechResult {
    const now = this.#now();
    return {
      status: "failed",
      engine: this.engine,
      started_at: new Date(now).toISOString(),
      completed_at: new Date(now).toISOString(),
      duration_ms: 0,
      cleanup_completed: true,
      error_optional: "Robot HAT tone output accepts approved bounded tones only.",
    };
  }
}

function rejectOnAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "Robot HAT tone operation failed.";
}

function appendError(existing: string | undefined, next: string): string {
  return existing === undefined ? next : `${existing} ${next}`;
}
