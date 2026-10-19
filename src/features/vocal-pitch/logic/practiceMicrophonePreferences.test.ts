import { describe, expect, it } from "vitest";
import {
  createDefaultPracticeMicrophonePreferences,
  createYinFallbackConfiguration,
  defaultPracticeMicrophoneSensitivityForDevice,
  DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
  isTouchPracticeDevice,
  normalizePracticeMicrophoneDebugParameters,
  parsePracticeMicrophonePreferences,
  parseSystemPracticeMicrophonePreferences,
  practiceMicrophoneAlgorithmLabel,
  practiceMicrophoneSensitivityLevelLabel,
  resolvePracticeMicrophoneConfiguration,
  resolvePracticeMicrophoneFrameIntervalMs,
  resolvePracticeMicrophoneThresholds,
} from "./practiceMicrophonePreferences";

describe("practice microphone preferences", () => {
  it("defaults to SwiftF0 with 40 ms, 0.7 confidence and three stable frames", () => {
    expect(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES).toMatchObject({
      algorithm: "swiftf0",
      debugMode: false,
      sensitivityLevel: 2,
      sensitivityScaleVersion: 2,
      debugParameters: {
        analysisGain: 8,
        confidenceThreshold: 0.7,
        frameIntervalMs: 40,
        inputRmsThreshold: 0.0018,
        requiredStableFrames: 3,
        requiredStableMs: 80,
        yinThreshold: 0.15,
      },
    });
    expect(
      resolvePracticeMicrophoneConfiguration(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES)
    ).toMatchObject({
      algorithm: "swiftf0",
      analysisGain: 8,
      confidenceThreshold: 0.7,
      frameIntervalMs: 40,
      inputRmsThreshold: 0.0018,
      requiredStableFrames: 3,
    });
  });

  it("uses three sensitivity levels only for gain and the RMS floor", () => {
    const profiles = [1, 2, 3].map((sensitivityLevel) =>
      resolvePracticeMicrophoneConfiguration({
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
        sensitivityLevel: sensitivityLevel as 1 | 2 | 3,
      })
    );

    expect(
      profiles.map(({ analysisGain, inputRmsThreshold }) => [analysisGain, inputRmsThreshold])
    ).toEqual([
      [1, 0.0036],
      [8, 0.0018],
      [15, 0.0009],
    ]);
    expect(
      profiles.map(({ confidenceThreshold, frameIntervalMs, requiredStableFrames }) => [
        confidenceThreshold,
        frameIntervalMs,
        requiredStableFrames,
      ])
    ).toEqual([
      [0.7, 40, 3],
      [0.7, 40, 3],
      [0.7, 40, 3],
    ]);
  });

  it("keeps SwiftF0 locked in system preferences while allowing YIN only in debug settings", () => {
    const stored = {
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
      algorithm: "yin",
      debugMode: true,
      sensitivityLevel: 3,
    };
    expect(parseSystemPracticeMicrophonePreferences(stored)).toMatchObject({
      algorithm: "swiftf0",
      debugMode: false,
      sensitivityLevel: 3,
    });
    expect(parsePracticeMicrophonePreferences(stored)).toMatchObject({
      algorithm: "yin",
      debugMode: true,
      sensitivityLevel: 3,
    });
  });

  it("migrates the old five-level scale to the new three-level scale", () => {
    const migrate = (sensitivityLevel: number) =>
      parsePracticeMicrophonePreferences({ algorithm: "swiftf0", sensitivityLevel });

    expect([1, 2, 3, 4, 5].map((value) => migrate(value).sensitivityLevel)).toEqual([
      3, 2, 2, 1, 1,
    ]);
    expect(
      parsePracticeMicrophonePreferences({ sensitivityScaleVersion: 2, sensitivityLevel: 3 })
        .sensitivityLevel
    ).toBe(3);
  });

  it("normalizes debug parameters and preserves old algorithm preferences safely", () => {
    expect(
      normalizePracticeMicrophoneDebugParameters({
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES.debugParameters,
        confidenceThreshold: 1.2,
        inputRmsThreshold: -0.5,
        yinThreshold: 0,
      })
    ).toMatchObject({ confidenceThreshold: 1, inputRmsThreshold: 0, yinThreshold: 0.01 });
    expect(parsePracticeMicrophonePreferences({ algorithm: "mpm-c" }).algorithm).toBe("swiftf0");
  });

  it("uses the fixed YIN fallback profile without changing user input gain or RMS sensitivity", () => {
    const primary = resolvePracticeMicrophoneConfiguration({
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
      sensitivityLevel: 3,
    });
    const fallback = createYinFallbackConfiguration(primary);

    expect(fallback).toMatchObject({
      algorithm: "yin",
      analysisGain: 15,
      confidenceThreshold: 0.9,
      frameIntervalMs: 30,
      inputRmsThreshold: 0.0009,
      requiredStableFrames: 4,
      requiredStableMs: 80,
      yinThreshold: 0.15,
    });
    expect(resolvePracticeMicrophoneThresholds(fallback)).toEqual({
      confidenceThreshold: 0.9,
      inputRmsThreshold: 0.0009,
      yinThreshold: 0.15,
    });
  });

  it("supports device detection and labels the three user sensitivity levels", () => {
    expect(isTouchPracticeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5)).toBe(
      true
    );
    expect(isTouchPracticeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5)).toBe(
      true
    );
    expect(isTouchPracticeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0)).toBe(
      false
    );
    expect(
      defaultPracticeMicrophoneSensitivityForDevice(
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
        "iPad",
        5
      )
    ).toBe(3);
    expect(
      defaultPracticeMicrophoneSensitivityForDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        "MacIntel",
        0
      )
    ).toBe(2);
    expect(createDefaultPracticeMicrophonePreferences(1).sensitivityLevel).toBe(1);
    expect(practiceMicrophoneSensitivityLevelLabel(1)).toBe("低敏感 · 抗噪");
    expect(practiceMicrophoneSensitivityLevelLabel(3)).toBe("高敏感 · 弱麦克风");
    expect(practiceMicrophoneAlgorithmLabel("swiftf0")).toBe("SwiftF0");
    expect(practiceMicrophoneAlgorithmLabel("yin")).toBe("YIN");
  });

  it("resolves auto intervals for the primary and fallback algorithms", () => {
    expect(
      resolvePracticeMicrophoneFrameIntervalMs({ algorithm: "swiftf0", frameIntervalMs: "auto" })
    ).toBe(40);
    expect(
      resolvePracticeMicrophoneFrameIntervalMs({ algorithm: "yin", frameIntervalMs: "auto" })
    ).toBe(30);
  });
});
