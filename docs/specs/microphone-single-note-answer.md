# Spec: Microphone Single-Note Answers

## Objective

Let a learner answer the existing natural-note practice prompts by playing one piano note that the browser microphone can hear. The app converts a stable, confident pitch to an exact note and submits it through the existing practice flow.

## Scope

- Supports one natural note at a time in the app's current F1-G6 practice range.
- Uses an explicit microphone permission action and a live input indicator.
- Keeps audio in memory for analysis only; it does not record, save, or upload microphone audio.
- Disables app-generated prompt and answer sounds during microphone sessions to prevent feedback from becoming an answer.
- Does not recognize chords or use the visible prompt to correct the detected octave. The single-pitch detector may still choose a dominant pitch from some chord inputs.
- Unvoiced or uncertain audio does not become an answer. Clear wrong notes use existing wrong-answer feedback.
- Microphone sessions have a distinct answer mode so their history is not compared directly with MIDI sessions. Existing sessions retain their current interpretation.

## Project Structure

- `src/features/vocal-pitch/logic/pitchFrameDetector.ts`: shared pitch detector and sample-window sizing.
- `src/features/vocal-pitch/logic/usePracticeMicrophoneInput.ts`: microphone lifecycle and realtime frame capture without `MediaRecorder`.
- `src/features/vocal-pitch/logic/practiceNoteRecognizer.ts`: stateful note stability, onset, and silence rearming rules.
- `src/domain/answerInput.ts`: microphone answer source and exact-pitch verdict.
- `src/features/practice/components/PracticeView.tsx`: mode selection, answer submission, session lifecycle, and audible status.
- `src/domain/types.ts`, session snapshot and comparison modules: versioned local history compatibility.

## Boundaries

- Always: retain keyboard/MIDI practice, natural-note-only answer semantics, explicit microphone permission, and stop tracks when the practice view exits.
- Always: require stable pitch evidence and avoid submitting app-generated prompt or feedback audio.
- Ask first: changes to adaptive scheduling meaning, backend/wire data, microphone recording or upload, chord recognition, or new third-party dependencies.
- Never: infer the answer from the currently displayed target or add remote audio processing.

## Verification Strategy

- Existing Vitest suite covers answer decisions, session compatibility, comparison grouping, and pitch analysis.
- Manual acceptance uses a real piano and browser microphone in the deployed HTTPS site or localhost. Check low/middle/high notes, wrong notes, repeated notes, prompt playback, silence, and permission denial.

Platform-specific capture measurements, gain experiments, false-candidate risks, and known limitations are recorded in [iOS / iPadOS 麦克风音高识别记录](../research/ios-ipados-microphone-pitch-recognition.md).

## Success Criteria

- Microphone permission is requested only after the learner selects microphone mode or starts that mode.
- Stable correct notes advance the existing practice flow; stable wrong natural notes receive wrong-answer feedback.
- Silence, low-confidence or unstable pitch, accidentals, and app playback do not produce an answer.
- Chords are outside the supported input model; polyphonic false positives need manual acceptance testing.
- Repeated notes can be recognized as separate strikes.
- Microphone sessions are grouped separately from MIDI and legacy sessions remain readable without rewriting them.
