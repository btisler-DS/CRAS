import type { TranscriptResult } from "../server/audio/audio-contracts.js";
import type { SpeechPipeline } from "../server/audio/speech-pipeline.js";
import {
  ConversationIntentResolver,
  type ResolvedConversationIntent,
} from "./conversation-intent-resolver.js";

export type VoiceIntentPipelineResult =
  | { readonly status: "routed"; readonly transcript: TranscriptResult; readonly resolution: ResolvedConversationIntent }
  | { readonly status: "unresolved"; readonly transcript: TranscriptResult; readonly resolution: null; readonly reason: string };

export interface VoiceIntentPipelineOptions {
  readonly speech: Pick<SpeechPipeline, "transcribeOnce">;
  readonly resolver?: ConversationIntentResolver;
  readonly minimumConfidence?: number;
}

export class VoiceIntentPipeline {
  readonly #speech: Pick<SpeechPipeline, "transcribeOnce">;
  readonly #resolver: ConversationIntentResolver;
  readonly #minimumConfidence: number;

  constructor(options: VoiceIntentPipelineOptions) {
    this.#speech = options.speech;
    this.#resolver = options.resolver ?? new ConversationIntentResolver();
    this.#minimumConfidence = options.minimumConfidence ?? 0.7;
    if (!Number.isFinite(this.#minimumConfidence) || this.#minimumConfidence < 0 || this.#minimumConfidence > 1) {
      throw new TypeError("Minimum transcript confidence must be between zero and one.");
    }
  }

  async resolveOnce(signal?: AbortSignal): Promise<VoiceIntentPipelineResult> {
    const transcript = await this.#speech.transcribeOnce(signal);
    if (transcript.status !== "complete" || transcript.text.trim().length === 0) {
      return { status: "unresolved", transcript, resolution: null, reason: "Transcript is not complete." };
    }
    if (
      transcript.confidence_optional !== undefined &&
      transcript.confidence_optional < this.#minimumConfidence
    ) {
      return { status: "unresolved", transcript, resolution: null, reason: "Transcript confidence is too low." };
    }
    return {
      status: "routed",
      transcript,
      resolution: this.#resolver.resolve({ text: transcript.text, source: "voice" }),
    };
  }
}
