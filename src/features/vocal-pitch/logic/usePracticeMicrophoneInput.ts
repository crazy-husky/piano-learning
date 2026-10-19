import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOCAL_PITCH_CONFIG } from "../../../domain/vocalPitch";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import type { PitchFrameDetector } from "./pitchFrameTypes";
import { createPracticeYinDetector, getPracticeYinInputFrameSize } from "./practiceYinDetector";
import { SWIFTF0_INPUT_FRAME_SIZE } from "./swiftF0Config";
import {
  PRACTICE_NOTE_FREQUENCY_RANGE,
  createPracticeNoteRecognizer,
  frequencyToChromaticPracticeNote,
  frequencyToNaturalPracticeNote,
  type PracticeNoteRecognizer,
} from "./practiceNoteRecognizer";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  resolvePracticeMicrophoneConfiguration,
  resolvePracticeMicrophoneFrameIntervalMs,
  resolvePracticeMicrophoneThresholds,
  createYinFallbackConfiguration,
  type PracticeMicrophoneAlgorithm,
  type PracticeMicrophoneAnalysisGain,
  type PracticeMicrophoneConfiguration,
  type PracticeMicrophonePreferences,
  type PracticeMicrophoneThresholds,
} from "./practiceMicrophonePreferences";
import { describePracticeMicrophoneObservation } from "./practiceMicrophoneDiagnostics";
import {
  PRACTICE_MICROPHONE_CLIPPING_THRESHOLD,
  PRACTICE_MICROPHONE_FRAME_SEMANTICS,
  PRACTICE_MICROPHONE_PCM_CAPTURE_INTERVAL_MS,
  applyPracticeMicrophoneAnalysisGain,
  createPracticeMicrophoneCaptureBlob,
  summarizePracticeMicrophoneSamples,
  type PracticeMicrophoneCaptureLifecycleEventType,
  type PracticeMicrophoneCaptureFrame,
  type PracticeMicrophoneCaptureMetadata,
  type PracticeMicrophoneCaptureStopReason,
  type PracticeMicrophoneConstraintValues,
} from "./practiceMicrophoneCapture";
import {
  analyzePracticeMicrophoneCapture,
  type PracticeMicrophoneAnalysis,
} from "./practiceMicrophoneAnalysis";
import {
  ensureSwiftF0PracticeRuntimeReady,
  getReadySwiftF0PracticeWorker,
  subscribeToSwiftF0PracticeMessages,
} from "./swiftF0PracticeClient";
import type { PracticeAnswerInput } from "../../../domain/answerInput";
import type { SwiftF0PracticeResponse } from "./swiftF0PracticeProtocol";

export type PracticeMicrophoneStatus = "idle" | "requesting" | "listening" | "error";

interface PracticeMicrophoneState {
  captureFrameCount: number;
  captureDurationMs: number;
  captureAnalysisPending: boolean;
  captureRecording: boolean;
  captureStatus: string | null;
  diagnostics: PracticeMicrophoneDiagnostics | null;
  detectedNote: string | null;
  error: string | null;
  inputLevel: number;
  status: PracticeMicrophoneStatus;
}

export interface PracticeMicrophoneDiagnostics {
  alternativeCandidateConfidence: number | null;
  alternativeCandidateFrequencyHz: number | null;
  algorithm: PracticeMicrophoneAlgorithm;
  audioContextSampleRate: number;
  audioContextState: string;
  autoGainControl: boolean | null;
  ambiguous: boolean;
  candidateConfidence: number | null;
  candidateFrequencyHz: number | null;
  candidateNote: string | null;
  channelCount: number | null;
  echoCancellation: boolean | null;
  detectorDisagreement: boolean;
  includeAccidentals: boolean;
  inputRms: number;
  analysisRms: number;
  inputRmsThreshold: number;
  lastRecognizedAtMs: number | null;
  lastRecognizedMidi: number | null;
  lastRecognizedNote: string | null;
  noiseSuppression: boolean | null;
  outcome: string;
  requiredStableFrames: number;
  requiredStableMs: number;
  trackSampleRate: number | null;
  confidenceThreshold: number;
}

interface PendingAnalysis {
  algorithm: "pitch" | "swiftf0";
  analysisRms: number;
  gain: PracticeMicrophoneAnalysisGain;
  generation: number;
  id: number;
  rms: number;
  timeMs: number;
}

interface RecognizedNoteSuppressionWindow {
  endAtMs: number;
  midiNotes: ReadonlySet<number>;
  startAtMs: number;
}

interface PracticePitchWorkerResponse {
  alternativeClarity?: number | null;
  alternativeFrequencyHz?: number | null;
  candidateClarity?: number;
  candidateFrequencyHz?: number;
  error?: string;
  generation?: number;
  id?: number;
  type: "error" | "result";
}

const INPUT_LEVEL_UPDATE_INTERVAL_MS = 100;
const DETECTED_NOTE_HOLD_MS = 1200;
const CAPTURE_MAX_DURATION_MS = 30000;
const SWIFT_F0_ANALYSIS_TIMEOUT_MS = 10000;
const PITCH_ANALYSIS_TIMEOUT_MS = 3000;
const MICROPHONE_RECOVERY_TIMEOUT_MS = 8_000;
const MICROPHONE_RECOVERY_RETRY_DELAY_MS = 350;
const MICROPHONE_RECOVERY_RELOAD_DELAY_MS = 1_200;
const MICROPHONE_BACKGROUND_RECOVERY_MIN_DURATION_MS = 1_200;
const MICROPHONE_RECOVERY_RELOAD_KEY = "piano-learning.microphone-recovery-reload-attempted";
const REQUESTED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
};

export interface PracticeMicrophoneRecoveryOptions {
  beforeRecoveryReload?: () => void | Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  });
}

function hasAttemptedMicrophoneRecoveryReload(): boolean | null {
  try {
    return window.sessionStorage.getItem(MICROPHONE_RECOVERY_RELOAD_KEY) === "1";
  } catch {
    return null;
  }
}

function getConstraintValues(
  constraints: MediaTrackConstraints | null | undefined
): PracticeMicrophoneConstraintValues {
  return {
    autoGainControl: constraints?.autoGainControl ?? null,
    channelCount: constraints?.channelCount ?? null,
    echoCancellation: constraints?.echoCancellation ?? null,
    noiseSuppression: constraints?.noiseSuppression ?? null,
    sampleRate: constraints?.sampleRate ?? null,
  };
}

function getConstraintSupportSnapshot(): PracticeMicrophoneCaptureMetadata["constraintSupport"] {
  const getSupportedConstraints = navigator.mediaDevices?.getSupportedConstraints;
  if (typeof getSupportedConstraints !== "function") return null;
  try {
    const supported = getSupportedConstraints.call(navigator.mediaDevices);
    return {
      autoGainControl: Boolean(supported.autoGainControl),
      channelCount: Boolean(supported.channelCount),
      echoCancellation: Boolean(supported.echoCancellation),
      noiseSuppression: Boolean(supported.noiseSuppression),
      sampleRate: Boolean(supported.sampleRate),
    };
  } catch {
    return null;
  }
}

function getAudioSessionSnapshot(): { state: string | null; type: string | null } | null {
  const audioSession = (
    navigator as Navigator & {
      audioSession?: { state?: string; type?: string };
    }
  ).audioSession;
  if (!audioSession) return null;
  return {
    state: audioSession.state ?? null,
    type: audioSession.type ?? null,
  };
}

function getTrackConstraintsSnapshot(
  track: MediaStreamTrack | undefined
): PracticeMicrophoneConstraintValues | null {
  if (!track || typeof track.getConstraints !== "function") return null;
  try {
    return getConstraintValues(track.getConstraints());
  } catch {
    return null;
  }
}

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

function calculateRms(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / samples.length);
}

function formatStartError(error: unknown): string {
  return error instanceof DOMException
    ? microphoneErrorMessage(error)
    : error instanceof Error
      ? error.message
      : microphoneErrorMessage(error);
}

function captureConfigurationMetadata(
  configuration: PracticeMicrophoneConfiguration,
  frameIntervalMs = resolvePracticeMicrophoneFrameIntervalMs(configuration)
) {
  return {
    algorithm: configuration.algorithm,
    analysisGain: configuration.analysisGain,
    confidenceThreshold: configuration.confidenceThreshold,
    debugMode: configuration.debugMode,
    frameCaptureIntervalMs: frameIntervalMs,
    frameIntervalSelection: configuration.frameIntervalMs,
    inputRmsThreshold: configuration.inputRmsThreshold,
    requiredStableFrames: configuration.requiredStableFrames,
    requiredStableMs: configuration.requiredStableMs,
    sensitivityLevel: configuration.sensitivityLevel,
    yinThreshold: configuration.yinThreshold,
  };
}

function createDetectorForConfiguration(
  configuration: PracticeMicrophoneConfiguration,
  frameSize: number,
  sampleRate: number
): PitchFrameDetector | ReturnType<typeof createPracticeYinDetector> | null {
  if (configuration.algorithm === "yin") {
    return createPracticeYinDetector(frameSize, sampleRate, {
      maxFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz,
      minFrequencyHz: PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz,
      threshold: configuration.yinThreshold,
    });
  }
  return null;
}

function createRecognizerForConfiguration(
  configuration: PracticeMicrophoneConfiguration,
  includeAccidentals = false
): PracticeNoteRecognizer {
  return createPracticeNoteRecognizer(configuration.confidenceThreshold, {
    continuityConfidence: configuration.confidenceThreshold,
    includeAccidentals,
    requiredFrames: configuration.requiredStableFrames,
    requiredMs: configuration.requiredStableMs,
  });
}

function downloadCaptureFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function usePracticeMicrophoneInput(
  onAnswer: (answer: PracticeAnswerInput) => void,
  preferences: PracticeMicrophonePreferences = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  recoveryOptions: PracticeMicrophoneRecoveryOptions = {}
) {
  const [state, setState] = useState<PracticeMicrophoneState>({
    captureFrameCount: 0,
    captureDurationMs: 0,
    captureAnalysisPending: false,
    captureRecording: false,
    captureStatus: null,
    diagnostics: null,
    detectedNote: null,
    error: null,
    inputLevel: 0,
    status: "idle",
  });
  const [isPreparingSwiftF0, setIsPreparingSwiftF0] = useState(false);
  const stateRef = useRef<PracticeMicrophoneStatus>("idle");
  const mountedRef = useRef(false);
  const inputReconnectRequiredRef = useRef(false);
  const audioContextWasInterruptedRef = useRef(false);
  const lifecycleRecoveryPendingRef = useRef(false);
  const lifecycleRecoveryAttemptCountRef = useRef(0);
  const backgroundedAtRef = useRef<number | null>(null);
  const recoveryReloadTimeoutRef = useRef<number | null>(null);
  const startGenerationRef = useRef(0);
  const inputGenerationRef = useRef(0);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const errorRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioContextStateChangeCleanupRef = useRef<(() => void) | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const detectorRef = useRef<PitchFrameDetector | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const initialConfiguration = resolvePracticeMicrophoneConfiguration(preferences);
  const activeConfigurationRef = useRef<PracticeMicrophoneConfiguration>(initialConfiguration);
  const activeAlgorithmRef = useRef<PracticeMicrophoneAlgorithm>(initialConfiguration.algorithm);
  const activeThresholdsRef = useRef<PracticeMicrophoneThresholds>(
    resolvePracticeMicrophoneThresholds(initialConfiguration)
  );
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const workerUnsubscribeRef = useRef<(() => void) | null>(null);
  const workerMessageHandlerRef = useRef<(message: SwiftF0PracticeResponse) => void>(
    () => undefined
  );
  const pitchWorkerRef = useRef<Worker | null>(null);
  const pitchWorkerFailureRef = useRef(false);
  const pitchWorkerMessageHandlerRef = useRef<(message: PracticePitchWorkerResponse) => void>(
    () => undefined
  );
  const pendingAnalysisRef = useRef<PendingAnalysis | null>(null);
  const requestInFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const analysisTimeoutRef = useRef<number | null>(null);
  const captureStopWaitersRef = useRef<Array<() => void>>([]);
  const finalCaptureFrameIssueRef = useRef<string | null>(null);
  const includeAccidentalsRef = useRef(false);
  const recognizerRef = useRef<PracticeNoteRecognizer>(
    createRecognizerForConfiguration(initialConfiguration)
  );
  const recognizedNoteSuppressionWindowsRef = useRef<RecognizedNoteSuppressionWindow[]>([]);
  const sampleBufferRef = useRef(new Float32Array(0));
  const captureFramesRef = useRef<PracticeMicrophoneCaptureFrame[]>([]);
  const latestAnalysisClippedSampleRatioRef = useRef<number | undefined>(undefined);
  const captureAudioLoopFrameCountRef = useRef(0);
  const latestInputRmsRef = useRef(0);
  const captureMetadataRef = useRef<PracticeMicrophoneCaptureMetadata | null>(null);
  const recordedMetadataRef = useRef<PracticeMicrophoneCaptureMetadata | null>(null);
  const captureRecordingRef = useRef(false);
  const captureStartedAtMonotonicRef = useRef(0);
  const captureLifecycleCleanupRef = useRef<(() => void) | null>(null);
  const activeFrameIntervalRef = useRef(30);
  const lastPcmCaptureAtRef = useRef(0);
  const lastCaptureCountUpdateAtRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const lastLevelUpdateAtRef = useRef(0);
  const lastVoicedAtRef = useRef(0);
  const latestObservationUiRef = useRef<Pick<
    PracticeMicrophoneDiagnostics,
    | "ambiguous"
    | "alternativeCandidateConfidence"
    | "alternativeCandidateFrequencyHz"
    | "analysisRms"
    | "candidateConfidence"
    | "candidateFrequencyHz"
    | "candidateNote"
    | "detectorDisagreement"
    | "inputRms"
    | "lastRecognizedAtMs"
    | "lastRecognizedMidi"
    | "lastRecognizedNote"
    | "outcome"
  > | null>(null);
  const detectedNoteUiRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onAnswer });
  callbacksRef.current = { onAnswer };
  const recoveryOptionsRef = useRef(recoveryOptions);
  recoveryOptionsRef.current = recoveryOptions;

  const settleCaptureStopWaiters = useCallback((): void => {
    const waiters = captureStopWaitersRef.current;
    captureStopWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const recordCaptureLifecycleEvent = useCallback(
    (type: PracticeMicrophoneCaptureLifecycleEventType, value?: string): void => {
      if (!captureRecordingRef.current) return;
      const metadata = recordedMetadataRef.current;
      if (!metadata) return;
      metadata.lifecycleEvents.push({
        offsetMs: Math.max(0, Math.round(performance.now() - captureStartedAtMonotonicRef.current)),
        ...(value === undefined ? {} : { state: value }),
        type,
      });
    },
    []
  );

  const finishCapture = useCallback(
    (reason: PracticeMicrophoneCaptureStopReason): number | null => {
      if (!captureRecordingRef.current) return null;
      captureRecordingRef.current = false;
      const durationMs = Math.max(
        0,
        Math.round(performance.now() - captureStartedAtMonotonicRef.current)
      );
      const metadata = recordedMetadataRef.current;
      if (metadata) {
        metadata.captureEndedAt = new Date().toISOString();
        metadata.captureDurationMs = durationMs;
        metadata.captureStopReason = reason;
        metadata.audioSession.atEnd = getAudioSessionSnapshot();
      }
      captureLifecycleCleanupRef.current?.();
      captureLifecycleCleanupRef.current = null;
      return durationMs;
    },
    []
  );

  const recordInputFrame = useCallback(
    (
      samples: Float32Array,
      rms: number,
      timeMs: number,
      analysisSamples: Float32Array = samples,
      analysisRms = rms,
      gain: PracticeMicrophoneAnalysisGain = 1
    ): void => {
      const analysisSignal = summarizePracticeMicrophoneSamples(analysisSamples, analysisRms);
      latestAnalysisClippedSampleRatioRef.current = analysisSignal.clippedSampleRatio;
      if (!captureRecordingRef.current) return;
      const frames = captureFramesRef.current;
      const shouldCapturePcmWindow =
        frames.length === 0 ||
        timeMs - lastPcmCaptureAtRef.current >= PRACTICE_MICROPHONE_PCM_CAPTURE_INTERVAL_MS;
      if (shouldCapturePcmWindow) lastPcmCaptureAtRef.current = timeMs;
      const signal = summarizePracticeMicrophoneSamples(samples, rms);
      frames.push({
        ...signal,
        analysisClippedSampleRatio: analysisSignal.clippedSampleRatio,
        analysisPeak: analysisSignal.peak,
        analysisRms: analysisSignal.rms,
        gain,
        offsetMs: Math.max(0, timeMs - captureStartedAtMonotonicRef.current),
        samples: shouldCapturePcmWindow ? samples.slice() : new Float32Array(0),
        timeMs,
      });
      const captureDurationMs = Math.max(
        0,
        Math.round(timeMs - captureStartedAtMonotonicRef.current)
      );
      if (captureDurationMs >= CAPTURE_MAX_DURATION_MS) {
        finishCapture("duration-limit");
        if (mountedRef.current) {
          setState((current) => ({
            ...current,
            captureDurationMs,
            captureFrameCount: frames.length,
            captureRecording: false,
            captureStatus: "已达到 30 秒上限，采样已保留",
          }));
        }
        return;
      }
      if (timeMs - lastCaptureCountUpdateAtRef.current >= 500) {
        lastCaptureCountUpdateAtRef.current = timeMs;
        if (mountedRef.current) {
          setState((current) => ({
            ...current,
            captureDurationMs,
            captureFrameCount: frames.length,
          }));
        }
      }
    },
    [finishCapture]
  );

  const updateStatus = useCallback(
    (status: PracticeMicrophoneStatus, error: string | null = null): void => {
      stateRef.current = status;
      errorRef.current = error;
      if (mountedRef.current) {
        setState((current) => ({ ...current, error, status }));
      }
    },
    []
  );

  const releaseDevices = useCallback(
    (captureStopReason: PracticeMicrophoneCaptureStopReason = "input-released"): void => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      const captureWasRecording = captureRecordingRef.current;
      const finalizedCaptureDuration = finishCapture(captureStopReason);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      detectorRef.current = null;
      silentGainRef.current?.disconnect();
      silentGainRef.current = null;
      sampleBufferRef.current = new Float32Array(0);
      recognizerRef.current.reset();
      latestObservationUiRef.current = null;
      detectedNoteUiRef.current = null;
      inputGenerationRef.current += 1;
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
      pendingAnalysisRef.current = null;
      requestInFlightRef.current = false;
      settleCaptureStopWaiters();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      audioContextStateChangeCleanupRef.current?.();
      audioContextStateChangeCleanupRef.current = null;
      inputReconnectRequiredRef.current = false;
      audioContextWasInterruptedRef.current = false;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
      if (mountedRef.current) {
        const captureFrames = captureFramesRef.current;
        const captureDurationMs =
          finalizedCaptureDuration ??
          (captureFrames.length > 0
            ? Math.round(captureFrames[captureFrames.length - 1].offsetMs)
            : 0);
        setState((current) => ({
          ...current,
          captureDurationMs,
          captureFrameCount: captureFrames.length,
          captureAnalysisPending: false,
          captureRecording: false,
          captureStatus: captureWasRecording
            ? captureFrames.length > 0
              ? "麦克风已释放，采样已保留"
              : "采集已结束，尚无可导出的采样"
            : current.captureAnalysisPending
              ? "识别已中断，采样仍可分析"
              : current.captureStatus,
          diagnostics: null,
          detectedNote: null,
          inputLevel: 0,
        }));
      }
    },
    [finishCapture, settleCaptureStopWaiters]
  );

  const fail = useCallback(
    (
      message: string,
      captureStopReason: PracticeMicrophoneCaptureStopReason = "recognition-error"
    ): void => {
      startGenerationRef.current += 1;
      releaseDevices(captureStopReason);
      updateStatus("error", message);
    },
    [releaseDevices, updateStatus]
  );

  const processObservation = useCallback(
    (
      confidence: number,
      frequencyHz: number | null,
      analysisRms: number,
      rawRms: number,
      timeMs: number,
      gain: PracticeMicrophoneAnalysisGain,
      ambiguous = false,
      alternativeCandidate: { confidence: number | null; frequencyHz: number | null } = {
        confidence: null,
        frequencyHz: null,
      }
    ): void => {
      const thresholds = activeThresholdsRef.current;
      const isVoiced =
        analysisRms >= thresholds.inputRmsThreshold && confidence >= thresholds.confidenceThreshold;
      const acceptedFrequency = isVoiced ? frequencyHz : null;
      const recognizerFrequency =
        analysisRms >= thresholds.inputRmsThreshold && isVoiced ? frequencyHz : null;
      const convertFrequency = includeAccidentalsRef.current
        ? frequencyToChromaticPracticeNote
        : frequencyToNaturalPracticeNote;
      const candidateNote = convertFrequency(frequencyHz ?? 0);
      const liveNote = acceptedFrequency === null ? null : convertFrequency(acceptedFrequency);
      const suppressionWindows = recognizedNoteSuppressionWindowsRef.current.filter(
        (window) => window.endAtMs >= timeMs
      );
      recognizedNoteSuppressionWindowsRef.current = suppressionWindows;
      const isSuppressedPromptPitch = Boolean(
        candidateNote &&
        suppressionWindows.some(
          (window) =>
            timeMs >= window.startAtMs &&
            timeMs < window.endAtMs &&
            window.midiNotes.has(candidateNote.midiNoteNumber)
        )
      );
      if (isSuppressedPromptPitch) recognizerRef.current.reset();
      const recognized = recognizerRef.current.process({
        ambiguous,
        confidence,
        frequencyHz: isSuppressedPromptPitch ? null : recognizerFrequency,
        rms: analysisRms,
        timeMs,
      });

      const outcome = describePracticeMicrophoneObservation(
        confidence,
        frequencyHz,
        analysisRms,
        ambiguous,
        thresholds
      );
      for (let index = captureFramesRef.current.length - 1; index >= 0; index -= 1) {
        const capturedFrame = captureFramesRef.current[index];
        if (capturedFrame.timeMs === timeMs) {
          capturedFrame.ambiguous = ambiguous;
          capturedFrame.confidence = confidence;
          capturedFrame.frequencyHz = frequencyHz;
          capturedFrame.outcome = outcome;
          capturedFrame.analysisRms = analysisRms;
          capturedFrame.gain = gain;
          if (recognized) capturedFrame.recognizedMidi = recognized.midiNoteNumber;
          break;
        }
      }

      if (liveNote) {
        lastVoicedAtRef.current = timeMs;
        detectedNoteUiRef.current = `${liveNote.noteName}${liveNote.octave}`;
      } else if (timeMs - lastVoicedAtRef.current > DETECTED_NOTE_HOLD_MS) {
        detectedNoteUiRef.current = null;
      }
      if (recognized) {
        callbacksRef.current.onAnswer({
          clipping:
            latestAnalysisClippedSampleRatioRef.current === undefined
              ? undefined
              : latestAnalysisClippedSampleRatioRef.current > 0,
          confidence,
          microphoneAlgorithm: activeAlgorithmRef.current,
          midiNoteNumber: recognized.midiNoteNumber,
          noteName: recognized.noteName[0] as PracticeAnswerInput["noteName"],
          octave: recognized.octave,
          source: "microphone",
        });
      }

      latestObservationUiRef.current = {
        ambiguous,
        alternativeCandidateConfidence: alternativeCandidate.confidence,
        alternativeCandidateFrequencyHz: alternativeCandidate.frequencyHz,
        analysisRms,
        candidateConfidence: confidence,
        candidateFrequencyHz:
          frequencyHz !== null && Number.isFinite(frequencyHz) && frequencyHz > 0
            ? frequencyHz
            : null,
        candidateNote: candidateNote ? `${candidateNote.noteName}${candidateNote.octave}` : null,
        detectorDisagreement: ambiguous,
        inputRms: rawRms,
        lastRecognizedAtMs: recognized
          ? timeMs
          : (latestObservationUiRef.current?.lastRecognizedAtMs ?? null),
        lastRecognizedMidi:
          recognized?.midiNoteNumber ?? latestObservationUiRef.current?.lastRecognizedMidi ?? null,
        lastRecognizedNote: recognized
          ? `${recognized.noteName}${recognized.octave}`
          : (latestObservationUiRef.current?.lastRecognizedNote ?? null),
        outcome,
      };
    },
    []
  );

  const handleWorkerMessage = useCallback(
    (message: SwiftF0PracticeResponse): void => {
      if (message.type === "ready") {
        workerReadyRef.current = true;
        return;
      }

      if (message.type === "error") {
        if (message.id === undefined) {
          workerReadyRef.current = false;
          workerRef.current = null;
          workerUnsubscribeRef.current?.();
          workerUnsubscribeRef.current = null;
          finalCaptureFrameIssueRef.current = `SwiftF0 听音识别运行失败：${message.error}`;
          fail(`SwiftF0 听音识别运行失败：${message.error}`);
          return;
        }
        const pending = pendingAnalysisRef.current;
        if (pending?.algorithm === "swiftf0" && pending.id === message.id) {
          if (analysisTimeoutRef.current !== null) {
            window.clearTimeout(analysisTimeoutRef.current);
            analysisTimeoutRef.current = null;
          }
          pendingAnalysisRef.current = null;
          requestInFlightRef.current = false;
          finalCaptureFrameIssueRef.current = `最后一帧识别失败：${message.error}`;
          settleCaptureStopWaiters();
        }
        if (
          pending?.algorithm === "swiftf0" &&
          pending.generation === inputGenerationRef.current &&
          stateRef.current === "listening"
        ) {
          fail(`SwiftF0 听音识别失败：${message.error}`);
        } else if (
          pending?.algorithm === "swiftf0" &&
          pending.id === message.id &&
          mountedRef.current &&
          !captureRecordingRef.current
        ) {
          setState((current) =>
            current.captureAnalysisPending
              ? {
                  ...current,
                  captureAnalysisPending: false,
                  captureStatus: "最后一帧识别失败，采样仍可分析",
                }
              : current
          );
        }
        return;
      }

      const pending = pendingAnalysisRef.current;
      if (pending?.algorithm !== "swiftf0" || pending.id !== message.id) return;
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
      pendingAnalysisRef.current = null;
      requestInFlightRef.current = false;
      if (
        pending.generation !== message.generation ||
        pending.generation !== inputGenerationRef.current
      ) {
        finalCaptureFrameIssueRef.current = "最后一帧识别结果已过期";
        if (mountedRef.current && !captureRecordingRef.current) {
          setState((current) =>
            current.captureAnalysisPending
              ? {
                  ...current,
                  captureAnalysisPending: false,
                  captureStatus: "最后一帧识别结果已过期，采样仍可分析",
                }
              : current
          );
        }
        settleCaptureStopWaiters();
        return;
      }

      processObservation(
        message.confidence,
        message.frequencyHz,
        pending.analysisRms,
        pending.rms,
        pending.timeMs,
        pending.gain
      );
      if (mountedRef.current && !captureRecordingRef.current) {
        setState((current) =>
          current.captureAnalysisPending
            ? {
                ...current,
                captureAnalysisPending: false,
                captureStatus: "最后一帧识别完成，可以分析",
              }
            : current
        );
      }
      settleCaptureStopWaiters();
    },
    [fail, processObservation, settleCaptureStopWaiters]
  );

  workerMessageHandlerRef.current = handleWorkerMessage;

  const handlePitchWorkerMessage = useCallback(
    (message: PracticePitchWorkerResponse): void => {
      const pending = pendingAnalysisRef.current;
      if (pending?.algorithm !== "pitch" || pending.id !== message.id) return;
      if (analysisTimeoutRef.current !== null) {
        window.clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
      pendingAnalysisRef.current = null;
      requestInFlightRef.current = false;

      if (message.type === "error") {
        finalCaptureFrameIssueRef.current = `最后一帧识别失败：${message.error ?? "Worker 分析异常"}`;
        pitchWorkerFailureRef.current = true;
        pitchWorkerRef.current?.terminate();
        pitchWorkerRef.current = null;
        settleCaptureStopWaiters();
        return;
      }

      if (
        pending.generation !== message.generation ||
        pending.generation !== inputGenerationRef.current
      ) {
        finalCaptureFrameIssueRef.current = "最后一帧识别结果已过期";
        settleCaptureStopWaiters();
        return;
      }

      const confidence = message.candidateClarity ?? 0;
      const frequencyHz = message.candidateFrequencyHz ?? 0;
      const alternativeClarity = message.alternativeClarity ?? 0;
      const alternativeFrequencyHz = message.alternativeFrequencyHz ?? 0;
      const detectorDisagreement = Boolean(
        frequencyHz > 0 &&
        alternativeFrequencyHz > 0 &&
        confidence >= activeThresholdsRef.current.confidenceThreshold &&
        alternativeClarity >= activeThresholdsRef.current.confidenceThreshold &&
        Math.abs(12 * Math.log2(frequencyHz / alternativeFrequencyHz)) >= 1.5
      );
      processObservation(
        confidence,
        frequencyHz,
        pending.analysisRms,
        pending.rms,
        pending.timeMs,
        pending.gain,
        detectorDisagreement,
        {
          confidence: alternativeClarity,
          frequencyHz: alternativeFrequencyHz > 0 ? alternativeFrequencyHz : null,
        }
      );
      settleCaptureStopWaiters();
    },
    [processObservation, settleCaptureStopWaiters]
  );

  pitchWorkerMessageHandlerRef.current = handlePitchWorkerMessage;

  const ensurePitchWorker = useCallback((): void => {
    if (pitchWorkerRef.current || pitchWorkerFailureRef.current || typeof Worker === "undefined")
      return;
    try {
      const worker = new Worker(new URL("./practicePitchDetection.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", (event: MessageEvent<PracticePitchWorkerResponse>) => {
        pitchWorkerMessageHandlerRef.current(event.data);
      });
      worker.addEventListener("error", () => {
        const pending = pendingAnalysisRef.current;
        if (pending?.algorithm === "pitch") {
          if (analysisTimeoutRef.current !== null) {
            window.clearTimeout(analysisTimeoutRef.current);
            analysisTimeoutRef.current = null;
          }
          pendingAnalysisRef.current = null;
          requestInFlightRef.current = false;
          finalCaptureFrameIssueRef.current = "音高识别 Worker 运行失败，已切换为主线程识别";
          settleCaptureStopWaiters();
        }
        pitchWorkerFailureRef.current = true;
        worker.terminate();
        if (pitchWorkerRef.current === worker) pitchWorkerRef.current = null;
      });
      pitchWorkerRef.current = worker;
    } catch {
      pitchWorkerFailureRef.current = true;
    }
  }, [settleCaptureStopWaiters]);

  const ensureWorkerReady = useCallback(async (timeoutMs?: number): Promise<void> => {
    if (workerReadyRef.current) return;
    await ensureSwiftF0PracticeRuntimeReady(timeoutMs);
    if (!mountedRef.current) return;
    workerRef.current = getReadySwiftF0PracticeWorker();
    workerUnsubscribeRef.current ??= subscribeToSwiftF0PracticeMessages((message) => {
      workerMessageHandlerRef.current(message);
    });
    workerReadyRef.current = true;
  }, []);

  const prepare = useCallback(
    async (timeoutMs?: number): Promise<void> => {
      if (preferencesRef.current.algorithm !== "swiftf0" || workerReadyRef.current) return;
      setIsPreparingSwiftF0(true);
      try {
        await ensureWorkerReady(timeoutMs);
      } finally {
        if (mountedRef.current) setIsPreparingSwiftF0(false);
      }
    },
    [ensureWorkerReady]
  );

  const postAnalysisFrame = useCallback(
    (
      analysisSamples: Float32Array,
      sampleRate: number,
      timeMs: number,
      rms: number,
      analysisRms: number,
      gain: PracticeMicrophoneAnalysisGain
    ): void => {
      const worker = workerRef.current;
      if (!worker || !workerReadyRef.current || requestInFlightRef.current) return;

      const id = ++requestIdRef.current;
      const generation = inputGenerationRef.current;
      const transferableSamples = analysisSamples.slice();
      pendingAnalysisRef.current = {
        algorithm: "swiftf0",
        analysisRms,
        gain,
        generation,
        id,
        rms,
        timeMs,
      };
      requestInFlightRef.current = true;
      analysisTimeoutRef.current = window.setTimeout(() => {
        if (pendingAnalysisRef.current?.id !== id) return;
        pendingAnalysisRef.current = null;
        requestInFlightRef.current = false;
        analysisTimeoutRef.current = null;
        finalCaptureFrameIssueRef.current = "最后一帧识别超时";
        if (mountedRef.current && !captureRecordingRef.current) {
          setState((current) =>
            current.captureAnalysisPending
              ? {
                  ...current,
                  captureAnalysisPending: false,
                  captureStatus: "最后一帧识别超时，采样仍可分析",
                }
              : current
          );
        }
        settleCaptureStopWaiters();
      }, SWIFT_F0_ANALYSIS_TIMEOUT_MS);
      try {
        worker.postMessage(
          {
            type: "analyze",
            generation,
            id,
            sampleRate,
            samples: transferableSamples.buffer,
          },
          [transferableSamples.buffer]
        );
      } catch {
        window.clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
        pendingAnalysisRef.current = null;
        requestInFlightRef.current = false;
        finalCaptureFrameIssueRef.current = "最后一帧识别请求发送失败";
        if (mountedRef.current && !captureRecordingRef.current) {
          setState((current) =>
            current.captureAnalysisPending
              ? {
                  ...current,
                  captureAnalysisPending: false,
                  captureStatus: "最后一帧识别失败，采样仍可分析",
                }
              : current
          );
        }
        settleCaptureStopWaiters();
      }
    },
    [settleCaptureStopWaiters]
  );

  const postPracticePitchFrame = useCallback(
    (
      analysisSamples: Float32Array,
      sampleRate: number,
      timeMs: number,
      rms: number,
      analysisRms: number,
      gain: PracticeMicrophoneAnalysisGain
    ): "busy" | "submitted" | "unavailable" => {
      const worker = pitchWorkerRef.current;
      if (!worker) return "unavailable";
      if (requestInFlightRef.current) return "busy";

      const configuration = activeConfigurationRef.current;
      if (configuration.algorithm === "swiftf0") return "unavailable";
      const id = ++requestIdRef.current;
      const generation = inputGenerationRef.current;
      const transferableSamples = analysisSamples.slice();
      pendingAnalysisRef.current = {
        algorithm: "pitch",
        analysisRms,
        gain,
        generation,
        id,
        rms,
        timeMs,
      };
      requestInFlightRef.current = true;
      analysisTimeoutRef.current = window.setTimeout(() => {
        if (pendingAnalysisRef.current?.id !== id) return;
        pendingAnalysisRef.current = null;
        requestInFlightRef.current = false;
        analysisTimeoutRef.current = null;
        finalCaptureFrameIssueRef.current = "音高识别 Worker 超时，后续帧将切回主线程识别";
        pitchWorkerFailureRef.current = true;
        pitchWorkerRef.current?.terminate();
        pitchWorkerRef.current = null;
        settleCaptureStopWaiters();
      }, PITCH_ANALYSIS_TIMEOUT_MS);
      try {
        worker.postMessage(
          {
            algorithm: configuration.algorithm,
            confidenceThreshold: configuration.confidenceThreshold,
            generation,
            id,
            inputRmsThreshold: configuration.inputRmsThreshold,
            sampleRate,
            samples: transferableSamples.buffer,
            timeMs,
            type: "analyze",
            yinThreshold: configuration.yinThreshold,
          },
          [transferableSamples.buffer]
        );
        return "submitted";
      } catch {
        window.clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
        pendingAnalysisRef.current = null;
        requestInFlightRef.current = false;
        finalCaptureFrameIssueRef.current = "音高识别 Worker 请求失败，后续帧将切回主线程识别";
        pitchWorkerFailureRef.current = true;
        worker.terminate();
        if (pitchWorkerRef.current === worker) pitchWorkerRef.current = null;
        return "unavailable";
      }
    },
    [settleCaptureStopWaiters]
  );

  const runLiveAnalysis = useCallback((): void => {
    const analyser = analyserRef.current;
    if (!analyser || stateRef.current !== "listening") return;
    const now = performance.now();
    const frameInterval = activeFrameIntervalRef.current;
    if (now - lastFrameAtRef.current >= frameInterval) {
      lastFrameAtRef.current = now;
      const samples = sampleBufferRef.current;
      analyser.getFloatTimeDomainData(samples);
      const rms = calculateRms(samples);
      latestInputRmsRef.current = rms;
      const gain = activeConfigurationRef.current.analysisGain;
      const analysisSamples = applyPracticeMicrophoneAnalysisGain(samples, gain);
      const analysisRms = gain === 1 ? rms : calculateRms(analysisSamples);
      if (captureRecordingRef.current) captureAudioLoopFrameCountRef.current += 1;
      recordInputFrame(samples, rms, now, analysisSamples, analysisRms, gain);
      if (activeAlgorithmRef.current === "swiftf0") {
        postAnalysisFrame(
          analysisSamples,
          analyser.context.sampleRate,
          now,
          rms,
          analysisRms,
          gain
        );
      } else {
        const thresholds = activeThresholdsRef.current;
        const workerResult = pitchWorkerRef.current
          ? postPracticePitchFrame(
              analysisSamples,
              analyser.context.sampleRate,
              now,
              rms,
              analysisRms,
              gain
            )
          : "unavailable";
        if (workerResult === "unavailable") {
          const detector = detectorRef.current;
          if (detector) {
            const detection = classifyPitchFrame(
              detector,
              analysisSamples,
              analyser.context.sampleRate,
              { ...DEFAULT_VOCAL_PITCH_CONFIG, voicingThreshold: thresholds.confidenceThreshold },
              now / 1000,
              PRACTICE_NOTE_FREQUENCY_RANGE,
              thresholds.inputRmsThreshold
            );
            const { alternativeCandidate, candidate } = detection;
            const detectorDisagreement = Boolean(
              alternativeCandidate &&
              candidate.frequencyHz > 0 &&
              alternativeCandidate.frequencyHz > 0 &&
              candidate.clarity >= thresholds.confidenceThreshold &&
              alternativeCandidate.clarity >= thresholds.confidenceThreshold &&
              Math.abs(12 * Math.log2(candidate.frequencyHz / alternativeCandidate.frequencyHz)) >=
                1.5
            );
            processObservation(
              candidate.clarity,
              candidate.frequencyHz,
              analysisRms,
              rms,
              now,
              gain,
              detectorDisagreement,
              {
                confidence: alternativeCandidate?.clarity ?? null,
                frequencyHz: alternativeCandidate?.frequencyHz ?? null,
              }
            );
          }
        }
      }

      if (now - lastLevelUpdateAtRef.current >= INPUT_LEVEL_UPDATE_INTERVAL_MS) {
        lastLevelUpdateAtRef.current = now;
        if (mountedRef.current) {
          setState((current) => ({
            ...current,
            diagnostics: current.diagnostics
              ? {
                  ...current.diagnostics,
                  ...(latestObservationUiRef.current ?? {}),
                  audioContextState: analyser.context.state,
                  inputRms: latestObservationUiRef.current?.inputRms ?? rms,
                  analysisRms: latestObservationUiRef.current?.analysisRms ?? analysisRms,
                }
              : null,
            detectedNote: detectedNoteUiRef.current,
            inputLevel: Math.min(
              1,
              analysisRms / (activeThresholdsRef.current.inputRmsThreshold * 8)
            ),
          }));
        }
      }
    }
    animationRef.current = requestAnimationFrame(runLiveAnalysis);
  }, [postAnalysisFrame, postPracticePitchFrame, processObservation, recordInputFrame]);

  const start = useCallback(
    (options: { includeAccidentals?: boolean } = {}): Promise<boolean> => {
      includeAccidentalsRef.current = options.includeAccidentals === true;
      if (stateRef.current === "listening") {
        const context = audioContextRef.current;
        const stream = streamRef.current;
        const audioTrack = stream?.getAudioTracks()[0];
        const inputIsActive =
          !inputReconnectRequiredRef.current &&
          !audioContextWasInterruptedRef.current &&
          context?.state === "running" &&
          stream?.active === true &&
          audioTrack?.readyState === "live" &&
          !audioTrack.muted;
        if (inputIsActive) {
          recognizerRef.current = createRecognizerForConfiguration(
            activeConfigurationRef.current,
            includeAccidentalsRef.current
          );
          return Promise.resolve(true);
        }

        startGenerationRef.current += 1;
        releaseDevices();
        updateStatus("idle");
      }

      if (startPromiseRef.current) return startPromiseRef.current;
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
        updateStatus("error", "当前浏览器不支持麦克风音频输入。请使用 HTTPS 或 localhost。");
        return Promise.resolve(false);
      }

      let configuration = resolvePracticeMicrophoneConfiguration(preferencesRef.current);
      let thresholds = resolvePracticeMicrophoneThresholds(configuration);
      let frameIntervalMs = resolvePracticeMicrophoneFrameIntervalMs(configuration);
      const recoveringFromBackground = lifecycleRecoveryPendingRef.current;
      const recoveryDeadlineAt = recoveringFromBackground
        ? Date.now() + MICROPHONE_RECOVERY_TIMEOUT_MS
        : null;
      activeConfigurationRef.current = configuration;
      activeAlgorithmRef.current = configuration.algorithm;
      activeThresholdsRef.current = thresholds;
      activeFrameIntervalRef.current = frameIntervalMs;
      recognizerRef.current = createRecognizerForConfiguration(
        configuration,
        includeAccidentalsRef.current
      );
      updateStatus("requesting");
      let attemptGeneration = 0;
      const startSingleAttempt = async (): Promise<boolean> => {
        const generation = ++startGenerationRef.current;
        attemptGeneration = generation;
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        try {
          context = new AudioContext();
          const contextToResume = context;
          const contextResumePromise = contextToResume.resume().then(() => undefined);
          const streamRequest = navigator.mediaDevices.getUserMedia({
            audio: { ...REQUESTED_AUDIO_CONSTRAINTS },
          });
          let requestedStream: MediaStream;
          try {
            const connectionPromise = Promise.all([streamRequest, contextResumePromise] as const);
            [requestedStream] = recoveringFromBackground
              ? await withTimeout(
                  connectionPromise,
                  Math.max(1, (recoveryDeadlineAt ?? Date.now()) - Date.now()),
                  "后台恢复后连接麦克风超时，请重试。"
                )
              : await connectionPromise;
          } catch (error) {
            void streamRequest
              .then((lateStream) => lateStream.getTracks().forEach((track) => track.stop()))
              .catch(() => undefined);
            throw error;
          }
          stream = requestedStream;
          if (!mountedRef.current || generation !== startGenerationRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            void context.close().catch(() => undefined);
            return false;
          }

          if (context.state !== "running") {
            throw new Error("浏览器未能恢复音频处理，麦克风需要重新连接。");
          }
          configuration = resolvePracticeMicrophoneConfiguration(preferencesRef.current);
          thresholds = resolvePracticeMicrophoneThresholds(configuration);
          frameIntervalMs = resolvePracticeMicrophoneFrameIntervalMs(configuration);
          activeConfigurationRef.current = configuration;
          activeAlgorithmRef.current = configuration.algorithm;
          activeThresholdsRef.current = thresholds;
          activeFrameIntervalRef.current = frameIntervalMs;
          recognizerRef.current = createRecognizerForConfiguration(
            configuration,
            includeAccidentalsRef.current
          );

          const source = context.createMediaStreamSource(stream);
          const sampleRate = context.sampleRate;
          const audioContextState = context.state;
          const audioTrack = stream.getAudioTracks()[0];
          const trackSettings = audioTrack?.getSettings();
          const trackSettingsSnapshot = {
            autoGainControl: trackSettings?.autoGainControl ?? null,
            channelCount: trackSettings?.channelCount ?? null,
            echoCancellation: trackSettings?.echoCancellation ?? null,
            noiseSuppression: trackSettings?.noiseSuppression ?? null,
            sampleRate: trackSettings?.sampleRate ?? null,
          };
          const requestedConstraints = getConstraintValues(REQUESTED_AUDIO_CONSTRAINTS);
          const trackConstraints = getTrackConstraintsSnapshot(audioTrack);
          const constraintSupport = getConstraintSupportSnapshot();
          if (mountedRef.current) {
            setState((current) => ({
              ...current,
              diagnostics: {
                algorithm: configuration.algorithm,
                alternativeCandidateConfidence: null,
                alternativeCandidateFrequencyHz: null,
                audioContextSampleRate: sampleRate,
                audioContextState,
                autoGainControl: trackSettings?.autoGainControl ?? null,
                ambiguous: false,
                candidateConfidence: null,
                candidateFrequencyHz: null,
                candidateNote: null,
                channelCount: trackSettings?.channelCount ?? null,
                confidenceThreshold: thresholds.confidenceThreshold,
                detectorDisagreement: false,
                echoCancellation: trackSettings?.echoCancellation ?? null,
                includeAccidentals: includeAccidentalsRef.current,
                inputRms: 0,
                analysisRms: 0,
                inputRmsThreshold: thresholds.inputRmsThreshold,
                lastRecognizedAtMs: null,
                lastRecognizedMidi: null,
                lastRecognizedNote: null,
                noiseSuppression: trackSettings?.noiseSuppression ?? null,
                outcome: "等待音高候选",
                requiredStableFrames: configuration.requiredStableFrames,
                requiredStableMs: configuration.requiredStableMs,
                trackSampleRate: trackSettings?.sampleRate ?? null,
              },
            }));
          }
          const analyser = context.createAnalyser();
          const silentGain = context.createGain();
          const frameSize =
            configuration.algorithm === "swiftf0"
              ? SWIFTF0_INPUT_FRAME_SIZE
              : getPracticeYinInputFrameSize(
                  sampleRate,
                  PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
                );
          analyser.fftSize = frameSize;
          analyser.smoothingTimeConstant = 0;
          captureMetadataRef.current = {
            ...captureConfigurationMetadata(configuration, frameIntervalMs),
            audioContextSampleRate: sampleRate,
            audioContextStateAtCaptureStart: null,
            autoGainControl: trackSettings?.autoGainControl ?? null,
            audioSession: { atStart: null, atEnd: null },
            captureDurationMs: 0,
            captureEndedAt: null,
            captureStartedAt: "",
            captureStopReason: null,
            channelCount: trackSettings?.channelCount ?? null,
            clippingThreshold: PRACTICE_MICROPHONE_CLIPPING_THRESHOLD,
            constraintSupport,
            echoCancellation: trackSettings?.echoCancellation ?? null,
            frameSemantics: PRACTICE_MICROPHONE_FRAME_SEMANTICS,
            frameSize,
            lifecycleEvents: [],
            noiseSuppression: trackSettings?.noiseSuppression ?? null,
            pcmCaptureIntervalMs: PRACTICE_MICROPHONE_PCM_CAPTURE_INTERVAL_MS,
            recordingLimitMs: CAPTURE_MAX_DURATION_MS,
            requestedConstraints,
            trackConstraints,
            trackMutedAtCaptureStart: null,
            trackReadyStateAtCaptureStart: null,
            trackSampleRate: trackSettings?.sampleRate ?? null,
            trackSettings: trackSettingsSnapshot,
            userAgent: navigator.userAgent,
          };
          silentGain.gain.value = 0;
          source.connect(analyser);
          analyser.connect(silentGain);
          silentGain.connect(context.destination);

          streamRef.current = stream;
          stream = null;
          audioContextRef.current = context;
          context = null;
          inputReconnectRequiredRef.current = false;
          audioContextWasInterruptedRef.current = false;
          sourceRef.current = source;
          analyserRef.current = analyser;
          silentGainRef.current = silentGain;
          sampleBufferRef.current = new Float32Array(frameSize);
          detectorRef.current = createDetectorForConfiguration(
            configuration,
            frameSize,
            sampleRate
          );
          const activeContext = audioContextRef.current;
          if (activeContext) {
            const handleAudioContextStateChange = (): void => {
              if (activeContext.state === "running" || stateRef.current !== "listening") return;
              inputReconnectRequiredRef.current = true;
              audioContextWasInterruptedRef.current = true;
              if (!document.hidden) {
                fail("麦克风音频处理已暂停，需要重新连接麦克风。", "microphone-interrupted");
              }
            };
            activeContext.addEventListener("statechange", handleAudioContextStateChange);
            audioContextStateChangeCleanupRef.current = () =>
              activeContext.removeEventListener("statechange", handleAudioContextStateChange);
          }
          recognizerRef.current.reset();
          latestObservationUiRef.current = null;
          detectedNoteUiRef.current = null;
          lastFrameAtRef.current = 0;
          lastLevelUpdateAtRef.current = 0;
          lastVoicedAtRef.current = 0;

          for (const track of streamRef.current?.getAudioTracks() ?? []) {
            track.addEventListener("ended", () => {
              recordCaptureLifecycleEvent("track-ended");
              if (generation === startGenerationRef.current && stateRef.current === "listening") {
                fail("麦克风连接已中断，请重新连接设备。", "microphone-ended");
              }
            });
          }

          if (configuration.algorithm === "swiftf0") {
            const workerTimeoutMs =
              recoveryDeadlineAt === null
                ? undefined
                : Math.max(1, recoveryDeadlineAt - Date.now());
            try {
              await prepare(workerTimeoutMs);
            } catch {
              configuration = createYinFallbackConfiguration(configuration);
              thresholds = resolvePracticeMicrophoneThresholds(configuration);
              frameIntervalMs = resolvePracticeMicrophoneFrameIntervalMs(configuration);
              activeConfigurationRef.current = configuration;
              activeAlgorithmRef.current = "yin";
              activeThresholdsRef.current = thresholds;
              activeFrameIntervalRef.current = frameIntervalMs;
              const fallbackFrameSize = getPracticeYinInputFrameSize(
                sampleRate,
                PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz
              );
              analyser.fftSize = fallbackFrameSize;
              sampleBufferRef.current = new Float32Array(fallbackFrameSize);
              detectorRef.current = createDetectorForConfiguration(
                configuration,
                fallbackFrameSize,
                sampleRate
              );
              recognizerRef.current = createRecognizerForConfiguration(
                configuration,
                includeAccidentalsRef.current
              );
              const captureMetadata = captureMetadataRef.current;
              if (captureMetadata) {
                captureMetadataRef.current = {
                  ...captureMetadata,
                  ...captureConfigurationMetadata(configuration, frameIntervalMs),
                  frameSize: fallbackFrameSize,
                };
              }
              if (mountedRef.current) {
                setState((current) => ({
                  ...current,
                  diagnostics: current.diagnostics
                    ? {
                        ...current.diagnostics,
                        algorithm: "yin",
                        confidenceThreshold: thresholds.confidenceThreshold,
                        inputRmsThreshold: thresholds.inputRmsThreshold,
                        outcome: "SwiftF0 未能启动，已切换备用识别",
                        requiredStableFrames: configuration.requiredStableFrames,
                        requiredStableMs: configuration.requiredStableMs,
                      }
                    : current.diagnostics,
                }));
              }
              ensurePitchWorker();
            }
          } else ensurePitchWorker();
          if (!mountedRef.current || generation !== startGenerationRef.current) return false;
          if (audioContextRef.current?.state !== "running") {
            throw new Error("浏览器已暂停音频处理，麦克风需要重新连接。");
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
            releaseDevices();
            const reloadAlreadyAttempted = hasAttemptedMicrophoneRecoveryReload() === true;
            updateStatus(
              "error",
              reloadAlreadyAttempted
                ? "页面刷新后麦克风仍无法连接，请关闭当前页面后重新进入。"
                : formatStartError(error)
            );
          }
          return false;
        }
      };
      const pendingRef: { current: Promise<boolean> | null } = { current: null };
      const pending = (async (): Promise<boolean> => {
        const started = await startSingleAttempt();
        if (started) {
          lifecycleRecoveryPendingRef.current = false;
          lifecycleRecoveryAttemptCountRef.current = 0;
          backgroundedAtRef.current = null;
          inputReconnectRequiredRef.current = false;
          if (recoveryReloadTimeoutRef.current !== null) {
            window.clearTimeout(recoveryReloadTimeoutRef.current);
            recoveryReloadTimeoutRef.current = null;
          }
          try {
            window.sessionStorage.removeItem(MICROPHONE_RECOVERY_RELOAD_KEY);
          } catch {
            // A successful connection does not depend on session storage.
          }
          return true;
        }

        if (attemptGeneration !== startGenerationRef.current) return false;
        if (!recoveringFromBackground || !lifecycleRecoveryPendingRef.current) return false;
        if (lifecycleRecoveryAttemptCountRef.current === 0) {
          lifecycleRecoveryAttemptCountRef.current = 1;
          updateStatus("requesting", "麦克风恢复失败，正在重新连接…");
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, MICROPHONE_RECOVERY_RETRY_DELAY_MS)
          );
          if (
            !mountedRef.current ||
            stateRef.current !== "requesting" ||
            document.visibilityState === "hidden"
          ) {
            return false;
          }
          if (startPromiseRef.current === pendingRef.current) startPromiseRef.current = null;
          return start(options);
        }

        const reloadAttempted = hasAttemptedMicrophoneRecoveryReload();
        if (reloadAttempted === true) {
          updateStatus("error", "麦克风重连和页面刷新后仍无法恢复，请关闭当前页面后重新进入。");
          return false;
        }
        if (reloadAttempted === null) {
          updateStatus(
            "error",
            "麦克风无法恢复，浏览器也无法保存刷新保护状态；请关闭当前页面后重新进入。"
          );
          return false;
        }

        let recoveryCheckpointSaved = true;
        try {
          await recoveryOptionsRef.current.beforeRecoveryReload?.();
        } catch {
          recoveryCheckpointSaved = false;
        }
        if (
          !mountedRef.current ||
          !lifecycleRecoveryPendingRef.current ||
          stateRef.current !== "error"
        ) {
          return false;
        }
        try {
          window.sessionStorage.setItem(MICROPHONE_RECOVERY_RELOAD_KEY, "1");
        } catch {
          updateStatus("error", "麦克风无法恢复，请关闭当前页面后重新进入。");
          return false;
        }
        updateStatus(
          "error",
          recoveryCheckpointSaved
            ? "麦克风恢复失败，正在刷新页面；练习会记为中断，游戏本局会重新开始。"
            : "练习中断记录未能保存，仍会刷新页面尝试恢复麦克风…"
        );
        recoveryReloadTimeoutRef.current = window.setTimeout(() => {
          recoveryReloadTimeoutRef.current = null;
          if (!mountedRef.current || !lifecycleRecoveryPendingRef.current) return;
          if (stateRef.current !== "error") {
            try {
              window.sessionStorage.removeItem(MICROPHONE_RECOVERY_RELOAD_KEY);
            } catch {
              // A later recovery attempt can still proceed without session storage.
            }
            return;
          }
          window.location.reload();
        }, MICROPHONE_RECOVERY_RELOAD_DELAY_MS);
        return false;
      })();
      pendingRef.current = pending;
      startPromiseRef.current = pending;
      void pending.finally(() => {
        if (startPromiseRef.current === pending) startPromiseRef.current = null;
      });
      return pending;
    },
    [
      ensurePitchWorker,
      prepare,
      fail,
      recordCaptureLifecycleEvent,
      releaseDevices,
      runLiveAnalysis,
      updateStatus,
    ]
  );

  useEffect(() => {
    const configuration = resolvePracticeMicrophoneConfiguration(preferences);
    if (configuration.algorithm !== activeAlgorithmRef.current) {
      pitchWorkerRef.current?.terminate();
      pitchWorkerRef.current = null;
      pitchWorkerFailureRef.current = false;
      if (activeAlgorithmRef.current === "swiftf0" && configuration.algorithm !== "swiftf0") {
        workerUnsubscribeRef.current?.();
        workerUnsubscribeRef.current = null;
        workerReadyRef.current = false;
        workerRef.current = null;
      }
      if (stateRef.current === "listening" || stateRef.current === "requesting") {
        startGenerationRef.current += 1;
        releaseDevices("input-released");
        updateStatus("idle", "识别算法已变更，麦克风已断开；请重新连接以应用新算法。");
      }
      return;
    }
    if (stateRef.current !== "listening") return;
    if (captureRecordingRef.current) return;

    const analyser = analyserRef.current;
    const context = audioContextRef.current;
    if (!analyser || !context) return;

    const thresholds = resolvePracticeMicrophoneThresholds(configuration);
    activeConfigurationRef.current = configuration;
    activeThresholdsRef.current = thresholds;
    activeFrameIntervalRef.current = resolvePracticeMicrophoneFrameIntervalMs(configuration);
    detectorRef.current = createDetectorForConfiguration(
      configuration,
      analyser.fftSize,
      context.sampleRate
    );
    recognizerRef.current = createRecognizerForConfiguration(
      configuration,
      includeAccidentalsRef.current
    );
    inputGenerationRef.current += 1;
    if (analysisTimeoutRef.current !== null) {
      window.clearTimeout(analysisTimeoutRef.current);
      analysisTimeoutRef.current = null;
    }
    pendingAnalysisRef.current = null;
    requestInFlightRef.current = false;
    finalCaptureFrameIssueRef.current = "识别配置已变更，最后一帧识别已取消";
    settleCaptureStopWaiters();
    const metadata = captureMetadataRef.current;
    if (metadata) {
      captureMetadataRef.current = {
        ...metadata,
        ...captureConfigurationMetadata(configuration, activeFrameIntervalRef.current),
      };
    }
    setState((current) =>
      current.diagnostics
        ? {
            ...current,
            diagnostics: {
              ...current.diagnostics,
              algorithm: configuration.algorithm,
              confidenceThreshold: configuration.confidenceThreshold,
              includeAccidentals: includeAccidentalsRef.current,
              inputRmsThreshold: configuration.inputRmsThreshold,
              requiredStableFrames: configuration.requiredStableFrames,
              requiredStableMs: configuration.requiredStableMs,
            },
          }
        : current
    );
  }, [preferences, releaseDevices, settleCaptureStopWaiters, updateStatus]);

  const stop = useCallback(
    (
      options: {
        captureStopReason?: PracticeMicrophoneCaptureStopReason;
        preserveError?: boolean;
      } = {}
    ): void => {
      const recoveryWasPending = lifecycleRecoveryPendingRef.current;
      lifecycleRecoveryPendingRef.current = false;
      lifecycleRecoveryAttemptCountRef.current = 0;
      backgroundedAtRef.current = null;
      inputReconnectRequiredRef.current = false;
      if (recoveryReloadTimeoutRef.current !== null) {
        window.clearTimeout(recoveryReloadTimeoutRef.current);
        recoveryReloadTimeoutRef.current = null;
      }
      if (recoveryWasPending) {
        try {
          window.sessionStorage.removeItem(MICROPHONE_RECOVERY_RELOAD_KEY);
        } catch {
          // Cancelling recovery does not depend on session storage.
        }
      }
      startGenerationRef.current += 1;
      releaseDevices(options.captureStopReason ?? "input-released");
      updateStatus("idle", options.preserveError ? errorRef.current : null);
    },
    [releaseDevices, updateStatus]
  );

  const saveRecentCapture = useCallback(
    async (analysis?: PracticeMicrophoneAnalysis): Promise<void> => {
      const metadata = recordedMetadataRef.current;
      const frames = captureFramesRef.current.slice();
      if (!metadata || frames.length === 0) {
        setState((current) => ({ ...current, captureStatus: "还没有可保存的采样" }));
        return;
      }

      const fileName = `piano-microphone-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const shareNavigator = navigator as Pick<Navigator, "maxTouchPoints"> & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };

      try {
        const file = new File(
          [createPracticeMicrophoneCaptureBlob(metadata, frames, analysis)],
          fileName,
          {
            type: "application/json",
          }
        );
        let canShareFile = false;
        try {
          canShareFile =
            navigator.maxTouchPoints > 0 &&
            Boolean(shareNavigator.share && shareNavigator.canShare?.({ files: [file] }));
        } catch {
          canShareFile = false;
        }

        let shareFailed = false;
        if (canShareFile && shareNavigator.share) {
          try {
            await shareNavigator.share({ files: [file], title: "练习麦克风采样" });
            setState((current) => ({ ...current, captureStatus: "采样文件已通过系统分享" }));
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              setState((current) => ({ ...current, captureStatus: "已取消分享，采样仍保留" }));
              return;
            }
            shareFailed = true;
            console.warn(
              "Practice microphone file sharing failed; falling back to download.",
              error
            );
          }
        }

        downloadCaptureFile(file);
        setState((current) => ({
          ...current,
          captureStatus: shareFailed
            ? "系统分享不可用，已改用浏览器下载"
            : "已开始下载采样文件，请检查下载列表",
        }));
      } catch (error) {
        const message = error instanceof Error && error.message ? `：${error.message}` : "";
        console.error("Practice microphone file export failed.", error);
        setState((current) => ({ ...current, captureStatus: `采样文件导出失败${message}` }));
      }
    },
    []
  );

  const startCapture = useCallback((): void => {
    const metadata = captureMetadataRef.current;
    if (!metadata || stateRef.current !== "listening") {
      setState((current) => ({ ...current, captureStatus: "连接麦克风后即可开始采集" }));
      return;
    }
    const configuration = resolvePracticeMicrophoneConfiguration(preferencesRef.current);
    captureFramesRef.current = [];
    captureAudioLoopFrameCountRef.current = 0;
    latestInputRmsRef.current = 0;
    finalCaptureFrameIssueRef.current = null;
    const captureStartedAt = new Date();
    captureStartedAtMonotonicRef.current = performance.now();
    recordedMetadataRef.current = {
      ...metadata,
      ...captureConfigurationMetadata(configuration),
      audioContextStateAtCaptureStart: audioContextRef.current?.state ?? null,
      audioSession: { atStart: getAudioSessionSnapshot(), atEnd: null },
      captureDurationMs: 0,
      captureEndedAt: null,
      captureStartedAt: captureStartedAt.toISOString(),
      captureStopReason: null,
      lifecycleEvents: [],
      trackMutedAtCaptureStart: streamRef.current?.getAudioTracks()[0]?.muted ?? null,
      trackReadyStateAtCaptureStart: streamRef.current?.getAudioTracks()[0]?.readyState ?? null,
    };
    captureRecordingRef.current = true;
    const track = streamRef.current?.getAudioTracks()[0];
    const context = audioContextRef.current;
    const onMute = (): void => recordCaptureLifecycleEvent("track-muted");
    const onUnmute = (): void => recordCaptureLifecycleEvent("track-unmuted");
    const onEnded = (): void => recordCaptureLifecycleEvent("track-ended");
    const onContextStateChange = (): void =>
      recordCaptureLifecycleEvent("audio-context-state", context?.state);
    track?.addEventListener("mute", onMute);
    track?.addEventListener("unmute", onUnmute);
    track?.addEventListener("ended", onEnded);
    context?.addEventListener("statechange", onContextStateChange);
    captureLifecycleCleanupRef.current = () => {
      track?.removeEventListener("mute", onMute);
      track?.removeEventListener("unmute", onUnmute);
      track?.removeEventListener("ended", onEnded);
      context?.removeEventListener("statechange", onContextStateChange);
    };
    lastCaptureCountUpdateAtRef.current = 0;
    lastPcmCaptureAtRef.current = 0;
    setState((current) => ({
      ...current,
      captureDurationMs: 0,
      captureFrameCount: 0,
      captureAnalysisPending: false,
      captureRecording: true,
      captureStatus: "开始弹奏，采样会保留到结束后",
    }));
  }, [recordCaptureLifecycleEvent]);

  const resetCapture = useCallback((): void => {
    if (captureRecordingRef.current) finishCapture("input-released");
    captureFramesRef.current = [];
    captureAudioLoopFrameCountRef.current = 0;
    latestInputRmsRef.current = 0;
    recordedMetadataRef.current = null;
    finalCaptureFrameIssueRef.current = null;
    captureStartedAtMonotonicRef.current = 0;
    lastCaptureCountUpdateAtRef.current = 0;
    lastPcmCaptureAtRef.current = 0;
    settleCaptureStopWaiters();
    setState((current) => ({
      ...current,
      captureDurationMs: 0,
      captureFrameCount: 0,
      captureAnalysisPending: false,
      captureRecording: false,
      captureStatus: null,
    }));
  }, [finishCapture, settleCaptureStopWaiters]);

  const suppressRecognizedNotes = useCallback(
    (midiNotes: readonly number[], startAtMs: number, endAtMs: number): void => {
      if (midiNotes.length === 0 || endAtMs <= startAtMs) return;
      recognizedNoteSuppressionWindowsRef.current = [
        ...recognizedNoteSuppressionWindowsRef.current.filter(
          (window) => window.endAtMs >= startAtMs
        ),
        {
          endAtMs,
          midiNotes: new Set(midiNotes),
          startAtMs,
        },
      ];
    },
    []
  );

  const stopCapture = useCallback(async (): Promise<{
    audioContextState: string;
    audioLoopFrameCount: number;
    captureDurationMs: number;
    error: string | null;
    finalFrameIssue: string | null;
    frameCount: number;
    inputRms: number;
    trackMuted: boolean | null;
    trackReadyState: string;
  }> => {
    const durationMs = finishCapture("manual") ?? 0;
    const frames = captureFramesRef.current;
    const analysisInFlight = requestInFlightRef.current;
    const captureAnalysisPending =
      analysisInFlight &&
      (pendingAnalysisRef.current?.timeMs ?? 0) >= captureStartedAtMonotonicRef.current;
    setState((current) => ({
      ...current,
      captureDurationMs: durationMs,
      captureFrameCount: frames.length,
      captureAnalysisPending,
      captureRecording: false,
      captureStatus: captureAnalysisPending
        ? "正在等待最后一帧识别完成"
        : frames.length > 0
          ? "采样已保留，可以分析"
          : "这次没有采到音频帧",
    }));
    if (analysisInFlight) {
      await new Promise<void>((resolve) => {
        captureStopWaitersRef.current.push(resolve);
        if (!requestInFlightRef.current) settleCaptureStopWaiters();
      });
    }
    return {
      audioContextState: audioContextRef.current?.state ?? "不可用",
      audioLoopFrameCount: captureAudioLoopFrameCountRef.current,
      captureDurationMs: durationMs,
      error: errorRef.current,
      finalFrameIssue: finalCaptureFrameIssueRef.current,
      frameCount: captureFramesRef.current.length,
      inputRms: latestInputRmsRef.current,
      trackMuted: streamRef.current?.getAudioTracks()[0]?.muted ?? null,
      trackReadyState: streamRef.current?.getAudioTracks()[0]?.readyState ?? "不可用",
    };
  }, [finishCapture, settleCaptureStopWaiters]);

  const copyDiagnosticSummary = useCallback(
    async (analysis?: PracticeMicrophoneAnalysis): Promise<void> => {
      const metadata = recordedMetadataRef.current ?? captureMetadataRef.current;
      if (!metadata) {
        setState((current) => ({ ...current, captureStatus: "麦克风连接后可复制诊断摘要" }));
        return;
      }

      const summary = {
        format: "piano-learning-practice-microphone-summary",
        exportedAt: new Date().toISOString(),
        frameSemantics: PRACTICE_MICROPHONE_FRAME_SEMANTICS,
        currentListening: {
          diagnostics: state.diagnostics,
          metadata: captureMetadataRef.current,
        },
        captureMetadata: recordedMetadataRef.current,
        analysis: analysis ?? null,
        bufferedFrameCount: captureFramesRef.current.length,
        bufferedTimeRangeMs:
          captureFramesRef.current.length > 1
            ? Math.round(
                captureFramesRef.current.at(-1)!.timeMs - captureFramesRef.current[0].timeMs
              )
            : 0,
        latestCapturedFrame: (() => {
          const frame = captureFramesRef.current.at(-1);
          if (!frame) return null;
          const { samples: _samples, timeMs: _timeMs, ...summaryFrame } = frame;
          return summaryFrame;
        })(),
      };

      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
        setState((current) => ({ ...current, captureStatus: "诊断摘要已复制" }));
      } catch {
        setState((current) => ({ ...current, captureStatus: "无法访问剪贴板，请保存采样文件" }));
      }
    },
    [state.diagnostics]
  );

  const analyzeCapture = useCallback(
    (expectedSequence: readonly number[] | null): PracticeMicrophoneAnalysis | null => {
      const metadata = recordedMetadataRef.current;
      const frames = captureFramesRef.current;
      if (
        !metadata ||
        frames.length === 0 ||
        captureRecordingRef.current ||
        requestInFlightRef.current
      ) {
        setState((current) => ({
          ...current,
          captureStatus: captureRecordingRef.current
            ? "请结束采集后再分析"
            : requestInFlightRef.current
              ? "最后一帧仍在识别，请稍后再分析"
              : "还没有可分析的采样",
        }));
        return null;
      }

      const analysis = analyzePracticeMicrophoneCapture(metadata, frames, expectedSequence);
      setState((current) => ({ ...current, captureStatus: "采样分析完成" }));
      return analysis;
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    const markInputForReconnect = (): void => {
      const status = stateRef.current;
      const isListening = status === "listening";
      const isConnectingWithStream = status === "requesting" && streamRef.current !== null;
      if (!isListening && !isConnectingWithStream) return;
      const isBackgrounded =
        document.visibilityState === "hidden" || (isListening && !document.hasFocus());
      if (!isBackgrounded) return;
      backgroundedAtRef.current ??= Date.now();
      lifecycleRecoveryPendingRef.current = true;
      lifecycleRecoveryAttemptCountRef.current = 0;
      inputReconnectRequiredRef.current = true;
    };
    const recoverInterruptedInput = (): void => {
      if (document.hidden) {
        markInputForReconnect();
        return;
      }
      if (!lifecycleRecoveryPendingRef.current) return;
      const status = stateRef.current;
      const isListening = status === "listening";
      const isConnectingWithStream = status === "requesting" && streamRef.current !== null;
      if (!isListening && !isConnectingWithStream) {
        lifecycleRecoveryPendingRef.current = false;
        lifecycleRecoveryAttemptCountRef.current = 0;
        backgroundedAtRef.current = null;
        inputReconnectRequiredRef.current = false;
        return;
      }
      const backgroundDurationMs =
        backgroundedAtRef.current === null
          ? Number.POSITIVE_INFINITY
          : Date.now() - backgroundedAtRef.current;
      const context = audioContextRef.current;
      const stream = streamRef.current;
      const audioTrack = stream?.getAudioTracks()[0];
      const inputLooksAvailable =
        context?.state === "running" &&
        stream?.active === true &&
        audioTrack?.readyState === "live" &&
        !audioTrack.muted;
      backgroundedAtRef.current = null;
      if (
        isListening &&
        backgroundDurationMs < MICROPHONE_BACKGROUND_RECOVERY_MIN_DURATION_MS &&
        inputLooksAvailable
      ) {
        lifecycleRecoveryPendingRef.current = false;
        lifecycleRecoveryAttemptCountRef.current = 0;
        inputReconnectRequiredRef.current = false;
        return;
      }
      if (isListening || isConnectingWithStream) {
        fail("页面从后台恢复后，麦克风连接已中断，需要重新连接。", "microphone-interrupted");
      }
    };
    const handleVisibilityChange = (): void => recoverInterruptedInput();
    const handlePageShow = (): void => recoverInterruptedInput();
    const handleWindowBlur = (): void => markInputForReconnect();
    const handleWindowFocus = (): void => recoverInterruptedInput();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", markInputForReconnect);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", markInputForReconnect);
      if (recoveryReloadTimeoutRef.current !== null) {
        window.clearTimeout(recoveryReloadTimeoutRef.current);
        recoveryReloadTimeoutRef.current = null;
      }
      startGenerationRef.current += 1;
      releaseDevices("component-unmounted");
      workerUnsubscribeRef.current?.();
      workerUnsubscribeRef.current = null;
      workerReadyRef.current = false;
      workerRef.current = null;
      pitchWorkerRef.current?.terminate();
      pitchWorkerRef.current = null;
    };
  }, [fail, releaseDevices]);

  const activeAlgorithm =
    state.status === "listening" || state.status === "requesting"
      ? activeAlgorithmRef.current
      : initialConfiguration.algorithm;

  return {
    ...state,
    activeAlgorithm,
    analyzeCapture,
    copyDiagnosticSummary,
    isListening: state.status === "listening",
    isPreparingSwiftF0,
    resetCapture,
    saveRecentCapture,
    startCapture,
    suppressRecognizedNotes,
    stopCapture,
    start,
    stop,
    prepare,
  };
}
