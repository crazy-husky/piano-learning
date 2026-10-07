export type PracticeMicrophoneAlgorithm = "mpm-c" | "swiftf0" | "yin";
export const PRACTICE_MICROPHONE_SENSITIVITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type PracticeMicrophoneSensitivityLevel = (typeof PRACTICE_MICROPHONE_SENSITIVITY_LEVELS)[number];
export const PRACTICE_MICROPHONE_FRAME_INTERVALS = [20, 30, 50] as const;
export type PracticeMicrophoneFrameInterval = (typeof PRACTICE_MICROPHONE_FRAME_INTERVALS)[number] | "auto";
export const PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS = [2, 3, 4] as const;
export type PracticeMicrophoneStableFrameCount = (typeof PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS)[number];
export const PRACTICE_MICROPHONE_STABLE_DURATIONS = [50, 80] as const;
export type PracticeMicrophoneStableDuration = (typeof PRACTICE_MICROPHONE_STABLE_DURATIONS)[number];
export const PRACTICE_MICROPHONE_ANALYSIS_GAINS = [1, 4, 8, 10, 15] as const;
export type PracticeMicrophoneAnalysisGain = (typeof PRACTICE_MICROPHONE_ANALYSIS_GAINS)[number];

export interface PracticeMicrophoneDebugParameters {
  analysisGain: PracticeMicrophoneAnalysisGain;
  confidenceThreshold: number;
  frameIntervalMs: PracticeMicrophoneFrameInterval;
  inputRmsThreshold: number;
  primaryClarityThreshold: number;
  requiredStableFrames: PracticeMicrophoneStableFrameCount;
  requiredStableMs: PracticeMicrophoneStableDuration;
  yinThreshold: number;
}

export interface PracticeMicrophonePreferences {
  algorithm: PracticeMicrophoneAlgorithm;
  debugMode: boolean;
  debugParameters: PracticeMicrophoneDebugParameters;
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
  primaryClarityThreshold?: number;
  yinThreshold?: number;
}

export const PRACTICE_MICROPHONE_PREFERENCES_KEY = "anki-note.practiceMicrophonePreferences";

const DEFAULT_DEBUG_PARAMETERS: PracticeMicrophoneDebugParameters = {
  analysisGain: 1,
  confidenceThreshold: 0.75,
  frameIntervalMs: "auto",
  inputRmsThreshold: 0.0018,
  primaryClarityThreshold: 0.8,
  requiredStableFrames: 4,
  requiredStableMs: 80,
  yinThreshold: 0.15,
};

export const DEFAULT_PRACTICE_MICROPHONE_PREFERENCES: PracticeMicrophonePreferences = {
  algorithm: "mpm-c",
  debugMode: false,
  debugParameters: DEFAULT_DEBUG_PARAMETERS,
  sensitivityLevel: 3,
};

export function createDefaultPracticeMicrophonePreferences(
  sensitivityLevel: PracticeMicrophoneSensitivityLevel = 3,
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
  maxTouchPoints: number,
): boolean {
  return /iPhone|iPad|iPod|Android/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function normalizePracticeMicrophoneDebugParameters(
  value: Partial<PracticeMicrophoneDebugParameters>,
): PracticeMicrophoneDebugParameters {
  return parseDebugParameters(value, DEFAULT_DEBUG_PARAMETERS);
}

export function withPracticeMicrophoneAlgorithm(
  preferences: PracticeMicrophonePreferences,
  algorithm: PracticeMicrophoneAlgorithm,
): PracticeMicrophonePreferences {
  return {
    ...preferences,
    algorithm,
    ...(!preferences.debugMode
      ? {
          debugParameters: practiceMicrophoneDebugParametersForSensitivityLevel(
            algorithm,
            preferences.sensitivityLevel,
          ),
        }
      : {}),
  };
}

interface SensitivityProfile {
  analysisGain: PracticeMicrophoneAnalysisGain;
  confidenceThresholds: Record<PracticeMicrophoneAlgorithm, number>;
  inputRmsThreshold: number;
  primaryClarityOffset: number;
  requiredStableFrames: PracticeMicrophoneStableFrameCount;
  requiredStableMs: PracticeMicrophoneStableDuration;
  yinThreshold: number;
}

const SENSITIVITY_PROFILES: Record<PracticeMicrophoneSensitivityLevel, SensitivityProfile> = {
  1: {
    analysisGain: 15,
    confidenceThresholds: { "mpm-c": 0.6, swiftf0: 0.4, yin: 0.6 },
    inputRmsThreshold: 0.0009,
    primaryClarityOffset: 0.05,
    requiredStableFrames: 2,
    requiredStableMs: 50,
    yinThreshold: 0.25,
  },
  2: {
    analysisGain: 8,
    confidenceThresholds: { "mpm-c": 0.675, swiftf0: 0.5, yin: 0.675 },
    inputRmsThreshold: 0.00135,
    primaryClarityOffset: 0.05,
    requiredStableFrames: 2,
    requiredStableMs: 80,
    yinThreshold: 0.2,
  },
  3: {
    analysisGain: 1,
    confidenceThresholds: { "mpm-c": 0.75, swiftf0: 0.6, yin: 0.75 },
    inputRmsThreshold: 0.0018,
    primaryClarityOffset: 0.05,
    requiredStableFrames: 4,
    requiredStableMs: 80,
    yinThreshold: 0.15,
  },
  4: {
    analysisGain: 1,
    confidenceThresholds: { "mpm-c": 0.825, swiftf0: 0.7, yin: 0.825 },
    inputRmsThreshold: 0.0027,
    primaryClarityOffset: 0.05,
    requiredStableFrames: 4,
    requiredStableMs: 80,
    yinThreshold: 0.125,
  },
  5: {
    analysisGain: 1,
    confidenceThresholds: { "mpm-c": 0.9, swiftf0: 0.8, yin: 0.9 },
    inputRmsThreshold: 0.0036,
    primaryClarityOffset: 0.05,
    requiredStableFrames: 4,
    requiredStableMs: 80,
    yinThreshold: 0.1,
  },
};

function isAlgorithm(value: unknown): value is PracticeMicrophoneAlgorithm {
  return value === "mpm-c" || value === "swiftf0" || value === "yin";
}

function parseBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseDebugParameters(
  value: unknown,
  fallback: PracticeMicrophoneDebugParameters,
): PracticeMicrophoneDebugParameters {
  if (typeof value !== "object" || value === null) return fallback;
  const stored = value as Partial<PracticeMicrophoneDebugParameters>;
  return {
    analysisGain: PRACTICE_MICROPHONE_ANALYSIS_GAINS.includes(stored.analysisGain as PracticeMicrophoneAnalysisGain)
      ? stored.analysisGain as PracticeMicrophoneAnalysisGain
      : fallback.analysisGain,
    confidenceThreshold: parseBoundedNumber(stored.confidenceThreshold, fallback.confidenceThreshold, 0, 1),
    frameIntervalMs: stored.frameIntervalMs === "auto" ||
        PRACTICE_MICROPHONE_FRAME_INTERVALS.some((interval) => interval === stored.frameIntervalMs)
      ? stored.frameIntervalMs as PracticeMicrophoneFrameInterval
      : fallback.frameIntervalMs,
    inputRmsThreshold: parseBoundedNumber(stored.inputRmsThreshold, fallback.inputRmsThreshold, 0, 0.01),
    primaryClarityThreshold: parseBoundedNumber(
      stored.primaryClarityThreshold,
      fallback.primaryClarityThreshold,
      0,
      1,
    ),
    requiredStableFrames: PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS.includes(
      stored.requiredStableFrames as PracticeMicrophoneStableFrameCount,
    )
      ? stored.requiredStableFrames as PracticeMicrophoneStableFrameCount
      : fallback.requiredStableFrames,
    requiredStableMs: PRACTICE_MICROPHONE_STABLE_DURATIONS.includes(
      stored.requiredStableMs as PracticeMicrophoneStableDuration,
    )
      ? stored.requiredStableMs as PracticeMicrophoneStableDuration
      : fallback.requiredStableMs,
    yinThreshold: parseBoundedNumber(stored.yinThreshold, fallback.yinThreshold, 0.01, 1),
  };
}

export function parsePracticeMicrophonePreferences(
  value: unknown,
  fallback: PracticeMicrophonePreferences = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
): PracticeMicrophonePreferences {
  if (typeof value !== "object" || value === null) return fallback;
  const stored = value as Record<string, unknown>;
  const sensitivityLevel = PRACTICE_MICROPHONE_SENSITIVITY_LEVELS.includes(
    stored.sensitivityLevel as PracticeMicrophoneSensitivityLevel,
  )
    ? stored.sensitivityLevel as PracticeMicrophoneSensitivityLevel
    : fallback.sensitivityLevel;
  return {
    algorithm: isAlgorithm(stored.algorithm) ? stored.algorithm : fallback.algorithm,
    debugMode: stored.debugMode === true,
    debugParameters: parseDebugParameters(stored.debugParameters, fallback.debugParameters),
    sensitivityLevel,
  };
}

function resolveProfileThresholds(
  algorithm: PracticeMicrophoneAlgorithm,
  sensitivityLevel: PracticeMicrophoneSensitivityLevel,
): PracticeMicrophoneThresholds {
  const profile = SENSITIVITY_PROFILES[sensitivityLevel];
  const confidenceThreshold = profile.confidenceThresholds[algorithm];
  return {
    confidenceThreshold,
    inputRmsThreshold: profile.inputRmsThreshold,
    ...(algorithm === "mpm-c"
      ? { primaryClarityThreshold: Math.min(0.99, Math.round((confidenceThreshold + profile.primaryClarityOffset) * 100) / 100) }
      : {}),
    ...(algorithm === "yin" ? { yinThreshold: profile.yinThreshold } : {}),
  };
}

export function practiceMicrophoneDebugParametersForSensitivityLevel(
  algorithm: PracticeMicrophoneAlgorithm,
  sensitivityLevel: PracticeMicrophoneSensitivityLevel,
): PracticeMicrophoneDebugParameters {
  const profile = SENSITIVITY_PROFILES[sensitivityLevel];
  const thresholds = resolveProfileThresholds(algorithm, sensitivityLevel);
  return {
    analysisGain: profile.analysisGain,
    confidenceThreshold: thresholds.confidenceThreshold,
    frameIntervalMs: "auto",
    inputRmsThreshold: thresholds.inputRmsThreshold,
    primaryClarityThreshold: thresholds.primaryClarityThreshold ??
      Math.min(0.99, thresholds.confidenceThreshold + profile.primaryClarityOffset),
    requiredStableFrames: profile.requiredStableFrames,
    requiredStableMs: profile.requiredStableMs,
    yinThreshold: thresholds.yinThreshold ?? profile.yinThreshold,
  };
}

export function resolvePracticeMicrophoneConfiguration(
  preferences: PracticeMicrophonePreferences,
): PracticeMicrophoneConfiguration {
  const normalized = parsePracticeMicrophonePreferences(preferences);
  const profileParameters = practiceMicrophoneDebugParametersForSensitivityLevel(
    normalized.algorithm,
    normalized.sensitivityLevel,
  );
  const parameters = normalized.debugMode ? normalized.debugParameters : profileParameters;
  return {
    algorithm: normalized.algorithm,
    analysisGain: parameters.analysisGain,
    confidenceThreshold: parameters.confidenceThreshold,
    debugMode: normalized.debugMode,
    frameIntervalMs: parameters.frameIntervalMs,
    inputRmsThreshold: parameters.inputRmsThreshold,
    primaryClarityThreshold: parameters.primaryClarityThreshold,
    requiredStableFrames: parameters.requiredStableFrames,
    requiredStableMs: parameters.requiredStableMs,
    sensitivityLevel: normalized.sensitivityLevel,
    yinThreshold: parameters.yinThreshold,
  };
}

export function resolvePracticeMicrophoneFrameIntervalMs(
  preferences: Pick<PracticeMicrophoneConfiguration, "algorithm" | "frameIntervalMs">,
): number {
  if (preferences.frameIntervalMs !== "auto") return preferences.frameIntervalMs;
  return preferences.algorithm === "yin" ? 50 : 30;
}

export function resolvePracticeMicrophoneThresholds(
  configuration: PracticeMicrophoneConfiguration,
): PracticeMicrophoneThresholds {
  return {
    confidenceThreshold: configuration.confidenceThreshold,
    inputRmsThreshold: configuration.inputRmsThreshold,
    ...(configuration.algorithm === "mpm-c"
      ? { primaryClarityThreshold: configuration.primaryClarityThreshold }
      : {}),
    ...(configuration.algorithm === "yin" ? { yinThreshold: configuration.yinThreshold } : {}),
  };
}

export function practiceMicrophoneSensitivityLevelLabel(level: PracticeMicrophoneSensitivityLevel): string {
  const labels: Record<PracticeMicrophoneSensitivityLevel, string> = {
    1: "1级（敏感）",
    2: "2级（较敏感）",
    3: "3级（标准）",
    4: "4级（较不敏感）",
    5: "5级（不敏感）",
  };
  return labels[level];
}

export function practiceMicrophoneAlgorithmLabel(algorithm: PracticeMicrophoneAlgorithm): string {
  if (algorithm === "swiftf0") return "SwiftF0";
  if (algorithm === "yin") return "YIN";
  return "Pitchy（手机/平板不推荐）";
}
