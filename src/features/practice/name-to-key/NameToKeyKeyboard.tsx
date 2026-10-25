import type { PianoKeyName } from "../../../domain/types";
import {
  VirtualPianoKeyboard,
  VIRTUAL_PIANO_BLACK_KEYS,
  VIRTUAL_PIANO_WHITE_KEYS,
} from "../../../shared/components/VirtualPianoKeyboard";
import { midiForOctaveKey } from "./nameToKeyPractice";

const KEY_SEMITONES: Readonly<Record<PianoKeyName, number>> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};
const OCTAVE_KEYS: readonly PianoKeyName[] = [
  ...VIRTUAL_PIANO_WHITE_KEYS,
  ...VIRTUAL_PIANO_BLACK_KEYS.map(({ pitch }) => pitch),
];

export interface NameToKeyKeyboardProps {
  feedback?: { correctMidi: number; wrongMidi?: number };
  includeOctaveNumbers: boolean;
  octaves: readonly number[];
  showOctaveLabels?: boolean;
  onKeyPress: (midi: number) => void;
}

export function NameToKeyKeyboard({
  feedback,
  includeOctaveNumbers,
  octaves,
  showOctaveLabels = includeOctaveNumbers,
  onKeyPress,
}: NameToKeyKeyboardProps): JSX.Element {
  return (
    <div aria-label="虚拟钢琴键盘" className="name-key-keyboards" role="group">
      {octaves.map((octave) => {
        const octaveFeedback = new Map<PianoKeyName, "correct" | "wrong">();
        const enabledKeys = new Set<PianoKeyName>();

        if (feedback) {
          const correctKey = midiToKeyAtOctave(feedback.correctMidi, octave);
          const wrongKey =
            feedback.wrongMidi === undefined ? null : midiToKeyAtOctave(feedback.wrongMidi, octave);
          if (correctKey) {
            octaveFeedback.set(correctKey, "correct");
          }
          if (wrongKey) {
            octaveFeedback.set(wrongKey, "wrong");
          }
        }

        OCTAVE_KEYS.forEach((keyName) => {
          const midi = midiForOctaveKey(octave, KEY_SEMITONES[keyName]);
          if (midi >= 29 && midi <= 95) enabledKeys.add(keyName);
        });

        return (
          <div
            className={`name-key-octave-row${showOctaveLabels ? " has-label" : ""}`}
            key={octave}
          >
            {showOctaveLabels ? <span className="name-key-octave-label">Oct {octave}</span> : null}
            <VirtualPianoKeyboard
              ariaLabel={`第 ${octave} 组虚拟钢琴键`}
              className="name-key-virtual-keyboard"
              enabledKeys={enabledKeys}
              feedbackKeys={octaveFeedback}
              getKeyLabel={(keyName) =>
                `${keyName.replace("#", "♯")}${includeOctaveNumbers ? octave : ""}`
              }
              getKeyAriaLabel={(keyName) =>
                `${keyName.replace("#", "♯")}${octave} 音键${octaveFeedback.has(keyName) ? (octaveFeedback.get(keyName) === "correct" ? "，正确答案" : "，刚才弹奏的音") : ""}`
              }
              onKeyPress={(keyName) => onKeyPress(midiForOctaveKey(octave, KEY_SEMITONES[keyName]))}
            />
          </div>
        );
      })}
    </div>
  );
}

function midiToKeyAtOctave(midi: number, octave: number): PianoKeyName | null {
  if (Math.floor(midi / 12) - 1 !== octave) return null;
  const semitone = midi % 12;
  const keyName = (Object.keys(KEY_SEMITONES) as PianoKeyName[]).find(
    (name) => KEY_SEMITONES[name] === semitone
  );
  return keyName ?? null;
}
