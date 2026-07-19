import { spawn } from "node:child_process";

import { createBoundedToneRequest, type BoundedToneRequest } from "./audio-contracts.js";
import type {
  RobotHatPin20State,
  RobotHatToneController,
} from "./robot-hat-tone-adapter.js";

const PIN_NUMBER = "20";
const DEFAULT_PROCESS_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const ENABLE_SCRIPT = String.raw`
import sys
try:
    from robot_hat import enable_speaker
except ModuleNotFoundError as error:
    sys.stderr.write("CRAS_ERROR:ROBOT_HAT_LIBRARY_UNAVAILABLE:" + str(error))
    raise SystemExit(41)
try:
    enable_speaker()
except BaseException as error:
    sys.stderr.write("CRAS_ERROR:AMPLIFIER_CONTROL_FAILURE:" + type(error).__name__ + ":" + str(error))
    raise SystemExit(43)
`;

const DISABLE_SCRIPT = String.raw`
import sys
try:
    from robot_hat import disable_speaker
except ModuleNotFoundError as error:
    sys.stderr.write("CRAS_ERROR:ROBOT_HAT_LIBRARY_UNAVAILABLE:" + str(error))
    raise SystemExit(41)
try:
    disable_speaker()
except BaseException as error:
    sys.stderr.write("CRAS_ERROR:AMPLIFIER_CONTROL_FAILURE:" + type(error).__name__ + ":" + str(error))
    raise SystemExit(43)
`;

/**
 * Calls the verified PyAudio method without `Music.__init__()`. The adapter has
 * already enabled GPIO20; running the constructor here would duplicate that lifecycle.
 */
const PLAY_TONE_SCRIPT = String.raw`
import math
import sys
try:
    from robot_hat import Music
except ModuleNotFoundError as error:
    sys.stderr.write("CRAS_ERROR:ROBOT_HAT_LIBRARY_UNAVAILABLE:" + str(error))
    raise SystemExit(41)
try:
    frequency = float(sys.argv[1])
    duration = float(sys.argv[2])
    if not math.isfinite(frequency) or frequency < 100 or frequency > 2000:
        raise ValueError("frequency outside allowed bounds")
    if not math.isfinite(duration) or duration < 0.05 or duration > 2.0:
        raise ValueError("duration outside allowed bounds")
    music = Music.__new__(Music)
    music.play_tone_for(frequency, duration)
except BaseException as error:
    sys.stderr.write("CRAS_ERROR:PLAYBACK_FAILURE:" + type(error).__name__ + ":" + str(error))
    raise SystemExit(42)
`;

export type RobotHatControllerErrorCode =
  | "PYTHON_UNAVAILABLE"
  | "ROBOT_HAT_LIBRARY_UNAVAILABLE"
  | "PLAYBACK_FAILURE"
  | "PLAYBACK_TIMEOUT"
  | "ABNORMAL_PROCESS_EXIT"
  | "AMPLIFIER_CONTROL_FAILURE"
  | "PIN_CONTROL_FAILURE"
  | "PIN_STATE_INVALID";

export class RobotHatControllerError extends Error {
  readonly code: RobotHatControllerErrorCode;

  constructor(code: RobotHatControllerErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RobotHatControllerError";
    this.code = code;
  }
}

export interface BoundedProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes: number;
}

export interface BoundedProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunnerFailureCode = "NOT_FOUND" | "TIMEOUT" | "ABORTED" | "LAUNCH_FAILED";

export class ProcessRunnerError extends Error {
  readonly code: ProcessRunnerFailureCode;

  constructor(code: ProcessRunnerFailureCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ProcessRunnerError";
    this.code = code;
  }
}

export interface BoundedProcessRunner {
  run(request: BoundedProcessRequest): Promise<BoundedProcessResult>;
}

export interface SunFounderRobotHatToneControllerOptions {
  readonly pythonExecutable?: string;
  readonly pinctrlExecutable?: string;
  readonly processTimeoutMs?: number;
  readonly runner?: BoundedProcessRunner;
}

/**
 * Concrete Robot HAT v4 controller. Import and construction are passive; each
 * hardware operation occurs only when RobotHatToneAdapter invokes a contract method.
 */
export class SunFounderRobotHatToneController implements RobotHatToneController {
  readonly #pythonExecutable: string;
  readonly #pinctrlExecutable: string;
  readonly #processTimeoutMs: number;
  readonly #runner: BoundedProcessRunner;

  constructor(options: SunFounderRobotHatToneControllerOptions = {}) {
    this.#pythonExecutable = validateExecutable(options.pythonExecutable ?? "python3");
    this.#pinctrlExecutable = validateExecutable(options.pinctrlExecutable ?? "pinctrl");
    this.#processTimeoutMs = options.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (
      !Number.isInteger(this.#processTimeoutMs) ||
      this.#processTimeoutMs < 100 ||
      this.#processTimeoutMs > 10_000
    ) {
      throw new TypeError("Robot HAT process timeout is outside its allowed bounds.");
    }
    this.#runner = options.runner ?? new NodeBoundedProcessRunner();
  }

  async recordPin20State(): Promise<RobotHatPin20State> {
    const result = await this.#runPin(["get", PIN_NUMBER]);
    if (result.exitCode !== 0) {
      throw new RobotHatControllerError(
        "PIN_CONTROL_FAILURE",
        `Unable to read GPIO20 state (exit ${result.exitCode}).`,
      );
    }
    return parsePin20State(result.stdout);
  }

  async enableAmplifier(): Promise<void> {
    await this.#runPython(ENABLE_SCRIPT, [], "amplifier");
  }

  async playToneWithMusic(request: BoundedToneRequest, signal: AbortSignal): Promise<void> {
    const bounded = createBoundedToneRequest(request);
    await this.#runPython(
      PLAY_TONE_SCRIPT,
      [String(bounded.frequencyHz), String(bounded.durationMs / 1_000)],
      "playback",
      signal,
    );
  }

  async disableAmplifier(): Promise<void> {
    await this.#runPython(DISABLE_SCRIPT, [], "amplifier");
  }

  async restorePin20(state: RobotHatPin20State): Promise<void> {
    const validated = validatePinState(state);
    const args = ["set", PIN_NUMBER, validated.mode];
    if (validated.pull !== "--") args.push(validated.pull);
    if (validated.mode === "op") args.push(validated.level === "high" ? "dh" : "dl");
    const result = await this.#runPin(args);
    if (result.exitCode !== 0) {
      throw new RobotHatControllerError(
        "PIN_CONTROL_FAILURE",
        `Unable to restore GPIO20 state (exit ${result.exitCode}).`,
      );
    }
  }

  async #runPython(
    script: string,
    args: readonly string[],
    operation: "amplifier" | "playback",
    signal?: AbortSignal,
  ): Promise<void> {
    let result: BoundedProcessResult;
    try {
      result = await this.#runner.run({
        executable: this.#pythonExecutable,
        args: ["-c", script, ...args],
        timeoutMs: this.#processTimeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof ProcessRunnerError && error.code === "NOT_FOUND") {
        throw new RobotHatControllerError("PYTHON_UNAVAILABLE", "Python is unavailable.", error);
      }
      if (
        operation === "playback" &&
        error instanceof ProcessRunnerError &&
        (error.code === "TIMEOUT" || error.code === "ABORTED")
      ) {
        throw new RobotHatControllerError("PLAYBACK_TIMEOUT", "Robot HAT playback timed out.", error);
      }
      throw new RobotHatControllerError(
        operation === "playback" ? "ABNORMAL_PROCESS_EXIT" : "AMPLIFIER_CONTROL_FAILURE",
        `Robot HAT ${operation} process could not complete.`,
        error,
      );
    }

    if (result.exitCode === 0) return;
    if (result.exitCode === 41 || result.stderr.includes("ROBOT_HAT_LIBRARY_UNAVAILABLE")) {
      throw new RobotHatControllerError(
        "ROBOT_HAT_LIBRARY_UNAVAILABLE",
        "The Robot HAT Python library is unavailable.",
      );
    }
    if (operation === "playback" && (result.exitCode === 42 || result.stderr.includes("PLAYBACK_FAILURE"))) {
      throw new RobotHatControllerError("PLAYBACK_FAILURE", "Robot HAT PyAudio playback failed.");
    }
    if (operation === "amplifier" && result.stderr.includes("AMPLIFIER_CONTROL_FAILURE")) {
      throw new RobotHatControllerError("AMPLIFIER_CONTROL_FAILURE", "Robot HAT amplifier control failed.");
    }
    throw new RobotHatControllerError(
      "ABNORMAL_PROCESS_EXIT",
      `Robot HAT ${operation} process exited abnormally (${result.exitCode}).`,
    );
  }

  async #runPin(args: readonly string[]): Promise<BoundedProcessResult> {
    try {
      return await this.#runner.run({
        executable: this.#pinctrlExecutable,
        args,
        timeoutMs: this.#processTimeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
    } catch (error) {
      throw new RobotHatControllerError("PIN_CONTROL_FAILURE", "GPIO20 control failed.", error);
    }
  }
}

export class NodeBoundedProcessRunner implements BoundedProcessRunner {
  async run(request: BoundedProcessRequest): Promise<BoundedProcessResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      const child = spawn(request.executable, [...request.args], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });

      const finishReject = (error: ProcessRunnerError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        reject(error);
      };
      const stop = () => {
        if (!child.killed) child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 250).unref();
      };
      const abort = () => {
        stop();
        finishReject(new ProcessRunnerError("ABORTED", "Process cancelled."));
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
        finishReject(new ProcessRunnerError("TIMEOUT", "Process timed out."));
      }, request.timeoutMs);

      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) abort();

      const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > request.maxOutputBytes) {
          stop();
          finishReject(new ProcessRunnerError("LAUNCH_FAILED", "Process output exceeded its bound."));
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
      child.once("error", (error: NodeJS.ErrnoException) => {
        finishReject(
          new ProcessRunnerError(
            error.code === "ENOENT" ? "NOT_FOUND" : "LAUNCH_FAILED",
            "Process could not start.",
            error,
          ),
        );
      });
      child.once("close", (code) => {
        if (settled || timedOut) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}

function parsePin20State(output: string): RobotHatPin20State {
  const line = output.trim();
  const match = /^20:\s+([a-z0-9]+)\s+([a-z-]+)\s+\|\s+(lo|hi)\b/.exec(line);
  if (!match) {
    throw new RobotHatControllerError("PIN_STATE_INVALID", "GPIO20 returned an unrecognized state.");
  }
  const mode = match[1];
  const pull = match[2];
  if (mode === undefined || pull === undefined || !isAllowedMode(mode) || !isAllowedPull(pull)) {
    throw new RobotHatControllerError("PIN_STATE_INVALID", "GPIO20 returned an unsafe state.");
  }
  return {
    mode,
    pull,
    level: match[3] === "hi" ? "high" : "low",
    opaque: line.slice(0, 200),
  };
}

function validatePinState(state: RobotHatPin20State): RobotHatPin20State {
  if (
    !isAllowedMode(state.mode) ||
    !isAllowedPull(state.pull) ||
    (state.level !== "low" && state.level !== "high")
  ) {
    throw new RobotHatControllerError("PIN_STATE_INVALID", "Refusing to restore an invalid GPIO20 state.");
  }
  return state;
}

function isAllowedMode(value: string): boolean {
  return /^(?:a[0-8]|ip|op|no)$/.test(value);
}

function isAllowedPull(value: string): boolean {
  return /^(?:pd|pu|pn|--)$/.test(value);
}

function validateExecutable(value: string): string {
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(value)) {
    throw new TypeError("Invalid controller executable.");
  }
  return value;
}
