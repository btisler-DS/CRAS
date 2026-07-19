import { AlsaMicrophoneCaptureAdapter } from "../src/server/audio/alsa-microphone-adapter.js";
import { VoskSpeechToTextAdapter } from "../src/server/audio/vosk-speech-to-text-adapter.js";

const gate = process.env.CRAS_ENABLE_MICROPHONE_TEST;
if (gate !== "I_UNDERSTAND_THIS_RECORDS_ONE_UTTERANCE") {
  console.error(
    "Microphone verification blocked. Set CRAS_ENABLE_MICROPHONE_TEST=I_UNDERSTAND_THIS_RECORDS_ONE_UTTERANCE.",
  );
  process.exitCode = 2;
} else {
  const modelPath = process.env.CRAS_VOSK_MODEL_PATH;
  const recognizer = await VoskSpeechToTextAdapter.create({
    ...(modelPath === undefined ? {} : { modelPath }),
  });
  const microphone = new AlsaMicrophoneCaptureAdapter({ durationMs: 3_000, timeoutMs: 4_000 });
  console.error("Listening once for up to three seconds...");
  const audio = await microphone.capture();
  const transcript = await recognizer.transcribe(audio);
  console.log(JSON.stringify(transcript, null, 2));
  if (transcript.status !== "complete") process.exitCode = 1;
}
