import type { StaffGameProficiencySample } from "../../../domain/types";
import type {
  PracticeMicrophoneAlgorithm,
  PracticeMicrophoneDebugParameters,
} from "../../vocal-pitch/logic/practiceMicrophonePreferences";

export function estimateStaffGameSystemDelayMs(
  inputMode: StaffGameProficiencySample["inputMode"],
  parameters: PracticeMicrophoneDebugParameters,
  algorithm: PracticeMicrophoneAlgorithm = "swiftf0"
): number {
  if (inputMode !== "microphone") return 0;
  const frameIntervalMs =
    parameters.frameIntervalMs === "auto"
      ? algorithm === "yin"
        ? 30
        : 40
      : parameters.frameIntervalMs;
  return frameIntervalMs * parameters.requiredStableFrames + parameters.requiredStableMs;
}

export function correctedStaffGameResponseTimeMs(
  rawResponseTimeMs: number | null,
  estimatedSystemDelayMs: number
): number | null {
  if (rawResponseTimeMs === null || !Number.isFinite(rawResponseTimeMs)) return null;
  return Math.max(0, rawResponseTimeMs - estimatedSystemDelayMs);
}

export interface StaffGameProficiencyNoteStats {
  appearanceCount: number;
  errorCount: number;
  meanResponseTimeMs: number | null;
  midi: number;
  note: string;
  status: "insufficient" | "errors" | "slow" | "proficient" | "developing";
}

export function aggregateStaffGameProficiencySamples(
  samples: readonly StaffGameProficiencySample[],
  inputMode: StaffGameProficiencySample["inputMode"],
  sensitivityLevel: StaffGameProficiencySample["sensitivityLevel"],
  microphoneAlgorithm?: PracticeMicrophoneAlgorithm
): StaffGameProficiencyNoteStats[] {
  const byMidi = new Map<number, StaffGameProficiencySample[]>();
  for (const sample of samples) {
    if (sample.inputMode !== inputMode || sample.sensitivityLevel !== sensitivityLevel) continue;
    if (
      inputMode === "microphone" &&
      microphoneAlgorithm &&
      sample.microphoneAlgorithm !== microphoneAlgorithm
    ) {
      continue;
    }
    const group = byMidi.get(sample.midi) ?? [];
    group.push(sample);
    byMidi.set(sample.midi, group);
  }
  return [...byMidi.entries()].map(([midi, rows]) => {
    const errorCount = rows.filter((row) => row.firstInputCorrect === false || row.missed).length;
    const responseRows = rows.filter(
      (row) => row.playerResponseTimeMs !== null && Number.isFinite(row.playerResponseTimeMs)
    );
    const meanResponseTimeMs = responseRows.length
      ? responseRows.reduce((sum, row) => sum + row.playerResponseTimeMs!, 0) / responseRows.length
      : null;
    const status: StaffGameProficiencyNoteStats["status"] =
      errorCount > 0
        ? "errors"
        : rows.length < 3
          ? "insufficient"
          : meanResponseTimeMs !== null && meanResponseTimeMs > 1500
            ? "slow"
            : meanResponseTimeMs !== null && meanResponseTimeMs < 1000
              ? "proficient"
              : "developing";
    return {
      appearanceCount: rows.length,
      errorCount,
      meanResponseTimeMs,
      midi,
      note: rows[0]?.note ?? String(midi),
      status,
    };
  });
}

export function shouldShowFastPlayingHint(
  samples: readonly Pick<
    StaffGameProficiencySample,
    "playerResponseTimeMs" | "firstInputCorrect" | "missed"
  >[]
): boolean {
  if (samples.length < 5) return false;
  const responses = samples
    .map((sample) => sample.playerResponseTimeMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const errors = samples.filter(
    (sample) => sample.firstInputCorrect === false || sample.missed
  ).length;
  const meanResponseMs = responses.length
    ? responses.reduce((sum, response) => sum + response, 0) / responses.length
    : Number.POSITIVE_INFINITY;
  let currentFastRun = 0;
  let longestFastRun = 0;
  for (const sample of samples) {
    if (sample.playerResponseTimeMs !== null && sample.playerResponseTimeMs <= 300) {
      currentFastRun += 1;
      longestFastRun = Math.max(longestFastRun, currentFastRun);
    } else {
      currentFastRun = 0;
    }
  }
  return (
    longestFastRun >= 3 && meanResponseMs <= 350 && errors >= 2 && errors / samples.length >= 0.3
  );
}
