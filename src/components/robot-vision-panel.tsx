"use client";

import { useEffect, useState } from "react";

interface VisionStatus {
  readonly camera_detected: boolean;
  readonly camera_active: boolean;
  readonly sensor: string | null;
  readonly resolution: { readonly width: number; readonly height: number } | null;
  readonly measured_fps: number;
  readonly error: string | null;
}

export function RobotVisionPanel() {
  const [status, setStatus] = useState<VisionStatus | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/robot/vision/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Robot camera is unavailable.");
        setStatus((await response.json()) as VisionStatus);
        setError(null);
      } catch (refreshError) {
        if (!controller.signal.aborted) {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Robot camera is unavailable.",
          );
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  async function changeStream(command: "start" | "stop"): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/robot/vision/${command}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`Camera could not ${command}.`);
      const result = (await response.json()) as { camera_active: boolean };
      setStatus((current) =>
        current ? { ...current, camera_active: result.camera_active } : current,
      );
      if (result.camera_active) setStreamKey((value) => value + 1);
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Camera command failed.",
      );
    } finally {
      setPending(false);
    }
  }

  const active = status?.camera_active ?? false;
  return (
    <section className="vision-panel" aria-labelledby="vision-heading">
      <div className="vision-copy">
        <span className="eyebrow">Robot view · observation only</span>
        <h2 id="vision-heading">See what the robot sees</h2>
        <p>
          Video provides context. It cannot authorize or execute an action.
        </p>
        <div className="vision-actions">
          <button
            onClick={() => void changeStream("start")}
            disabled={pending || active}
          >
            Start video
          </button>
          <button
            onClick={() => void changeStream("stop")}
            disabled={pending || !active}
          >
            Stop video
          </button>
        </div>
        <dl className="vision-status">
          <div><dt>Camera</dt><dd>{status?.camera_detected ? (status.sensor?.toUpperCase() ?? "Detected") : "Unavailable"}</dd></div>
          <div><dt>Stream</dt><dd>{active ? "Live" : "Stopped"}</dd></div>
          <div><dt>Signal</dt><dd>{status?.resolution ? `${status.resolution.width}×${status.resolution.height} · ${status.measured_fps.toFixed(1)} fps` : "Waiting"}</dd></div>
        </dl>
        {error ? <p className="vision-error" role="status">{error}</p> : null}
      </div>
      <div className="vision-frame" data-testid="vision-frame">
        {active ? (
          // MJPEG requires a normal img element; Next Image does not support streams.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={streamKey}
            src={`/api/robot/vision/stream?v=${streamKey}`}
            alt="Live view from the robot camera"
          />
        ) : (
          <div className="vision-placeholder">
            <span className="robot-light" />
            <strong>Camera ready</strong>
            <small>Start video when the operator is present.</small>
          </div>
        )}
      </div>
    </section>
  );
}
