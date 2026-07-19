import { createApprovedSpeech, createBoundedToneRequest } from "../src/server/audio/audio-contracts.js";
import { RobotHatToneAdapter } from "../src/server/audio/robot-hat-tone-adapter.js";
import { SunFounderRobotHatToneController } from "../src/server/audio/robot-hat-tone-controller.js";

const gate = process.env.CRAS_ENABLE_ROBOT_HAT_TONE_TEST;
if (gate !== "I_UNDERSTAND_THIS_PLAYS_AUDIO") {
  console.error(
    "Hardware tone blocked. Set CRAS_ENABLE_ROBOT_HAT_TONE_TEST=I_UNDERSTAND_THIS_PLAYS_AUDIO explicitly.",
  );
  process.exitCode = 2;
} else {
  const adapter = new RobotHatToneAdapter({
    controller: new SunFounderRobotHatToneController(),
    timeoutMs: 7_000,
  });
  const speech = createApprovedSpeech({
    speechId: "spk_hardware_verification",
    originatingResponseId: "rsp_hardware_verification",
    language: "en-US",
    output: createBoundedToneRequest({ frequencyHz: 440, durationMs: 1_000 }),
  });
  const result = await adapter.speak(speech);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed" || !result.cleanup_completed) process.exitCode = 1;
}
