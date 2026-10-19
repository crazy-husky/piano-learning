export type PracticeMicrophoneAlgorithm = "swiftf0" | "yin";
export const PRACTICE_MICROPHONE_SENSITIVITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type PracticeMicrophoneSensitivityLevel =
  (typeof PRACTICE_MICROPHONE_SENSITIVITY_LEVELS)[number];
export const PRACTICE_MICROPHONE_FRAME_INTERVALS = [20, 30, 40, 50] as const;
export type PracticeMicrophoneFrameInterval =
  (typeof PRACTICE_MICROPHONE_FRAME_INTERVALS)[number] | "auto";
export const PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS = [2, 3, 4] as const;
export type PracticeMicrophoneStableFrameCount =
  (typeof PRACTICE_MICROPHONE_STABLE_FRAME_COUNTS)[number];
export const PRACTICE_MICROPHONE_STABLE_DURATIONS = [50, 65, 80] as const;
export type PracticeMicrophoneStableDuration =
  (typeof PRACTICE_MICROPHONE_STABLE_DURATIONS)[number];
export const PRACTICE_MICROPHONE_ANALYSIS_GAINS = [1, 2, 3, 4, 8, 10, 15, 20] as const;
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
  sensitivityScaleVersion: 3;
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

export type PracticeMicrophoneDeviceClass = "ios" | "mac" | "other";

export const PRACTICE_MICROPHONE_PREFERENCES_KEY = "anki-note.practiceMicrophonePreferences";

const DEFAULT_DEBUG_PARAMETERS: PracticeMicrophoneDebugParameters = {
  analysisGain: 1,
  confidenceThreshold: 0.6,
  frameIntervalMs: 40,
  inputRmsThreshold: 0.0009,
  requiredStableFrames: 3,
  requiredStableMs: 65,
  yinThreshold: 0.15,
};

export const DEFAULT_PRACTICE_MICROPHONE_PREFERENCES: PracticeMicrophonePreferences = {
  algorithm: "swiftf0",
  debugMode: false,
  debugParameters: DEFAULT_DEBUG_PARAMETERS,
  sensitivityScaleVersion: 3,
  sensitivityLevel: 3,
};

export function createDefaultPracticeMicrophonePreferences(
  sensitivityLevel: PracticeMicrophoneSensitivityLevel = 3
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

function practiceMicrophoneDeviceClass(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): PracticeMicrophoneDeviceClass {
  if (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    /^(iPhone|iPad|iPod)/i.test(platform) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Macintosh|Mac OS X/i.test(userAgent) || /^Mac/i.test(platform)) return "mac";
  return "other";
}

function currentPracticeMicrophoneDeviceClass(): PracticeMicrophoneDeviceClass {
  if (typeof navigator === "undefined") return "other";
  return practiceMicrophoneDeviceClass(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints
  );
}

export function defaultPracticeMicrophoneSensitivityForDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): PracticeMicrophoneSensitivityLevel {
  return practiceMicrophoneDeviceClass(userAgent, platform, maxTouchPoints) === "ios" ? 4 : 3;
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
  confidenceThreshold: number;
  frameIntervalMs: PracticeMicrophoneFrameInterval;
  inputRmsThreshold: number;
  requiredStableFrames: PracticeMicrophoneStableFrameCount;
  requiredStableMs: PracticeMicrophoneStableDuration;
}

const SENSITIVITY_PROFILES: Record<PracticeMicrophoneSensitivityLevel, SensitivityProfile> = {
  1: {
    confidenceThreshold: 0.7,
    frameIntervalMs: 50,
    inputRmsThreshold: 0.0036,
    requiredStableFrames: 4,
    requiredStableMs: 80,
  },
  2: {
    confidenceThreshold: 0.7,
    frameIntervalMs: 40,
    inputRmsThreshold: 0.0018,
    requiredStableFrames: 3,
    requiredStableMs: 80,
  },
  3: {
    confidenceThreshold: 0.6,
    frameIntervalMs: 40,
    inputRmsThreshold: 0.0009,
    requiredStableFrames: 3,
    requiredStableMs: 65,
  },
  4: {
    confidenceThreshold: 0.5,
    frameIntervalMs: 30,
    inputRmsThreshold: 0.0009,
    requiredStableFrames: 2,
    requiredStableMs: 65,
  },
  5: {
    confidenceThreshold: 0.4,
    frameIntervalMs: 20,
    inputRmsThreshold: 0.0009,
    requiredStableFrames: 2,
    requiredStableMs: 50,
  },
};

function analysisGainForSensitivity(
  sensitivityLevel: PracticeMicrophoneSensitivityLevel,
  deviceClass: PracticeMicrophoneDeviceClass
): PracticeMicrophoneAnalysisGain {
  if (deviceClass === "ios") return 15;
  if (deviceClass === "mac") {
    if (sensitivityLevel === 5) return 3;
    if (sensitivityLevel === 4) return 2;
  }
  return 1;
}

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
  const storedSensitivity = stored.sensitivityLevel;
  const sensitivityLevel =
    stored.sensitivityScaleVersion === 3 &&
    PRACTICE_MICROPHONE_SENSITIVITY_LEVELS.includes(
      storedSensitivity as PracticeMicrophoneSensitivityLevel
    )
      ? (storedSensitivity as PracticeMicrophoneSensitivityLevel)
      : stored.sensitivityScaleVersion === 2 &&
          typeof storedSensitivity === "number" &&
          [1, 2, 3].includes(storedSensitivity)
        ? storedSensitivity === 1
          ? 1
          : storedSensitivity === 2
            ? 3
            : 5
        : typeof storedSensitivity === "number"
          ? storedSensitivity <= 1
            ? 5
            : storedSensitivity === 2
              ? 3
              : storedSensitivity === 3
                ? 3
                : 1
          : fallback.sensitivityLevel;
  return {
    algorithm: isAlgorithm(stored.algorithm) ? stored.algorithm : fallback.algorithm,
    debugMode: stored.debugMode === true,
    debugParameters: parseDebugParameters(stored.debugParameters, fallback.debugParameters),
    sensitivityScaleVersion: 3,
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
    confidenceThreshold: algorithm === "swiftf0" ? profile.confidenceThreshold : 0.9,
    inputRmsThreshold: profile.inputRmsThreshold,
    ...(algorithm === "yin" ? { yinThreshold: 0.15 } : {}),
  };
}

export function practiceMicrophoneDebugParametersForSensitivityLevel(
  algorithm: PracticeMicrophoneAlgorithm,
  sensitivityLevel: PracticeMicrophoneSensitivityLevel,
  deviceClass: PracticeMicrophoneDeviceClass = currentPracticeMicrophoneDeviceClass()
): PracticeMicrophoneDebugParameters {
  const profile = SENSITIVITY_PROFILES[sensitivityLevel];
  const thresholds = resolveProfileThresholds(algorithm, sensitivityLevel);
  const isSwiftF0 = algorithm === "swiftf0";
  return {
    analysisGain: analysisGainForSensitivity(sensitivityLevel, deviceClass),
    confidenceThreshold: thresholds.confidenceThreshold,
    frameIntervalMs:
      isSwiftF0 && deviceClass === "mac" && sensitivityLevel === 5
        ? 50
        : isSwiftF0
          ? profile.frameIntervalMs
          : 30,
    inputRmsThreshold: thresholds.inputRmsThreshold,
    requiredStableFrames: isSwiftF0 ? profile.requiredStableFrames : 4,
    requiredStableMs: isSwiftF0 ? profile.requiredStableMs : 80,
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
  preferences: PracticeMicrophonePreferences,
  deviceClass: PracticeMicrophoneDeviceClass = currentPracticeMicrophoneDeviceClass()
): PracticeMicrophoneConfiguration {
  const normalized = parsePracticeMicrophonePreferences(preferences);
  const profileParameters = practiceMicrophoneDebugParametersForSensitivityLevel(
    normalized.algorithm,
    normalized.sensitivityLevel,
    deviceClass
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
    1: "1 档 · 抗噪",
    2: "2 档 · 偏保守",
    3: "3 档 · 标准",
    4: "4 档 · 偏灵敏",
    5: "5 档 · 高灵敏",
  };
  return labels[level];
}

export function practiceMicrophoneAlgorithmLabel(algorithm: PracticeMicrophoneAlgorithm): string {
  if (algorithm === "swiftf0") return "SwiftF0";
  return "YIN";
}
