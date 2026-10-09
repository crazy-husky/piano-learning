import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  createDefaultPracticeMicrophonePreferences,
  isTouchPracticeDevice,
  normalizePracticeMicrophoneDebugParameters,
  parsePracticeMicrophonePreferences,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
  resolvePracticeMicrophoneConfiguration,
  resolvePracticeMicrophoneFrameIntervalMs,
  resolvePracticeMicrophoneThresholds,
  type PracticeMicrophonePreferences,
  withPracticeMicrophoneAlgorithm,
} from "./practiceMicrophonePreferences";

describe("practice microphone preferences", () => {
  it("defaults to the standard level and preserves the existing standard recognition behavior", () => {
    expect(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES).toEqual({
      algorithm: "mpm-c",
      debugMode: false,
      debugParameters: {
        analysisGain: 1,
        confidenceThreshold: 0.75,
        frameIntervalMs: "auto",
        inputRmsThreshold: 0.0018,
        primaryClarityThreshold: 0.8,
        requiredStableFrames: 4,
        requiredStableMs: 80,
        yinThreshold: 0.15,
      },
      sensitivityLevel: 3,
    });
    expect(resolvePracticeMicrophoneConfiguration(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES)).toMatchObject({
      analysisGain: 1,
      confidenceThreshold: 0.75,
      frameIntervalMs: "auto",
      inputRmsThreshold: 0.0018,
      primaryClarityThreshold: 0.8,
      requiredStableFrames: 4,
      requiredStableMs: 80,
      sensitivityLevel: 3,
    });
  });

  it("uses sensitive defaults for touch devices and standard defaults for desktop", () => {
    expect(isTouchPracticeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(isTouchPracticeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5)).toBe(true);
    expect(isTouchPracticeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0)).toBe(false);
    expect(createDefaultPracticeMicrophonePreferences(1)).toMatchObject({ debugMode: false, sensitivityLevel: 1 });
    expect(createDefaultPracticeMicrophonePreferences(3)).toMatchObject({ debugMode: false, sensitivityLevel: 3 });
  });

  it("clamps debug parameters before they become the displayed and effective preferences", () => {
    expect(normalizePracticeMicrophoneDebugParameters({
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES.debugParameters,
      confidenceThreshold: 1.2,
      inputRmsThreshold: -0.5,
      primaryClarityThreshold: 2,
      yinThreshold: 0,
    })).toMatchObject({
      confidenceThreshold: 1,
      inputRmsThreshold: 0,
      primaryClarityThreshold: 1,
      yinThreshold: 0.01,
    });
  });

  it("merges an asynchronously selected algorithm into the latest sensitivity and debug state", () => {
    const latestPreferences = {
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
      sensitivityLevel: 1 as const,
    };

    expect(withPracticeMicrophoneAlgorithm(latestPreferences, "swiftf0")).toMatchObject({
      algorithm: "swiftf0",
      debugMode: false,
      sensitivityLevel: 1,
      debugParameters: {
        analysisGain: 15,
        confidenceThreshold: 0.4,
        inputRmsThreshold: 0.0009,
      },
    });
    expect(withPracticeMicrophoneAlgorithm({ ...latestPreferences, debugMode: true }, "swiftf0"))
      .toMatchObject({ debugMode: true, sensitivityLevel: 1, debugParameters: latestPreferences.debugParameters });
  });

  it("maps each sensitivity level to progressively stricter thresholds and stability", () => {
    const configs = [1, 2, 3, 4, 5].map((sensitivityLevel) =>
      resolvePracticeMicrophoneConfiguration({
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
        sensitivityLevel: sensitivityLevel as 1 | 2 | 3 | 4 | 5,
      }),
    );

    expect(configs.map(({ confidenceThreshold }) => confidenceThreshold)).toEqual([0.6, 0.675, 0.75, 0.825, 0.9]);
    expect(configs.map(({ inputRmsThreshold }) => inputRmsThreshold)).toEqual([
      0.0009,
      0.00135,
      0.0018,
      0.0027,
      0.0036,
    ]);
    expect(configs.map(({ requiredStableFrames, requiredStableMs }) => [requiredStableFrames, requiredStableMs]))
      .toEqual([[2, 50], [2, 80], [4, 80], [4, 80], [4, 80]]);
    expect(configs.map(({ analysisGain }) => analysisGain)).toEqual([15, 8, 1, 1, 1]);
  });

  it("resolves model-specific confidence and YIN thresholds for every level", () => {
    const thresholdsFor = (
      algorithm: PracticeMicrophonePreferences["algorithm"],
      sensitivityLevel: PracticeMicrophonePreferences["sensitivityLevel"],
    ) => resolvePracticeMicrophoneThresholds(resolvePracticeMicrophoneConfiguration({
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
        algorithm,
        sensitivityLevel,
      }));

    expect(thresholdsFor("swiftf0", 1)).toEqual({ confidenceThreshold: 0.4, inputRmsThreshold: 0.0009 });
    expect(thresholdsFor("swiftf0", 3)).toEqual({ confidenceThreshold: 0.6, inputRmsThreshold: 0.0018 });
    expect(thresholdsFor("swiftf0", 5)).toEqual({ confidenceThreshold: 0.8, inputRmsThreshold: 0.0036 });
    expect(thresholdsFor("mpm-c", 1)).toEqual({
      confidenceThreshold: 0.6,
      inputRmsThreshold: 0.0009,
      primaryClarityThreshold: 0.65,
    });
    expect(thresholdsFor("mpm-c", 5)).toEqual({
      confidenceThreshold: 0.9,
      inputRmsThreshold: 0.0036,
      primaryClarityThreshold: 0.95,
    });
    expect(thresholdsFor("yin", 1)).toEqual({ confidenceThreshold: 0.6, inputRmsThreshold: 0.0009, yinThreshold: 0.25 });
    expect(thresholdsFor("yin", 3)).toEqual({ confidenceThreshold: 0.75, inputRmsThreshold: 0.0018, yinThreshold: 0.15 });
    expect(thresholdsFor("yin", 5)).toEqual({ confidenceThreshold: 0.9, inputRmsThreshold: 0.0036, yinThreshold: 0.1 });
  });

  it("uses debug parameters only while debug mode is enabled", () => {
    const preferences = {
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
      debugParameters: {
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES.debugParameters,
        analysisGain: 10 as const,
        confidenceThreshold: 0.33,
        frameIntervalMs: 20 as const,
        inputRmsThreshold: 0.0002,
        primaryClarityThreshold: 0.42,
        requiredStableFrames: 2 as const,
        requiredStableMs: 50 as const,
        yinThreshold: 0.3,
      },
    };

    expect(resolvePracticeMicrophoneConfiguration(preferences)).toMatchObject({
      analysisGain: 1,
      confidenceThreshold: 0.75,
      frameIntervalMs: "auto",
      inputRmsThreshold: 0.0018,
      requiredStableFrames: 4,
    });
    expect(resolvePracticeMicrophoneConfiguration({ ...preferences, debugMode: true })).toMatchObject({
      analysisGain: 10,
      confidenceThreshold: 0.33,
      frameIntervalMs: 20,
      inputRmsThreshold: 0.0002,
      primaryClarityThreshold: 0.42,
      requiredStableFrames: 2,
      requiredStableMs: 50,
      yinThreshold: 0.3,
    });
  });

  it("normalizes invalid values in the current preference shape", () => {
    expect(parsePracticeMicrophonePreferences({
      algorithm: "unknown",
      debugMode: true,
      debugParameters: {
        analysisGain: 20,
        confidenceThreshold: 1.5,
        frameIntervalMs: 25,
        inputRmsThreshold: -1,
        requiredStableFrames: 5,
        requiredStableMs: 60,
        yinThreshold: 2,
      },
      sensitivityLevel: 9,
    })).toMatchObject({
      algorithm: "mpm-c",
      debugMode: true,
      sensitivityLevel: 3,
      debugParameters: {
        analysisGain: 1,
        confidenceThreshold: 1,
        frameIntervalMs: "auto",
        inputRmsThreshold: 0,
        requiredStableFrames: 4,
        requiredStableMs: 80,
        yinThreshold: 1,
      },
    });
  });

  it("resolves analysis intervals and user-facing labels", () => {
    const base = DEFAULT_PRACTICE_MICROPHONE_PREFERENCES;
    expect(resolvePracticeMicrophoneFrameIntervalMs({ algorithm: "yin", frameIntervalMs: "auto" })).toBe(50);
    expect(resolvePracticeMicrophoneFrameIntervalMs({ algorithm: "mpm-c", frameIntervalMs: "auto" })).toBe(30);
    expect(resolvePracticeMicrophoneFrameIntervalMs({ algorithm: "swiftf0", frameIntervalMs: 20 })).toBe(20);
    expect(practiceMicrophoneSensitivityLevelLabel(1)).toBe("1级（敏感）");
    expect(practiceMicrophoneSensitivityLevelLabel(5)).toBe("5级（不敏感）");
    expect(practiceMicrophoneAlgorithmLabel("mpm-c")).toBe("Pitchy（手机/平板不推荐）");
    expect(practiceMicrophoneAlgorithmLabel("swiftf0")).toBe("SwiftF0");
    expect(practiceMicrophoneAlgorithmLabel("yin")).toBe("YIN");
    expect(base.sensitivityLevel).toBe(3);
  });
});
