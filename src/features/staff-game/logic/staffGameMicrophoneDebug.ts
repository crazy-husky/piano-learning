export interface StaffGameMicrophoneDebugEvent {
  at: string;
  data: Record<string, unknown>;
  kind: "answer" | "observation";
}

export interface StaffGameMicrophoneDebugState {
  events: StaffGameMicrophoneDebugEvent[];
  format: "piano-learning-staff-game-microphone-debug";
  startedAt: string;
}

type DebugWindow = Window & {
  __staffGameMicrophoneDebug?: StaffGameMicrophoneDebugState;
};

function getDebugWindow(): DebugWindow | null {
  return typeof window === "undefined" ? null : (window as DebugWindow);
}

export function resetStaffGameMicrophoneDebug(): StaffGameMicrophoneDebugState | null {
  const debugWindow = getDebugWindow();
  if (!debugWindow) return null;
  const state: StaffGameMicrophoneDebugState = {
    events: [],
    format: "piano-learning-staff-game-microphone-debug",
    startedAt: new Date().toISOString(),
  };
  debugWindow.__staffGameMicrophoneDebug = state;
  return state;
}

export function appendStaffGameMicrophoneDebugEvent(
  kind: StaffGameMicrophoneDebugEvent["kind"],
  data: Record<string, unknown>
): void {
  const debugWindow = getDebugWindow();
  if (!debugWindow) return;
  const state = debugWindow.__staffGameMicrophoneDebug ?? resetStaffGameMicrophoneDebug();
  if (!state) return;
  state.events.push({ at: new Date().toISOString(), data, kind });
}
