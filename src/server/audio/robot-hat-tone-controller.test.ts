import { describe, expect, it } from "vitest";

import { createBoundedToneRequest } from "./audio-contracts.js";
import {
  NodeBoundedProcessRunner,
  ProcessRunnerError,
  RobotHatControllerError,
  SunFounderRobotHatToneController,
  type BoundedProcessRequest,
  type BoundedProcessResult,
  type BoundedProcessRunner,
} from "./robot-hat-tone-controller.js";

class FakeRunner implements BoundedProcessRunner {
  readonly requests: BoundedProcessRequest[] = [];
  readonly results: Array<BoundedProcessResult | Error> = [];

  async run(request: BoundedProcessRequest): Promise<BoundedProcessResult> {
    this.requests.push(request);
    const result = this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
    if (result instanceof Error) throw result;
    return result;
  }
}

function controller(runner: FakeRunner) {
  return new SunFounderRobotHatToneController({ runner, processTimeoutMs: 500 });
}

describe("SunFounderRobotHatToneController", () => {
  it("imports and constructs without starting Python, pinctrl, audio, or GPIO", () => {
    const runner = new FakeRunner();
    controller(runner);
    expect(runner.requests).toEqual([]);
  });

  it("records and restores the exact bounded GPIO20 state", async () => {
    const runner = new FakeRunner();
    runner.results.push({
      exitCode: 0,
      stdout: "20: a0    pd | lo // GPIO20 = PCM_DIN\n",
      stderr: "",
    });
    const instance = controller(runner);
    const state = await instance.recordPin20State();
    expect(state).toMatchObject({ mode: "a0", pull: "pd", level: "low" });
    await instance.restorePin20(state);
    expect(runner.requests.map(({ executable, args }) => ({ executable, args }))).toEqual([
      { executable: "pinctrl", args: ["get", "20"] },
      { executable: "pinctrl", args: ["set", "20", "a0", "pd"] },
    ]);
  });

  it("uses only Music.play_tone_for without running the Music constructor", async () => {
    const runner = new FakeRunner();
    const instance = controller(runner);
    await instance.playToneWithMusic(
      createBoundedToneRequest({ frequencyHz: 440, durationMs: 1_000 }),
      new AbortController().signal,
    );
    const request = runner.requests[0];
    expect(request?.executable).toBe("python3");
    expect(request?.args.slice(-2)).toEqual(["440", "1"]);
    expect(request?.args[1]).toContain("Music.__new__(Music)");
    expect(request?.args[1]).toContain("music.play_tone_for(frequency, duration)");
    expect(request?.args[1]).not.toContain("Music()");
  });

  it("revalidates runtime tone bounds before launching Python", async () => {
    const runner = new FakeRunner();
    const instance = controller(runner);
    await expect(
      instance.playToneWithMusic(
        { kind: "tone", frequencyHz: 50_000, durationMs: 1_000 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("frequency");
    expect(runner.requests).toEqual([]);
  });

  it.each([
    [new ProcessRunnerError("NOT_FOUND", "missing"), "PYTHON_UNAVAILABLE"],
    [new ProcessRunnerError("TIMEOUT", "late"), "PLAYBACK_TIMEOUT"],
    [new ProcessRunnerError("ABORTED", "cancelled"), "PLAYBACK_TIMEOUT"],
  ] as const)("maps process failure to %s", async (failure, code) => {
    const runner = new FakeRunner();
    runner.results.push(failure);
    await expect(
      controller(runner).playToneWithMusic(
        createBoundedToneRequest({ frequencyHz: 440, durationMs: 1_000 }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [41, "CRAS_ERROR:ROBOT_HAT_LIBRARY_UNAVAILABLE", "ROBOT_HAT_LIBRARY_UNAVAILABLE"],
    [42, "CRAS_ERROR:PLAYBACK_FAILURE", "PLAYBACK_FAILURE"],
    [9, "unexpected", "ABNORMAL_PROCESS_EXIT"],
  ] as const)("maps exit %s to %s", async (exitCode, stderr, code) => {
    const runner = new FakeRunner();
    runner.results.push({ exitCode, stdout: "", stderr });
    await expect(
      controller(runner).playToneWithMusic(
        createBoundedToneRequest({ frequencyHz: 440, durationMs: 1_000 }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("uses narrow fixed amplifier scripts and reports library failure", async () => {
    const runner = new FakeRunner();
    runner.results.push({ exitCode: 41, stdout: "", stderr: "ROBOT_HAT_LIBRARY_UNAVAILABLE" });
    const instance = controller(runner);
    await expect(instance.enableAmplifier()).rejects.toBeInstanceOf(RobotHatControllerError);
    expect(runner.requests[0]?.args[1]).toContain("from robot_hat import enable_speaker");
    expect(runner.requests[0]?.args).toHaveLength(2);
  });

  it("refuses unrecognized pin output instead of restoring it", async () => {
    const runner = new FakeRunner();
    runner.results.push({ exitCode: 0, stdout: "20: malicious mode", stderr: "" });
    await expect(controller(runner).recordPin20State()).rejects.toMatchObject({
      code: "PIN_STATE_INVALID",
    });
  });
});

describe("NodeBoundedProcessRunner", () => {
  it("terminates a hardware-free subprocess at its hard timeout", async () => {
    const runner = new NodeBoundedProcessRunner();
    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "setTimeout(() => {}, 5000)"],
        timeoutMs: 50,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
