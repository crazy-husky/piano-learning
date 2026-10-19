import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRACTICE_MICROPHONE_PREFERENCES } from "../../vocal-pitch/logic/practiceMicrophonePreferences";
import { staffGamePromptSuppressedMidiNotes } from "../logic/staffGamePromptPitchSuppression";
import { StaffGameRoute } from "./StaffGameRoute";

const mocks = vi.hoisted(() => ({
  useMicrophone: vi.fn(),
  lastViewProps: null as Record<string, unknown> | null,
}));

vi.mock("../../vocal-pitch/logic/usePracticeMicrophoneInput", () => ({
  usePracticeMicrophoneInput: mocks.useMicrophone,
}));

vi.mock("./StaffGameView", () => ({
  StaffGameView: (props: Record<string, unknown>) => {
    mocks.lastViewProps = props;
    return null;
  },
}));

function renderRouteWithActiveAlgorithm(activeAlgorithm: "swiftf0" | "yin"): string {
  mocks.useMicrophone.mockReturnValue({
    activeAlgorithm,
    stop: vi.fn(),
  });

  return renderToStaticMarkup(
    <StaffGameRoute
      initialMode="levels"
      initialSongSelectionStep="list"
      isSongPlayRoute={false}
      microphonePreferences={DEFAULT_PRACTICE_MICROPHONE_PREFERENCES}
      midi={{} as never}
      onExit={() => undefined}
      onModeChange={() => undefined}
      onRunningChange={() => undefined}
      onSongSelectionExit={() => undefined}
      onSongStart={() => undefined}
    />
  );
}

describe("StaffGameRoute microphone algorithm forwarding", () => {
  beforeEach(() => {
    mocks.lastViewProps = null;
    mocks.useMicrophone.mockReset();
  });

  it("uses the active YIN fallback for prompt suppression when preferences still select SwiftF0", () => {
    renderRouteWithActiveAlgorithm("yin");

    expect(DEFAULT_PRACTICE_MICROPHONE_PREFERENCES.algorithm).toBe("swiftf0");
    expect(mocks.lastViewProps?.microphoneAlgorithm).toBe("yin");
    const activeAlgorithm = mocks.lastViewProps?.microphoneAlgorithm as "swiftf0" | "yin";
    expect(staffGamePromptSuppressedMidiNotes("comboAmazing", activeAlgorithm)).toEqual([74]);
    expect(staffGamePromptSuppressedMidiNotes("comboExcellent", activeAlgorithm)).toEqual([]);
    expect(staffGamePromptSuppressedMidiNotes("comboUnbelievable", activeAlgorithm)).toEqual([75]);
  });

  it("keeps the SwiftF0-specific prompt suppression pitches when SwiftF0 is active", () => {
    renderRouteWithActiveAlgorithm("swiftf0");

    expect(mocks.lastViewProps?.microphoneAlgorithm).toBe("swiftf0");
    const activeAlgorithm = mocks.lastViewProps?.microphoneAlgorithm as "swiftf0" | "yin";
    expect(staffGamePromptSuppressedMidiNotes("comboAmazing", activeAlgorithm)).toEqual([
      57, 74, 75,
    ]);
    expect(staffGamePromptSuppressedMidiNotes("comboExcellent", activeAlgorithm)).toEqual([]);
    expect(staffGamePromptSuppressedMidiNotes("comboUnbelievable", activeAlgorithm)).toEqual([
      75, 77,
    ]);
  });
});
