import { spawn } from "node:child_process";

export type AudioProcessFailureCode =
  | "NOT_FOUND"
  | "TIMEOUT"
  | "ABORTED"
  | "OUTPUT_LIMIT"
  | "LAUNCH_FAILED";

export class AudioProcessError extends Error {
  readonly code: AudioProcessFailureCode;

  constructor(code: AudioProcessFailureCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AudioProcessError";
    this.code = code;
  }
}

export interface AudioProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly stdin?: Uint8Array;
  readonly signal?: AbortSignal;
}

export interface AudioProcessResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface AudioProcessRunner {
  run(request: AudioProcessRequest): Promise<AudioProcessResult>;
}

export class NodeAudioProcessRunner implements AudioProcessRunner {
  async run(request: AudioProcessRequest): Promise<AudioProcessResult> {
    if (request.signal?.aborted) {
      throw new AudioProcessError("ABORTED", "Audio process was cancelled before launch.");
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const child = spawn(request.executable, [...request.args], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });

      const cleanup = () => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
      };
      const fail = (error: AudioProcessError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const terminate = () => {
        if (!child.killed) child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 250).unref();
      };
      const abort = () => {
        terminate();
        fail(new AudioProcessError("ABORTED", "Audio process was cancelled."));
      };
      const timer = setTimeout(() => {
        terminate();
        fail(new AudioProcessError("TIMEOUT", "Audio process timed out."));
      }, request.timeoutMs);
      request.signal?.addEventListener("abort", abort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > request.maxStdoutBytes) {
          terminate();
          fail(new AudioProcessError("OUTPUT_LIMIT", "Audio output exceeded its size bound."));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > request.maxStderrBytes) {
          terminate();
          fail(new AudioProcessError("OUTPUT_LIMIT", "Audio diagnostics exceeded their size bound."));
          return;
        }
        stderr.push(chunk);
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        fail(
          new AudioProcessError(
            error.code === "ENOENT" ? "NOT_FOUND" : "LAUNCH_FAILED",
            "Audio process could not start.",
            error,
          ),
        );
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          exitCode: code ?? -1,
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      if (request.stdin === undefined) child.stdin.end();
      else child.stdin.end(Buffer.from(request.stdin));
    });
  }
}
