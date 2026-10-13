import type { NoteName } from "../../../domain/types";

export type SongPracticeInputMode = "virtual" | "midi" | "microphone";
export type SongPracticeTrackMode = "treble" | "bass" | "mixed";
export type SongPracticeHandMode = "left" | "right" | "both";
export type SongPracticeKeyVersion = "c" | "original" | "source";
export type SongPracticeStaff = "treble" | "bass";
export type SongPracticeDuration =
  | "whole"
  | "dotted-whole"
  | "half"
  | "dotted-half"
  | "quarter"
  | "dotted-quarter"
  | "double-dotted-quarter"
  | "quarter-plus-sixteenth"
  | "eighth"
  | "dotted-eighth"
  | "triplet-eighth"
  | "triplet-half"
  | "sixteenth"
  | "dotted-sixteenth"
  | "thirty-second"
  | "sixty-fourth";

/** Source notation stays descriptive so future score readers can add formats independently. */
export type SongPracticeNotationFormat = string;

export type SongPracticeSectionRole = "intro" | "main" | "verse" | "chorus" | "outro" | "other";

export interface SongPracticeMeter {
  numerator: number;
  denominator: number;
  /** Number of quarter-note beats in a measure. */
  quarterBeatsPerMeasure: number;
}

export interface SongPracticeSection {
  id: string;
  name: string;
  role: SongPracticeSectionRole;
  startMeasure: number;
  endMeasure: number;
}

export interface SongPracticeSourceMetadata {
  notationFormat: SongPracticeNotationFormat;
  originalKey: string;
  keyVersion?: SongPracticeKeyVersion;
  sourceFileName?: string;
  sourcePdfFileName?: string;
  sourceFileSha256?: string;
  ticksPerQuarter?: number;
  sourceTempoEvents?: readonly {
    tick: number;
    microsecondsPerQuarter: number;
    trackIndex: number;
  }[];
  pageCount?: number;
  sourceUrl?: string;
}

export interface SongPracticeScoreMetadata {
  source: SongPracticeSourceMetadata;
  practiceKey: string;
  meter: SongPracticeMeter;
  tempoBpm: number;
  sections: readonly SongPracticeSection[];
}

export interface SongPracticeSourceAnchor {
  page: number;
  measure: number;
  eventIndex: number;
}

export interface SongPracticeMidiSourceLocation {
  channel: number;
  durationTicks: number;
  eventIndex: number;
  midiTrackIndex: number;
  onsetTick: number;
}

export interface SongPracticeNote {
  noteName: NoteName;
  octave: number;
  accidental?: "sharp" | "flat";
  /** MIDI pitch provides a notation-independent pitch value for score processing. */
  midiPitch: number;
  /** Untransposed pitch from the original score/MIDI, when available. */
  sourceMidiPitch?: number;
  duration: SongPracticeDuration;
  /** Duration measured in quarter-note beats. */
  durationBeats: number;
  measure: number;
  /** Attack position within the measure, measured in quarter-note beats. */
  onsetBeat: number;
  staff: SongPracticeStaff;
  lyrics?: readonly string[];
  sourceSymbol?: string;
  sourceAnchor?: SongPracticeSourceAnchor;
  sourceMidiLocation?: SongPracticeMidiSourceLocation;
}

export interface SongPracticePart {
  id: SongPracticeStaff;
  name: string;
  notes: readonly SongPracticeNote[];
}

export interface SongPracticeScore extends SongPracticeScoreMetadata {
  id: string;
  title: string;
  parts: readonly SongPracticePart[];
}

const NATURAL_NOTE_PITCH_CLASSES: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Lightweight import-time checks for score data used by the practice flow. */
export function validateSongPracticeScore(score: SongPracticeScore): string[] {
  const errors: string[] = [];
  const { meter, source, tempoBpm } = score;
  if (!Number.isInteger(tempoBpm) || tempoBpm <= 0) errors.push("速度必须是正整数");
  if (
    !Number.isInteger(meter.numerator) ||
    meter.numerator <= 0 ||
    !Number.isInteger(meter.denominator) ||
    meter.denominator <= 0 ||
    !Number.isFinite(meter.quarterBeatsPerMeasure) ||
    meter.quarterBeatsPerMeasure <= 0
  ) {
    errors.push("拍号或每小节拍数无效");
  }
  if (
    source.pageCount !== undefined &&
    (!Number.isInteger(source.pageCount) || source.pageCount <= 0)
  ) {
    errors.push("来源页数必须是正整数");
  }
  if (
    source.ticksPerQuarter !== undefined &&
    (!Number.isInteger(source.ticksPerQuarter) || source.ticksPerQuarter <= 0)
  ) {
    errors.push("MIDI 每四分音符 tick 数无效");
  }
  for (const [index, event] of (source.sourceTempoEvents ?? []).entries()) {
    if (
      !Number.isInteger(event.tick) ||
      event.tick < 0 ||
      !Number.isFinite(event.microsecondsPerQuarter) ||
      event.microsecondsPerQuarter <= 0 ||
      !Number.isInteger(event.trackIndex) ||
      event.trackIndex < 0
    ) {
      errors.push(`第 ${index + 1} 个速度事件无效`);
    }
  }

  const partIds = new Set<SongPracticeStaff>();
  let highestMeasure = 0;
  for (const part of score.parts) {
    if (partIds.has(part.id)) errors.push(`声部重复：${part.id}`);
    partIds.add(part.id);
    let previousMeasure = 0;
    let previousOnset = -1;
    for (const [index, note] of part.notes.entries()) {
      const location = `${part.id} 第 ${index + 1} 个音符`;
      if (!Number.isInteger(note.measure) || note.measure < 1) {
        errors.push(`${location}的小节号无效`);
      }
      if (
        !Number.isFinite(note.onsetBeat) ||
        note.onsetBeat < 0 ||
        note.onsetBeat >= meter.quarterBeatsPerMeasure
      ) {
        errors.push(`${location}的起拍超出小节范围`);
      }
      if (!Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
        errors.push(`${location}的时值无效`);
      }
      if (!Number.isInteger(note.midiPitch) || note.midiPitch < 0 || note.midiPitch > 127) {
        errors.push(`${location}的 MIDI 音高无效`);
      } else {
        if (!Number.isInteger(note.octave)) errors.push(`${location}的八度无效`);
        const accidentalOffset =
          note.accidental === "sharp" ? 1 : note.accidental === "flat" ? -1 : 0;
        const expectedPitch =
          NATURAL_NOTE_PITCH_CLASSES[note.noteName] + accidentalOffset + 12 * (note.octave + 1);
        if (note.midiPitch !== expectedPitch) {
          errors.push(`${location}的音名、八度与 MIDI 音高不一致`);
        }
      }
      if (
        note.measure < previousMeasure ||
        (note.measure === previousMeasure && note.onsetBeat < previousOnset)
      ) {
        errors.push(`${location}未按演奏顺序排列`);
      }
      if (note.measure !== previousMeasure) previousOnset = -1;
      previousMeasure = note.measure;
      previousOnset = note.onsetBeat;
      highestMeasure = Math.max(highestMeasure, note.measure);

      if (note.sourceAnchor) {
        const { eventIndex, measure, page } = note.sourceAnchor;
        if (
          !Number.isInteger(page) ||
          page < 1 ||
          (source.pageCount !== undefined && page > source.pageCount) ||
          !Number.isInteger(measure) ||
          measure !== note.measure ||
          !Number.isInteger(eventIndex) ||
          eventIndex < 0
        ) {
          errors.push(`${location}的来源位置无效`);
        }
      }
    }
  }

  for (const section of score.sections) {
    if (
      !Number.isInteger(section.startMeasure) ||
      !Number.isInteger(section.endMeasure) ||
      section.startMeasure < 1 ||
      section.endMeasure < section.startMeasure ||
      section.endMeasure > highestMeasure
    ) {
      errors.push(`段落「${section.name}」的小节范围无效`);
    }
  }
  return errors;
}

export function assertValidSongPracticeScore(score: SongPracticeScore): SongPracticeScore {
  const errors = validateSongPracticeScore(score);
  if (errors.length > 0) {
    throw new Error(`歌曲「${score.title}」的数据检查失败：${errors.join("；")}`);
  }
  return score;
}

/** A notation-specific reader produces the same practice parts regardless of source format. */
export interface SongPracticeNotationAdapter<TSource> {
  notationFormat: SongPracticeNotationFormat;
  decode: (source: TSource, metadata: SongPracticeScoreMetadata) => readonly SongPracticePart[];
}

export interface SongPracticeSelection {
  handMode: SongPracticeHandMode;
  inputMode: SongPracticeInputMode;
  keyVersion: SongPracticeKeyVersion;
  preferredInputMode?: SongPracticeInputMode;
  score: SongPracticeScore;
  songId: string;
}

export interface SongPracticeTarget {
  id: string;
  notes: readonly SongPracticeNote[];
  measure: number;
  onsetBeat: number;
  duration: SongPracticeDuration;
  durationBeats: number;
}

export interface ResolvedSongPracticeArrangement {
  notes: readonly SongPracticeNote[];
  targets: readonly SongPracticeTarget[];
  noteCount: number;
  partName: string;
  trackMode: SongPracticeTrackMode;
}

function onsetKey(note: SongPracticeNote): string {
  return note.sourceMidiLocation
    ? `tick:${note.sourceMidiLocation.onsetTick}`
    : `${note.measure}:${note.onsetBeat.toFixed(6)}`;
}

export function resolveSongPracticeArrangement(
  score: SongPracticeScore,
  handMode: SongPracticeHandMode
): ResolvedSongPracticeArrangement {
  const selectedNotes = score.parts
    .filter(
      (part) =>
        handMode === "both" || (handMode === "left" ? part.id === "bass" : part.id === "treble")
    )
    .flatMap((part) => part.notes);
  const groups = new Map<string, SongPracticeNote[]>();
  for (const note of selectedNotes) {
    const key = onsetKey(note);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  const targets: SongPracticeTarget[] = [...groups.values()]
    .map((sourceNotes) => {
      const sortedNotes = [...sourceNotes].sort(
        (left, right) =>
          (left.sourceMidiPitch ?? left.midiPitch) - (right.sourceMidiPitch ?? right.midiPitch)
      );
      const first = sortedNotes[0]!;
      const longestNote = sortedNotes.reduce((longest, note) =>
        note.durationBeats > longest.durationBeats ? note : longest
      );
      return {
        id: first.sourceMidiLocation
          ? `${first.sourceMidiLocation.midiTrackIndex}:${first.sourceMidiLocation.onsetTick}`
          : `${first.measure}:${first.onsetBeat.toFixed(6)}`,
        notes: sortedNotes,
        measure: first.measure,
        onsetBeat: first.onsetBeat,
        duration: longestNote.duration,
        durationBeats: Math.max(...sortedNotes.map((note) => note.durationBeats)),
      };
    })
    .sort((left, right) => left.measure - right.measure || left.onsetBeat - right.onsetBeat);
  return {
    notes: targets.flatMap((target) => target.notes.slice(0, 1)),
    targets,
    noteCount: targets.reduce((count, target) => count + target.notes.length, 0),
    partName: handMode === "left" ? "左手声部" : handMode === "right" ? "右手声部" : "双手合弹",
    trackMode: handMode === "left" ? "bass" : handMode === "right" ? "treble" : "mixed",
  };
}

/**
 * Single-note inputs cannot answer a chord target. Keep the melody's highest
 * pitch for the right hand and the bass's lowest pitch for the left hand;
 * MIDI callers should keep using the unmodified arrangement.
 */
export function simplifySongPracticeArrangement(
  arrangement: ResolvedSongPracticeArrangement,
  handMode: SongPracticeHandMode
): ResolvedSongPracticeArrangement {
  if (handMode === "both") return arrangement;

  const targets = arrangement.targets.map((target) => {
    const note = handMode === "right" ? target.notes.at(-1) : target.notes[0];
    return note ? { ...target, notes: [note] } : target;
  });

  return {
    ...arrangement,
    notes: targets.flatMap((target) => target.notes),
    targets,
    noteCount: targets.reduce((count, target) => count + target.notes.length, 0),
  };
}
