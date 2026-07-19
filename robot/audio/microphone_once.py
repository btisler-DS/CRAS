#!/usr/bin/env python3
"""One bounded local Vosk utterance; no capture occurs on import."""
import array, json, math, os, subprocess, sys, time

GATE = "I_UNDERSTAND_THIS_RECORDS_ONE_UTTERANCE"
DEVICE = "hw:CARD=Device,DEV=0"
MODEL = os.environ.get("CRAS_VOSK_MODEL_PATH", "/opt/cras-runtime/models/vosk-model-small-en-us-0.15")

def main():
    if os.environ.get("CRAS_ENABLE_MICROPHONE_TEST") != GATE:
        raise SystemExit("microphone gate not enabled")
    if not os.path.isdir(MODEL):
        print(json.dumps({"status":"failed","code":"MODEL_NOT_FOUND"})); return 2
    if os.environ.get("CRAS_WAIT_FOR_OPERATOR_CUE") == "1":
        print("CRAS_MICROPHONE_READY", flush=True)
        input()
    started = time.time()
    result = subprocess.run([
        "arecord", "-q", "-D", DEVICE, "-t", "raw", "-f", "S16_LE",
        "-r", "48000", "-c", "1", "-d", "3", "-"
    ], capture_output=True, timeout=4, check=False)
    audio = bytearray(result.stdout)
    recognition_audio = bytearray()
    try:
        if result.returncode != 0 or not audio:
            print(json.dumps({"status":"failed","code":"CAPTURE_FAILED"})); return 3
        if len(audio) > 288000:
            print(json.dumps({"status":"failed","code":"CAPTURE_SIZE_EXCEEDED"})); return 4
        samples = array.array("h")
        samples.frombytes(audio)
        if sys.byteorder != "little":
            samples.byteswap()
        peak = max((abs(value) for value in samples), default=0)
        rms = math.sqrt(sum(value * value for value in samples) / len(samples)) if samples else 0.0
        resampled = subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "pipe:0",
            "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1",
        ], input=audio, capture_output=True, timeout=3, check=False)
        if resampled.returncode != 0 or not resampled.stdout:
            print(json.dumps({"status":"failed","code":"RESAMPLE_FAILED"})); return 5
        recognition_audio = bytearray(resampled.stdout)
        if len(recognition_audio) > 96000:
            print(json.dumps({"status":"failed","code":"RESAMPLE_SIZE_EXCEEDED"})); return 6
        from vosk import Model, KaldiRecognizer, SetLogLevel
        SetLogLevel(-1)
        recognizer = KaldiRecognizer(Model(MODEL), 16000)
        recognizer.SetWords(True)
        recognizer.AcceptWaveform(bytes(recognition_audio))
        value = json.loads(recognizer.FinalResult())
        words = value.get("result", [])
        confidence = sum(float(w["conf"]) for w in words) / len(words) if words else None
        print(json.dumps({
            "status":"complete" if value.get("text") else "unintelligible",
            "text":value.get("text", ""), "confidence":confidence, "language":"en-US",
            "engine":"vosk", "model":"vosk-model-small-en-us-0.15", "device":DEVICE,
            "capture_sample_rate_hz":48000, "recognition_sample_rate_hz":16000,
            "peak_level":peak, "peak_dbfs":round(20*math.log10(peak/32768), 2) if peak else None,
            "rms_level":round(rms, 2), "rms_dbfs":round(20*math.log10(rms/32768), 2) if rms else None,
            "duration_ms":round((time.time()-started)*1000), "audio_retained":False
        }, separators=(",", ":")))
        return 0
    finally:
        audio[:] = b"\0" * len(audio)
        recognition_audio[:] = b"\0" * len(recognition_audio)

if __name__ == "__main__":
    sys.exit(main())
