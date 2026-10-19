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
  it("defaults to the standard SwiftF0 sensitivity profile", () => {
    expect(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES).toMatchObject({
      algorithm: "swiftf0",
      debugMode: false,
      sensitivityLevel: 3,
      sensitivityScaleVersion: 3,
      debugParameters: {
        analysisGain: 1,
        confidenceThreshold: 0.6,
        frameIntervalMs: 40,
        inputRmsThreshold: 0.0009,
        requiredStableFrames: 3,
        requiredStableMs: 65,
        yinThreshold: 0.15,
      },
    });
    expect(
      resolvePracticeMicrophoneConfiguration(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES)
    ).toMatchObject({
      algorithm: "swiftf0",
      analysisGain: 1,
      confidenceThreshold: 0.6,
      frameIntervalMs: 40,
      inputRmsThreshold: 0.0009,
      requiredStableFrames: 3,
      requiredStableMs: 65,
    });
  });

  it("maps five algorithm sensitivity levels to the scanned SwiftF0 profiles", () => {
    const profiles = [1, 2, 3, 4, 5].map((sensitivityLevel) =>
      resolvePracticeMicrophoneConfiguration(
        {
          ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
          sensitivityLevel: sensitivityLevel as 1 | 2 | 3 | 4 | 5,
        },
        "other"
      )
    );

    expect(
      profiles.map(
        ({
          analysisGain,
          confidenceThreshold,
          frameIntervalMs,
          inputRmsThreshold,
          requiredStableFrames,
          requiredStableMs,
        }) => [
          analysisGain,
          confidenceThreshold,
          frameIntervalMs,
          inputRmsThreshold,
          requiredStableFrames,
          requiredStableMs,
        ]
      )
    ).toEqual([
      [1, 0.7, 50, 0.0036, 4, 80],
      [1, 0.7, 40, 0.0018, 3, 80],
      [1, 0.6, 40, 0.0009, 3, 65],
      [1, 0.5, 30, 0.0009, 2, 65],
      [1, 0.4, 20, 0.0009, 2, 50],
    ]);

    expect(
      [1, 2, 3, 4, 5].map(
        (sensitivityLevel) =>
          resolvePracticeMicrophoneConfiguration(
            {
              ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
              sensitivityLevel: sensitivityLevel as 1 | 2 | 3 | 4 | 5,
            },
            "ios"
          ).analysisGain
      )
    ).toEqual([15, 15, 15, 15, 15]);
    expect(
      [1, 2, 3, 4, 5].map(
        (sensitivityLevel) =>
          resolvePracticeMicrophoneConfiguration(
            {
              ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
              sensitivityLevel: sensitivityLevel as 1 | 2 | 3 | 4 | 5,
            },
            "mac"
          ).analysisGain
      )
    ).toEqual([1, 1, 1, 2, 3]);
    expect(
      resolvePracticeMicrophoneConfiguration(
        {
          ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
          sensitivityLevel: 5,
        },
        "mac"
      ).frameIntervalMs
    ).toBe(50);
  });

  it("keeps SwiftF0 locked in system preferences while allowing YIN only in debug settings", () => {
    const stored = {
      ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
      algorithm: "yin",
      debugMode: true,
      sensitivityLevel: 5,
    };
    expect(parseSystemPracticeMicrophonePreferences(stored)).toMatchObject({
      algorithm: "swiftf0",
      debugMode: false,
      sensitivityLevel: 5,
    });
    expect(parsePracticeMicrophonePreferences(stored)).toMatchObject({
      algorithm: "yin",
      debugMode: true,
      sensitivityLevel: 5,
    });
  });

  it("migrates existing sensitivity settings to the five-level scale", () => {
    const migrate = (sensitivityLevel: number) =>
      parsePracticeMicrophonePreferences({ algorithm: "swiftf0", sensitivityLevel });

    expect([1, 2, 3, 4, 5].map((value) => migrate(value).sensitivityLevel)).toEqual([
      5, 3, 3, 1, 1,
    ]);
    expect(
      parsePracticeMicrophonePreferences({ sensitivityScaleVersion: 2, sensitivityLevel: 3 })
        .sensitivityLevel
    ).toBe(5);
    expect(
      parsePracticeMicrophonePreferences({ sensitivityScaleVersion: 3, sensitivityLevel: 4 })
        .sensitivityLevel
    ).toBe(4);
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
    const primary = resolvePracticeMicrophoneConfiguration(
      {
        ...DEFAULT_PRACTICE_MICROPHONE_PREFERENCES,
        sensitivityLevel: 5,
      },
      "ios"
    );
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

  it("supports device detection and labels the five algorithm sensitivity levels", () => {
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
    ).toBe(4);
    expect(
      defaultPracticeMicrophoneSensitivityForDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        "MacIntel",
        0
      )
    ).toBe(3);
    expect(createDefaultPracticeMicrophonePreferences(1).sensitivityLevel).toBe(1);
    expect(practiceMicrophoneSensitivityLevelLabel(1)).toBe("1 档 · 抗噪");
    expect(practiceMicrophoneSensitivityLevelLabel(5)).toBe("5 档 · 高灵敏");
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
