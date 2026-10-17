export type StaffGameInputMode = "physical" | "virtual" | "midi";

export function resolveStaffGameInputMode(
  savedMode: unknown,
  availability: { midiAvailable: boolean; virtualAvailable: boolean }
): StaffGameInputMode {
  const fallbackMode: StaffGameInputMode = availability.virtualAvailable ? "virtual" : "physical";

  if (savedMode === "virtual") {
    return availability.virtualAvailable ? "virtual" : fallbackMode;
  }
  if (savedMode === "physical") return "physical";
  if (savedMode === "midi") {
    return availability.midiAvailable ? "midi" : fallbackMode;
  }
  return fallbackMode;
}
