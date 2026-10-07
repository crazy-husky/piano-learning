import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../domain/vocalPitch";
import { describePracticeMicrophoneObservation } from "./practiceMicrophoneDiagnostics";
import type { PracticeMicrophoneThresholds } from "./practiceMicrophonePreferences";

const thresholds: PracticeMicrophoneThresholds = {
  confidenceThreshold: 0.75,
  inputRmsThreshold: 0.0018,
};

describe("practice microphone diagnostics", () => {
  it("explains when the algorithm returns no frequency candidate", () => {
    expect(describePracticeMicrophoneObservation(0, null, 0.01, false, thresholds))
      .toBe("算法没有给出音高候选");

    expect(describePracticeMicrophoneObservation(0, null, 0.00003, false, thresholds))
      .toBe("输入电平低于灵敏度门槛");
  });

  it("identifies common gates before a note is accepted", () => {
    const a4 = midiToFrequency(69);

    expect(describePracticeMicrophoneObservation(0.9, a4, 0.001, false, thresholds))
      .toBe("输入电平低于灵敏度门槛");
    expect(describePracticeMicrophoneObservation(0.6, a4, 0.01, false, thresholds))
      .toBe("候选置信度低于门槛");
    expect(describePracticeMicrophoneObservation(0.9, a4, 0.01, true, thresholds))
      .toBe("两个音高候选存在冲突");
    expect(describePracticeMicrophoneObservation(0.9, a4, 0.01, false, thresholds))
      .toBe("候选有效，等待稳定判定");
  });
});
