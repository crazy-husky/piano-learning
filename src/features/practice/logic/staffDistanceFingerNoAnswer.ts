const NO_ANSWER_INTRO_SEEN_KEY = "piano-learning:staff-distance-finger-no-answer-intro-v1";

export function hasSeenStaffDistanceFingerNoAnswerIntro(): boolean {
  try {
    return window.localStorage.getItem(NO_ANSWER_INTRO_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function markStaffDistanceFingerNoAnswerIntroSeen(): void {
  try {
    window.localStorage.setItem(NO_ANSWER_INTRO_SEEN_KEY, "true");
  } catch {
    // The intro can still be acknowledged for this visit if storage is unavailable.
  }
}
