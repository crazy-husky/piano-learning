import { afterEach, describe, expect, it, vi } from "vitest";
import { getMidiPracticeStartWarning } from "./midiPracticeWarning";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MIDI practice start warning", () => {
  const disconnectedMidi = {
    inputs: [],
    isConnected: false,
    status: "unsupported" as const,
  };

  it("shows the MIDIWeb guidance on iPhone and offers another practice input", () => {
    vi.stubGlobal("navigator", {
      maxTouchPoints: 5,
      platform: "iPhone",
      userAgent: "iPhone",
    });

    const warning = getMidiPracticeStartWarning(disconnectedMidi);

    expect(warning).toContain("iOS 设备需要 MIDIWeb");
    expect(warning).toContain("App Store");
    expect(warning).toContain("切换到其他作答方式");
  });

  it("recognizes touch-enabled iPadOS devices reported as MacIntel", () => {
    vi.stubGlobal("navigator", {
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    });

    expect(getMidiPracticeStartWarning(disconnectedMidi, "midi-required")).toContain(
      "iOS 设备需要 MIDIWeb"
    );
    expect(getMidiPracticeStartWarning(disconnectedMidi, "midi-required")).not.toContain(
      "切换到其他作答方式"
    );
  });

  it("uses general browser guidance on desktop and describes a pending connection", () => {
    vi.stubGlobal("navigator", {
      maxTouchPoints: 0,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    });

    expect(getMidiPracticeStartWarning(disconnectedMidi)).toContain("当前浏览器不支持 MIDI");
    expect(getMidiPracticeStartWarning({ ...disconnectedMidi, status: "requesting" })).toBe(
      "MIDI 正在连接，请稍候。"
    );
  });
});
