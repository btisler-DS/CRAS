import type {
  MicrophoneCaptureAdapter,
  SpeechToTextAdapter,
  TranscriptResult,
} from "./audio-contracts.js";

export interface SpeechPipelineOptions {
  readonly microphone: MicrophoneCaptureAdapter;
  readonly speechToText: SpeechToTextAdapter;
}

/**
 * Phase 5D-5 boundary: capture one bounded utterance and transcribe it.
 * The transcript is returned as untrusted input; this class cannot route,
 * authorize, persist, dispatch, or execute it.
 */
export class SpeechPipeline {
  readonly #microphone: MicrophoneCaptureAdapter;
  readonly #speechToText: SpeechToTextAdapter;

  constructor(options: SpeechPipelineOptions) {
    this.#microphone = options.microphone;
    this.#speechToText = options.speechToText;
  }

  async transcribeOnce(signal?: AbortSignal): Promise<TranscriptResult> {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    const audio = await this.#microphone.capture(signal);
    return this.#speechToText.transcribe(audio, signal);
  }
}
