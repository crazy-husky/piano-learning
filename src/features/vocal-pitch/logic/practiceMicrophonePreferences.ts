export type PracticeMicrophoneAlgorithm = "swiftf0" | "yin";
export const PRACTICE_MICROPHONE_SENSITIVITY_LEVELS = [1, 2, 3] as const;
export type PracticeMicrophoneSensitivityLevel =
  (typeof PRACTICE_MICROPHONE_SENSITIVITY_LEVELS)[number];
export const PRACTICE_MICROPHONE_FRAME_INTERVALS = [20, 30, 40, 50] as const;
export type PracticeMicrophoneFrameInterval =
  (typeof PRACTICE_MICROPHONE_FRAME_INTERVALS)[number] | "auto";
export const PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS = [2, 3, 4] as const;
export type PracticeMicrophoneStableFrameCount =
  (typeof PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS)[number];
export const PRACTICE_MICROPHONE_STABLE_DURATIONS = [50, 80] as const;
export type PracticeMicrophoneStableDuration =
  (typeof PRACTICE_MICROPHONE_STABLE_DURATIONS)[number];
export const PRACTICE_MICROPHONE_ANALYSIS_GAINS = [1, 4, 8, 10, 15, 20] as const;
export type PracticeMicrophoneAnalysisGain = (typeof PRACTICE_MICROPHONE_ANALYSIS_GAINS)[number];

export interface PracticeMicrophoneDebugParameters {
  analysisGain: PracticeMicrophoneAnalysisGain;
  confidenceThreshold: number;
  frameIntervalMs: PracticeMicrophoneFrameInterval;
  inputRmsThreshold: number;
  requiredStableFrames: PracticeMicrophoneStableFrameCount;
  requiredStableMs: PracticeMicrophoneStableDuration;
  yinThreshold: number;
}

export interface PracticeMicrophonePreferences {
  algorithm: PracticeMicrophoneAlgorithm;
  debugMode: boolean;
  debugParameters: PracticeMicrophoneDebugParameters;
  sensitivityScaleVersion: 2;
  sensitivityLevel: PracticeMicrophoneSensitivityLevel;
}

export interface PracticeMicrophoneConfiguration extends PracticeMicrophoneDebugParameters {
  algorithm: PracticeMicrophoneAlgorithm;
  debugMode: boolean;
  sensitivityLevel: PracticeMicrophoneSensitivityLevel;
}

export interface PracticeMicrophoneThresholds {
  confidenceThreshold: number;
  inputRmsThreshold: number;
  yinThreshold?: number;
}

export const PRACTICE_MICROPHONE_PREFERENCES_KEY = "anki-note.practiceMicrophonePreferences";

const DEFAULT_DEBUG_PARAMETERS: PracticeMicrophoneDebugParameters = {
  analysisGain: 8,
  confidenceThreshold: 0.7,
  frameIntervalMs: 40,
  inputRmsThreshold: 0.0018,
  requiredStableFrames: 3,
  requiredStableMs: 80,
  yinThreshold: 0.15,
};

export const DEFAULT_PRACTICE_MICROPHONE_PREFERENCES: PracticeMicrophonePreferences = {
  algorithm: "swiftf0",
  debugMode: false,
  debugParameters: DEFAULT_DEBUG_PARAMETERS,
  sensitivityScaleVersion: 2,
  sensitivityLevel: 2,
};

export function createDefaultPracticeMicrophonePreferences(
  sensitivityLevel: PracticeMicrophoneSensitivityLevel = 2
): PracticeMicrophonePreferences {
  return {
    ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
    debugParameters: { ...DEFAULT_DEBUG_PARAMETERS },
    sensitivityLevel,
  };
}

export function isTouchPracticeDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): boolean {
  return (
    /iPhone|iPad|iPod|Android/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export function defaultPracticeMicrophoneSensitivityForDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): PracticeMicrophoneSensitivityLevel {
  // Keep the stronger touch-device default after moving from the old five-step scale.
  return isTouchPracticeDevice(userAgent, platform, maxTouchPoints) ? 3 : 2;
}

export function normalizePracticeMicrophoneDebugParameters(
  value: Partial<PracticeMicrophoneDebugParameters>
): PracticeMicrophoneDebugParameters {
  return parseDebugParameters(value, DEFAULT_DEBUG_PARAMETERS);
}

export function withPracticeMicrophoneAlgorithm(
  preferences: PracticeMicrophonePreferences,
  algorithm: PracticeMicrophoneAlgorithm
): PracticeMicrophonePreferences {
  return {
    ...preferences,
    algorithm,
    ...(!preferences.debugMode
      ? {
          debugParameters: practiceMicrophoneDebugParametersForSensitivityLevel(
            algorithm,
            preferences.sensitivityLevel
          ),
        }
      : {}),
  };
}

interface SensitivityProfile {
  analysisGain: PracticeMicrophoneAnalysisGain;
  inputRmsThreshold: number;
}

const SENSITIVITY_PROFILES: Record<PracticeMicrophoneSensitivityLevel, SensitivityProfile> = {
  1: {
    analysisGain: 1,
    inputRmsThreshold: 0.0036,
  },
  2: {
    analysisGain: 8,
    inputRmsThreshold: 0.0018,
  },
  3: {
    analysisGain: 15,
    inputRmsThreshold: 0.0009,
  },
};

function isAlgorithm(value: unknown): value is PracticeMicrophoneAlgorithm {
  return value === "swiftf0" || value === "yin";
}

function parseBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseDebugParameters(
  value: unknown,
  fallback: PracticeMicrophoneDebugParameters
): PracticeMicrophoneDebugParameters {
  if (typeof value !== "object" || value === null) return fallback;
  const stored = value as Partial<PracticeMicrophoneDebugParameters>;
  return {
    analysisGain: PRACTICE_MICROPHONE_ANALYSIS_GAINS.includes(
      stored.analysisGain as PracticeMicrophoneAnalysisGain
    )
      ? (stored.analysisGain as PracticeMicrophoneAnalysisGain)
      : fallback.analysisGain,
    confidenceThreshold: parseBoundedNumber(
      stored.confidenceThreshold,
      fallback.confidenceThreshold,
      0,
      1
    ),
    frameIntervalMs:
      stored.frameIntervalMs === "auto" ||
      PRACTICE_MICROPHONE_FRAME_INTERVALS.some((interval) => interval === stored.frameIntervalMs)
        ? (stored.frameIntervalMs as PracticeMicrophoneFrameInterval)
        : fallback.frameIntervalMs,
    inputRmsThreshold: parseBoundedNumber(
      stored.inputRmsThreshold,
      fallback.inputRmsThreshold,
      0,
      0.01
    ),
    requiredStableFrames: PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS.includes(
      stored.requiredStableFrames as PracticeMicrophoneStableFrameCount
    )
      ? (stored.requiredStableFrames as PracticeMicrophoneStableFrameCount)
      : fallback.requiredStableFrames,
    requiredStableMs: PRACTICE_MICROPHONE_STABLE_DURATIONS.includes(
      stored.requiredStableMs as PracticeMicrophoneStableDuration
    )
      ? (stored.requiredStableMs as PracticeMicrophoneStableDuration)
      : fallback.requiredStableMs,
    yinThreshold: parseBoundedNumber(stored.yinThreshold, fallback.yinThreshold, 0.01, 1),
  };
}

export function parsePracticeMicrophonePreferences(
  value: unknown,
  fallback: PracticeMicrophonePreferences = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES
): PracticeMicrophonePreferences {
  if (typeof value !== "object" || value === null) return fallback;
  const stored = value as Record<string, unknown>;
  const sensitivityLevel =
    stored.sensitivityScaleVersion === 2 &&
    PRACTICE_MICROPHONE_SENSITIVITY_LEVELS.includes(
      stored.sensitivityLevel as PracticeMicrophoneSensitivityLevel
    )
      ? (stored.sensitivityLevel as PracticeMicrophoneSensitivityLevel)
      : typeof stored.sensitivityLevel === "number"
        ? stored.sensitivityLevel <= 1
          ? 3
          : stored.sensitivityLevel === 2
            ? 2
            : stored.sensitivityLevel === 3
              ? 2
              : 1
        : fallback.sensitivityLevel;
  return {
    algorithm: isAlgorithm(stored.algorithm) ? stored.algorithm : fallback.algorithm,
    debugMode: stored.debugMode === true,
    debugParameters: parseDebugParameters(stored.debugParameters, fallback.debugParameters),
    sensitivityScaleVersion: 2,
    sensitivityLevel,
  };
}

/** Global app preferences never inherit temporary parameter-debug mode from older builds. */
export function parseSystemPracticeMicrophonePreferences(
  value: unknown,
  fallback: PracticeMicrophonePreferences = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES
): PracticeMicrophonePreferences {
  const preferences = parsePracticeMicrophonePreferences(value, fallback);
  return {
    ...preferences,
    algorithm: "swiftf0",
    debugMode: false,
    debugParameters: practiceMicrophoneDebugParametersForSensitivityLevel(
      "swiftf0",
      preferences.sensitivityLevel
    ),
  };
}

function resolveProfileThresholds(
  algorithm: PracticeMicrophoneAlgorithm,
  sensitivityLevel: PracticeMicrophoneSensitivityLevel
): PracticeMicrophoneThresholds {
  const profile = SENSITIVITY_PROFILES[sensitivityLevel];
  return {
    confidenceThreshold: algorithm === "swiftf0" ? 0.7 : 0.9,
    inputRmsThreshold: profile.inputRmsThreshold,
    ...(algorithm === "yin" ? { yinThreshold: 0.15 } : {}),
  };
}

export function practiceMicrophoneDebugParametersForSensitivityLevel(
  algorithm: PracticeMicrophoneAlgorithm,
  sensitivityLevel: PracticeMicrophoneSensitivityLevel
): PracticeMicrophoneDebugParameters {
  const profile = SENSITIVITY_PROFILES[sensitivityLevel];
  const thresholds = resolveProfileThresholds(algorithm, sensitivityLevel);
  return {
    analysisGain: profile.analysisGain,
    confidenceThreshold: thresholds.confidenceThreshold,
    frameIntervalMs: algorithm === "swiftf0" ? 40 : 30,
    inputRmsThreshold: thresholds.inputRmsThreshold,
    requiredStableFrames: algorithm === "swiftf0" ? 3 : 4,
    requiredStableMs: 80,
    yinThreshold: thresholds.yinThreshold ?? 0.15,
  };
}

/** Fixed YIN safety profile used when the primary SwiftF0 runtime cannot initialize. */
export function createYinFallbackConfiguration(
  configuration: PracticeMicrophoneConfiguration
): PracticeMicrophoneConfiguration {
  return {
    ...configuration,
    algorithm: "yin",
    confidenceThreshold: 0.9,
    frameIntervalMs: 30,
    requiredStableFrames: 4,
    requiredStableMs: 80,
    yinThreshold: 0.15,
  };
}

export function resolvePracticeMicrophoneConfiguration(
  preferences: PracticeMicrophonePreferences
): PracticeMicrophoneConfiguration {
  const normalized = parsePracticeMicrophonePreferences(preferences);
  const profileParameters = practiceMicrophoneDebugParametersForSensitivityLevel(
    normalized.algorithm,
    normalized.sensitivityLevel
  );
  const parameters = normalized.debugMode ? normalized.debugParameters : profileParameters;
  return {
    algorithm: normalized.algorithm,
    analysisGain: parameters.analysisGain,
    confidenceThreshold: parameters.confidenceThreshold,
    debugMode: normalized.debugMode,
    frameIntervalMs: parameters.frameIntervalMs,
    inputRmsThreshold: parameters.inputRmsThreshold,
    requiredStableFrames: parameters.requiredStableFrames,
    requiredStableMs: parameters.requiredStableMs,
    sensitivityLevel: normalized.sensitivityLevel,
    yinThreshold: parameters.yinThreshold,
  };
}

export function resolvePracticeMicrophoneFrameIntervalMs(
  preferences: Pick<PracticeMicrophoneConfiguration, "algorithm" | "frameIntervalMs">
): number {
  if (preferences.frameIntervalMs !== "auto") return preferences.frameIntervalMs;
  return preferences.algorithm === "yin" ? 30 : 40;
}

export function resolvePracticeMicrophoneThresholds(
  configuration: PracticeMicrophoneConfiguration
): PracticeMicrophoneThresholds {
  return {
    confidenceThreshold: configuration.confidenceThreshold,
    inputRmsThreshold: configuration.inputRmsThreshold,
    ...(configuration.algorithm === "yin" ? { yinThreshold: configuration.yinThreshold } : {}),
  };
}

export function practiceMicrophoneSensitivityLevelLabel(
  level: PracticeMicrophoneSensitivityLevel
): string {
  const labels: Record<PracticeMicrophoneSensitivityLevel, string> = {
    1: "低敏感 · 抗噪",
    2: "标准",
    3: "高敏感 · 弱麦克风",
  };
  return labels[level];
}

export function practiceMicrophoneAlgorithmLabel(algorithm: PracticeMicrophoneAlgorithm): string {
  if (algorithm === "swiftf0") return "SwiftF0";
  return "YIN";
}
