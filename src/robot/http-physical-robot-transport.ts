import { spawnSync } from "node:child_process";

import type { PhysicalRobotTransport, PhysicalRobotTransportRequest, PhysicalRobotTransportResponse } from "./physical-robot-adapter.js";

export interface HttpPhysicalRobotTransportOptions {
  readonly baseUrl: string;
  readonly curlExecutable?: string;
}

/** Server-only synchronous transport required by the existing synchronous RobotAdapter contract. */
export class HttpPhysicalRobotTransport implements PhysicalRobotTransport {
  readonly #baseUrl: string;
  readonly #curl: string;

  constructor(options: HttpPhysicalRobotTransportOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
      throw new TypeError("Physical worker transport must use a server-local loopback forward.");
    }
    this.#baseUrl = url.toString().replace(/\/$/, "");
    this.#curl = options.curlExecutable ?? "curl";
  }

  request(request: PhysicalRobotTransportRequest): PhysicalRobotTransportResponse {
    const result = spawnSync(this.#curl, [
      "--silent", "--show-error", "--max-time", String(Math.ceil(request.timeoutMs / 1_000)),
      "--header", "Content-Type: application/json", "--data-binary", "@-",
      "--write-out", "\n%{http_code}", `${this.#baseUrl}/dispatch`,
    ], { input: request.body, encoding: "utf8", timeout: request.timeoutMs + 500, maxBuffer: 64 * 1024, shell: false });
    if (result.error) throw result.error;
    const split = result.stdout.lastIndexOf("\n");
    if (split < 0) return { status: 503, body: "{}" };
    return { status: Number(result.stdout.slice(split + 1)) || 503, body: result.stdout.slice(0, split) };
  }
}
