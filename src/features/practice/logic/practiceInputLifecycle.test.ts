import { describe, expect, it, vi } from "vitest";
import {
  ensurePracticeMicrophoneForResume,
  releasePracticeMicrophoneOnPause,
} from "./practiceInputLifecycle";

describe("practice microphone lifecycle", () => {
  it("releases the microphone when a microphone practice is paused", () => {
    const stopMicrophone = vi.fn();

    releasePracticeMicrophoneOnPause("microphone", stopMicrophone);
    releasePracticeMicrophoneOnPause("note-name", stopMicrophone);

    expect(stopMicrophone).toHaveBeenCalledTimes(1);
  });

  it("reconnects before resuming microphone practice", async () => {
    const startMicrophone = vi.fn().mockResolvedValue(true);

    await expect(
      ensurePracticeMicrophoneForResume({
        answerPitchMode: "microphone",
        isListening: false,
        startMicrophone,
      }),
    ).resolves.toBe(true);

    expect(startMicrophone).toHaveBeenCalledOnce();
  });

  it("keeps practice paused when reconnecting fails", async () => {
    const startMicrophone = vi.fn().mockResolvedValue(false);

    await expect(
      ensurePracticeMicrophoneForResume({
        answerPitchMode: "microphone",
        isListening: false,
        startMicrophone,
      }),
    ).resolves.toBe(false);
  });

  it("does not request microphone access outside microphone mode or while already listening", async () => {
    const startMicrophone = vi.fn().mockResolvedValue(true);

    await expect(
      ensurePracticeMicrophoneForResume({
        answerPitchMode: "note-name",
        isListening: false,
        startMicrophone,
      }),
    ).resolves.toBe(true);
    await expect(
      ensurePracticeMicrophoneForResume({
        answerPitchMode: "microphone",
        isListening: true,
        startMicrophone,
      }),
    ).resolves.toBe(true);

    expect(startMicrophone).not.toHaveBeenCalled();
  });
});
