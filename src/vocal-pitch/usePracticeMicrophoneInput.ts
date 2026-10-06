import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOCAL_PITCH_CONFIG } from "../domain/vocalPitch";
import {
  classifyPitchFrame,
  MIN_VOICED_RMS,
} from "./pitchFrameClassifier";
import {
  createPitchFrameDetector,
  getPitchFrameSize,
  type PitchFrameDetector,
} from "./pitchFrameDetector";
import {
  createPracticeNoteRecognizer,
  frequencyToNaturalPracticeNote,
  PRACTICE_NOTE_FREQUENCY_RANGE,
  type PracticeNoteRecognizer,
} from "./practiceNoteRecognizer";
import type { PracticeAnswerInput } from "../domain/answerInput";

export type PracticeMicrophoneStatus = "idle" | "requesting" | "listening" | "error";

interface PracticeMicrophoneState {
  detectedNote: string | null;
  error: string | null;
  inputLevel: number;
  status: PracticeMicrophoneStatus;
}

const FRAME_INTERVAL_MS = 30;
const INPUT_LEVEL_UPDATE_INTERVAL_MS = 100;
const DETECTED_NOTE_HOLD_MS = 1200;

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "麦克风权限未允许，请在浏览器中授权后重试。";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "没有找到可用的麦克风。";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "麦克风无法启动，请检查设备是否正被其他应用占用。";
    }
  }
  return "麦克风启动失败，请检查浏览器权限和输入设备。";
}

export function usePracticeMicrophoneInput(onAnswer: (answer: PracticeAnswerInput) => void) {
  const [state, setState] = useState<PracticeMicrophoneState>({
    detectedNote: null,
    error: null,
    inputLevel: 0,
    status: "idle",
  });
  const stateRef = useRef<PracticeMicrophoneStatus>("idle");
  const mountedRef = useRef(false);
  const startGenerationRef = useRef(0);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const errorRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const detectorRef = useRef<PitchFrameDetector | null>(null);
  const recognizerRef = useRef<PracticeNoteRecognizer>(createPracticeNoteRecognizer());
  const sampleBufferRef = useRef(new Float32Array(0));
  const animationRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const lastLevelUpdateAtRef = useRef(0);
  const lastVoicedAtRef = useRef(0);
  const callbacksRef = useRef({ onAnswer });
  callbacksRef.current = { onAnswer };

  const updateStatus = useCallback((status: PracticeMicrophoneStatus, error: string | null = null): void => {
    stateRef.current = status;
    errorRef.current = error;
    if (mountedRef.current) {
      setState((current) => ({ ...current, error, status }));
    }
  }, []);

  const releaseDevices = useCallback((): void => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    detectorRef.current = null;
    sampleBufferRef.current = new Float32Array(0);
    recognizerRef.current.reset();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    if (mountedRef.current) {
      setState((current) => ({ ...current, detectedNote: null, inputLevel: 0 }));
    }
  }, []);

  const fail = useCallback((message: string): void => {
    startGenerationRef.current += 1;
    releaseDevices();
    updateStatus("error", message);
  }, [releaseDevices, updateStatus]);

  const runLiveAnalysis = useCallback((): void => {
    const analyser = analyserRef.current;
    const detector = detectorRef.current;
    if (!analyser || !detector || stateRef.current !== "listening") {
      return;
    }
    const now = performance.now();
    if (now - lastFrameAtRef.current >= FRAME_INTERVAL_MS) {
      lastFrameAtRef.current = now;
      const samples = sampleBufferRef.current;
      analyser.getFloatTimeDomainData(samples);
      const detection = classifyPitchFrame(
        detector,
        samples,
        analyser.context.sampleRate,
        DEFAULT_VOCAL_PITCH_CONFIG,
        now / 1000,
        PRACTICE_NOTE_FREQUENCY_RANGE,
      );
      const { alternativeCandidate, candidate, frame, rms } = detection;
      const detectorDisagreement = Boolean(
        alternativeCandidate &&
        candidate.frequencyHz > 0 &&
        alternativeCandidate.frequencyHz > 0 &&
        candidate.clarity >= 0.9 &&
        alternativeCandidate.clarity >= 0.9 &&
        Math.abs(12 * Math.log2(candidate.frequencyHz / alternativeCandidate.frequencyHz)) >= 1.5,
      );
      const recognized = recognizerRef.current.process({
        ambiguous: detectorDisagreement,
        confidence: frame.confidence,
        frequencyHz: frame.frequencyHz,
        rms,
        timeMs: now,
      });
      const liveNote = frame.frequencyHz === null || frame.confidence < 0.9
        ? null
        : frequencyToNaturalPracticeNote(frame.frequencyHz);
      if (liveNote) {
        lastVoicedAtRef.current = now;
      }
      if (recognized) {
        callbacksRef.current.onAnswer({
          midiNoteNumber: recognized.midiNoteNumber,
          noteName: recognized.noteName,
          octave: recognized.octave,
          source: "microphone",
        });
      }
      if (now - lastLevelUpdateAtRef.current >= INPUT_LEVEL_UPDATE_INTERVAL_MS) {
        lastLevelUpdateAtRef.current = now;
        if (mountedRef.current) {
          setState((current) => ({
            ...current,
            detectedNote: liveNote
              ? `${liveNote.noteName}${liveNote.octave}`
              : now - lastVoicedAtRef.current > DETECTED_NOTE_HOLD_MS
                ? null
                : current.detectedNote,
            inputLevel: Math.min(1, rms / (MIN_VOICED_RMS * 8)),
          }));
        }
      }
    }
    animationRef.current = requestAnimationFrame(runLiveAnalysis);
  }, []);

  const start = useCallback((): Promise<boolean> => {
    if (stateRef.current === "listening") {
      return Promise.resolve(true);
    }
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      updateStatus("error", "当前浏览器不支持麦克风音频输入。请使用 HTTPS 或 localhost。");
      return Promise.resolve(false);
    }

    updateStatus("requesting");
    const generation = ++startGenerationRef.current;
    const pending = (async (): Promise<boolean> => {
      let stream: MediaStream | null = null;
      let context: AudioContext | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
          },
        });
        if (!mountedRef.current || generation !== startGenerationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }

        context = new AudioContext();
        await context.resume();
        if (!mountedRef.current || generation !== startGenerationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          void context.close().catch(() => undefined);
          return false;
        }

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        const silentGain = context.createGain();
        const frameSize = getPitchFrameSize(context.sampleRate, PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz, 6);
        analyser.fftSize = frameSize;
        analyser.smoothingTimeConstant = 0;
        silentGain.gain.value = 0;
        source.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(context.destination);

        streamRef.current = stream;
        audioContextRef.current = context;
        sourceRef.current = source;
        analyserRef.current = analyser;
        silentGainRef.current = silentGain;
        sampleBufferRef.current = new Float32Array(frameSize);
        detectorRef.current = createPitchFrameDetector(frameSize);
        recognizerRef.current.reset();
        lastFrameAtRef.current = 0;
        lastLevelUpdateAtRef.current = 0;
        lastVoicedAtRef.current = 0;

        for (const track of stream.getAudioTracks()) {
          track.addEventListener("ended", () => {
            if (generation === startGenerationRef.current && stateRef.current === "listening") {
              fail("麦克风连接已中断，请重新连接设备。");
            }
          });
        }
        updateStatus("listening");
        animationRef.current = requestAnimationFrame(runLiveAnalysis);
        return true;
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        if (context && context.state !== "closed") {
          void context.close().catch(() => undefined);
        }
        if (generation === startGenerationRef.current) {
          updateStatus("error", microphoneErrorMessage(error));
        }
        return false;
      }
    })();
    startPromiseRef.current = pending;
    void pending.finally(() => {
      if (startPromiseRef.current === pending) {
        startPromiseRef.current = null;
      }
    });
    return pending;
  }, [fail, runLiveAnalysis, updateStatus]);

  const stop = useCallback((options: { preserveError?: boolean } = {}): void => {
    startGenerationRef.current += 1;
    releaseDevices();
    updateStatus("idle", options.preserveError ? errorRef.current : null);
  }, [releaseDevices, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGenerationRef.current += 1;
      releaseDevices();
    };
  }, [releaseDevices]);

  return {
    ...state,
    isListening: state.status === "listening",
    start,
    stop,
  };
}
