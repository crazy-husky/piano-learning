import { useCallback, useEffect, useRef, useState } from "react";

export interface MicrophoneParameterBenchmarkTake {
  deviceLabel: string;
  durationMs: number;
  originalRecording: Blob;
  mimeType: string;
  sampleRate: number;
  samples: Float32Array;
  trackSampleRate: number | null;
}

export function useMicrophoneParameterBenchmarkRecording(): {
  elapsedMs: number;
  error: string | null;
  isRecording: boolean;
  isStarting: boolean;
  cancel: () => void;
  resetError: () => void;
  start: () => Promise<void>;
  stop: () => Promise<MicrophoneParameterBenchmarkTake | null>;
} {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const startTokenRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setElapsedMs(0);
    if (isStarting || isRecording || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持麦克风录音，请使用较新的浏览器后重试。");
      return;
    }

    const startToken = ++startTokenRef.current;
    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      if (startToken !== startTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("录音中断，请检查麦克风权限或设备连接后重试。");
        releaseStream();
      };
      recorderRef.current = recorder;
      startTimeRef.current = performance.now();
      recorder.start(250);
      setIsRecording(true);
    } catch (captureError) {
      if (startToken === startTokenRef.current) {
        releaseStream();
        const name = captureError instanceof DOMException ? captureError.name : "";
        setError(
          name === "NotAllowedError"
            ? "麦克风权限未开启，请允许浏览器使用麦克风后重试。"
            : captureError instanceof Error
              ? `无法开始录音：${captureError.message}`
              : "无法开始录音，请检查麦克风后重试。"
        );
      }
    } finally {
      if (startToken === startTokenRef.current) setIsStarting(false);
    }
  }, [isRecording, isStarting, releaseStream]);

  const stop = useCallback(async (): Promise<MicrophoneParameterBenchmarkTake | null> => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (!recorder || recorder.state === "inactive" || !stream) return null;
    const track = stream.getAudioTracks()[0];
    const trackSettings = track?.getSettings();
    const deviceLabel = track?.label || "麦克风名称不可用";
    const trackSampleRate = trackSettings?.sampleRate ?? null;
    const durationMs = Math.max(0, performance.now() - startTimeRef.current);

    const recording = await new Promise<{ blob: Blob; mimeType: string } | null>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        releaseStream();
        resolve(blob.size > 0 ? { blob, mimeType } : null);
      };
      recorder.stop();
    });
    if (!recording) return null;

    const context = new AudioContext();
    try {
      const audioBuffer = await context.decodeAudioData(await recording.blob.arrayBuffer());
      const samples = new Float32Array(audioBuffer.length);
      audioBuffer.copyFromChannel(samples, 0);
      return {
        deviceLabel,
        durationMs,
        mimeType: recording.mimeType,
        originalRecording: recording.blob,
        sampleRate: audioBuffer.sampleRate,
        samples,
        trackSampleRate,
      };
    } catch (decodeError) {
      setError(
        decodeError instanceof Error
          ? `录音解码失败：${decodeError.message}`
          : "录音解码失败，请重新录制。"
      );
      return null;
    } finally {
      await context.close();
    }
  }, [releaseStream]);

  const cancel = useCallback(() => {
    startTokenRef.current += 1;
    setIsStarting(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    releaseStream();
  }, [releaseStream]);

  useEffect(() => {
    if (!isRecording) return;
    const timerId = window.setInterval(
      () => setElapsedMs(performance.now() - startTimeRef.current),
      200
    );
    return () => window.clearInterval(timerId);
  }, [isRecording]);

  useEffect(
    () => () => {
      startTokenRef.current += 1;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  return {
    cancel,
    elapsedMs,
    error,
    isRecording,
    isStarting,
    resetError: () => setError(null),
    start,
    stop,
  };
}
