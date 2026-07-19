import type { SpeechToTextAdapter, TextToSpeechAdapter } from "./audio-contracts.js";
import {
  RobotHatToneAdapter,
  type RobotHatToneController,
} from "./robot-hat-tone-adapter.js";
import { TestSpeechToTextAdapter, TestTextToSpeechAdapter } from "./test-speech-adapters.js";

export type SpeechToTextSelection = "disabled" | "test" | "vosk";
export type TextToSpeechSelection = "disabled" | "test" | "robot-hat-tone";

export interface AudioAdapterSet {
  readonly speechToText: SpeechToTextAdapter;
  readonly textToSpeech: TextToSpeechAdapter;
}

export interface AudioAdapterConfiguration {
  readonly speechToText: SpeechToTextSelection;
  readonly textToSpeech: TextToSpeechSelection;
  readonly robotHatController?: RobotHatToneController;
  readonly robotHatTimeoutMs?: number;
  readonly voskAdapter?: SpeechToTextAdapter;
}

export function createAudioAdapters(configuration: AudioAdapterConfiguration): AudioAdapterSet {
  let speechToText: SpeechToTextAdapter;
  if (configuration.speechToText === "test") {
    speechToText = new TestSpeechToTextAdapter();
  } else if (configuration.speechToText === "vosk") {
    if (configuration.voskAdapter === undefined) {
      throw new TypeError("Vosk selection requires an injected, provisioned adapter.");
    }
    speechToText = configuration.voskAdapter;
  } else {
    speechToText = new DisabledSpeechToTextAdapter();
  }

  let textToSpeech: TextToSpeechAdapter;
  if (configuration.textToSpeech === "test") {
    textToSpeech = new TestTextToSpeechAdapter();
  } else if (configuration.textToSpeech === "robot-hat-tone") {
    if (configuration.robotHatController === undefined) {
      throw new TypeError("Robot HAT tone selection requires an injected controller.");
    }
    textToSpeech = new RobotHatToneAdapter({
      controller: configuration.robotHatController,
      ...(configuration.robotHatTimeoutMs === undefined
        ? {}
        : { timeoutMs: configuration.robotHatTimeoutMs }),
    });
  } else {
    textToSpeech = new DisabledTextToSpeechAdapter();
  }
  return { speechToText, textToSpeech };
}

/** Server configuration only. Browser values are never accepted here. */
export function readAudioAdapterSelection(
  environment: Readonly<Record<string, string | undefined>>,
): {
  speechToText: SpeechToTextSelection;
  textToSpeech: TextToSpeechSelection;
} {
  return {
    speechToText: parseStt(environment.CRAS_STT_ENGINE),
    textToSpeech: parseTts(environment.CRAS_TTS_ENGINE),
  };
}

class DisabledSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly engine = "disabled";
  async transcribe(): Promise<never> {
    throw new Error("Speech-to-text is disabled.");
  }
}

class DisabledTextToSpeechAdapter implements TextToSpeechAdapter {
  readonly engine = "disabled";
  async speak(): Promise<never> {
    throw new Error("Text-to-speech is disabled.");
  }
}

function parseStt(value: string | undefined): SpeechToTextSelection {
  if (value === undefined || value === "disabled") return "disabled";
  if (value === "test" || value === "vosk") return value;
  throw new TypeError("Unsupported server-side speech-to-text engine selection.");
}

function parseTts(value: string | undefined): TextToSpeechSelection {
  if (value === undefined || value === "disabled") return "disabled";
  if (value === "test" || value === "robot-hat-tone") return value;
  throw new TypeError("Unsupported server-side text-to-speech engine selection.");
}
