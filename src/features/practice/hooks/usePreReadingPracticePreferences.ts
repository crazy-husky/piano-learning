import type { PreReadingBufferSize } from "../../../domain/types";
import { useLocalStorageState } from "../../../shared/hooks/useLocalStorageState";

const PRE_READING_BUFFER_SIZE_KEY = "anki-note.preReadingBufferSize.v1";
const PRE_READING_METRONOME_SYNC_KEY = "anki-note.preReadingMetronomeSyncEnabled.v1";

function parseBufferSize(value: unknown): PreReadingBufferSize {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? (value as PreReadingBufferSize)
    : 1;
}

function parseBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export function usePreReadingPracticePreferences() {
  const [bufferSize, setBufferSize] = useLocalStorageState<PreReadingBufferSize>(
    PRE_READING_BUFFER_SIZE_KEY,
    1,
    { parse: parseBufferSize }
  );
  const [metronomeSyncEnabled, setMetronomeSyncEnabled] = useLocalStorageState(
    PRE_READING_METRONOME_SYNC_KEY,
    false,
    { parse: parseBoolean }
  );

  return {
    bufferSize,
    metronomeSyncEnabled,
    setBufferSize,
    setMetronomeSyncEnabled,
  };
}
