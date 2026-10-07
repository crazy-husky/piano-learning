import { formatMidiNote } from "../domain/vocalPitch";
import {
  createPracticeNoteRecognizer,
  frequencyToNaturalPracticeNote,
  PRACTICE_NOTE_CONTINUITY_CONFIDENCE,
  PRACTICE_NOTE_MAX_MIDI,
  PRACTICE_NOTE_MIN_MIDI,
} from "./practiceNoteRecognizer";
import type {
  PracticeMicrophoneCaptureFrame,
  PracticeMicrophoneCaptureMetadata,
} from "./practiceMicrophoneCapture";
import type {
  PracticeMicrophoneAlgorithm,
  PracticeMicrophoneAnalysisGain,
  PracticeMicrophoneFrameInterval,
  PracticeMicrophoneSensitivityLevel,
} from "./practiceMicrophonePreferences";

export type PracticeMicrophoneEventClassification = "correct" | "wrong" | "extra" | "uncompared";

export interface PracticeMicrophoneAnalysisEvent {
  analysisClippedSampleRatio: number;
  analysisPeak: number;
  analysisRms: number;
  classification: PracticeMicrophoneEventClassification;
  clippedSampleRatio: number;
  confidence: number;
  expectedMidiNoteNumber: number | null;
  frequencyHz: number;
  intervalFromPreviousMs: number | null;
  midiNoteNumber: number;
  note: string;
  offsetMs: number;
  peak: number;
  rms: number;
}

export interface PracticeMicrophoneAnalysisFrame {
  analysisClippedSampleRatio: number;
  analysisPeak: number;
  analysisRms: number;
  ambiguous: boolean;
  clippedSampleRatio: number;
  confidence: number | null;
  eligible: boolean;
  frequencyHz: number | null;
  offsetMs: number;
  outcome: string | null;
  peak: number;
  rms: number;
}

export interface PracticeMicrophoneCandidateSegment {
  analysisRmsAverage: number;
  analysisRmsMaximum: number;
  confidenceAverage: number | null;
  confidenceMaximum: number | null;
  endOffsetMs: number;
  frames: PracticeMicrophoneAnalysisFrame[];
  frameCount: number;
  inputRmsAverage: number;
  inputRmsMaximum: number;
  midiNoteNumber: number;
  note: string;
  lowConfidenceFrameCount: number;
  lowRmsFrameCount: number;
  longestEligibleDurationMs: number;
  maxConsecutiveEligibleFrameCount: number;
  startOffsetMs: number;
  stableEventCount: number;
  stableThresholdMet: boolean;
  thresholdEligibleFrameCount: number;
}

export interface PracticeMicrophoneAnalysis {
  candidateSegments: PracticeMicrophoneCandidateSegment[];
  counts: {
    correct: number | null;
    detected: number;
    difference: number | null;
    extra: number | null;
    expected: number | null;
    missed: number | null;
    wrong: number | null;
  };
  events: PracticeMicrophoneAnalysisEvent[];
  format: "piano-learning-practice-microphone-analysis";
  missedNotes: Array<{ midiNoteNumber: number; sequenceIndex: number }>;
  medianFrameIntervalMs: number | null;
  parameters: {
    algorithm: PracticeMicrophoneAlgorithm;
    analysisGain: PracticeMicrophoneAnalysisGain;
    confidenceThreshold: number;
    debugMode: boolean;
    frameCaptureIntervalMs: number;
    frameIntervalSelection: PracticeMicrophoneFrameInterval;
    inputRmsThreshold: number;
    primaryClarityThreshold: number;
    requiredStableFrames: number;
    requiredStableMs: number;
    sensitivityLevel: PracticeMicrophoneSensitivityLevel;
    yinThreshold: number;
  };
  expectedSequence: number[] | null;
  unansweredCandidateSegmentCount: number;
}

interface MutableCandidateSegment {
  endOffsetMs: number;
  frames: PracticeMicrophoneCaptureFrame[];
  gapFrameCount: number;
  midiNoteNumber: number;
  startOffsetMs: number;
}

function alignEvents(
  expected: readonly number[],
  detected: readonly number[],
): {
  events: Array<{ classification: "correct" | "wrong" | "extra"; expectedMidiNoteNumber: number | null }>;
  missedNotes: Array<{ midiNoteNumber: number; sequenceIndex: number }>;
} {
  const costs = Array.from({ length: expected.length + 1 }, () => new Array<number>(detected.length + 1).fill(0));
  for (let expectedIndex = 0; expectedIndex <= expected.length; expectedIndex += 1) {
    costs[expectedIndex][0] = expectedIndex;
  }
  for (let detectedIndex = 0; detectedIndex <= detected.length; detectedIndex += 1) {
    costs[0][detectedIndex] = detectedIndex;
  }

  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    for (let detectedIndex = 1; detectedIndex <= detected.length; detectedIndex += 1) {
      const substitutionCost = expected[expectedIndex - 1] === detected[detectedIndex - 1] ? 0 : 1;
      costs[expectedIndex][detectedIndex] = Math.min(
        costs[expectedIndex - 1][detectedIndex] + 1,
        costs[expectedIndex][detectedIndex - 1] + 1,
        costs[expectedIndex - 1][detectedIndex - 1] + substitutionCost,
      );
    }
  }

  const aligned: Array<{ classification: "correct" | "wrong" | "extra"; expectedMidiNoteNumber: number | null }> = [];
  const missedNotes: Array<{ midiNoteNumber: number; sequenceIndex: number }> = [];
  let expectedIndex = expected.length;
  let detectedIndex = detected.length;
  while (expectedIndex > 0 || detectedIndex > 0) {
    const expectedMidi = expected[expectedIndex - 1];
    const detectedMidi = detected[detectedIndex - 1];
    const exactMatch = expectedIndex > 0 && detectedIndex > 0 && expectedMidi === detectedMidi &&
      costs[expectedIndex][detectedIndex] === costs[expectedIndex - 1][detectedIndex - 1];
    const equallyGoodInsertion = detectedIndex > 0 &&
      costs[expectedIndex][detectedIndex] === costs[expectedIndex][detectedIndex - 1] + 1;
    if (exactMatch && equallyGoodInsertion) {
      aligned.push({ classification: "extra", expectedMidiNoteNumber: null });
      detectedIndex -= 1;
      continue;
    }
    if (
      exactMatch
    ) {
      aligned.push({ classification: "correct", expectedMidiNoteNumber: expectedMidi });
      expectedIndex -= 1;
      detectedIndex -= 1;
      continue;
    }
    if (
      expectedIndex > 0 && detectedIndex > 0 &&
      costs[expectedIndex][detectedIndex] === costs[expectedIndex - 1][detectedIndex - 1] + 1
    ) {
      aligned.push({ classification: "wrong", expectedMidiNoteNumber: expectedMidi });
      expectedIndex -= 1;
      detectedIndex -= 1;
      continue;
    }
    if (
      detectedIndex > 0 &&
      costs[expectedIndex][detectedIndex] === costs[expectedIndex][detectedIndex - 1] + 1
    ) {
      aligned.push({ classification: "extra", expectedMidiNoteNumber: null });
      detectedIndex -= 1;
      continue;
    }
    missedNotes.push({ midiNoteNumber: expectedMidi, sequenceIndex: expectedIndex - 1 });
    expectedIndex -= 1;
  }
  return { events: aligned.reverse(), missedNotes: missedNotes.reverse() };
}

function findCandidateSegments(
  frames: readonly PracticeMicrophoneCaptureFrame[],
  metadata: PracticeMicrophoneCaptureMetadata,
  events: readonly PracticeMicrophoneAnalysisEvent[],
): PracticeMicrophoneCandidateSegment[] {
  const segments: MutableCandidateSegment[] = [];
  const maximumGapMs = Math.max(80, metadata.frameCaptureIntervalMs * 1.75);

  for (const frame of frames) {
    const candidate = frame.frequencyHz === null || frame.frequencyHz === undefined
      ? null
      : frequencyToNaturalPracticeNote(frame.frequencyHz);
    if (!candidate) {
      const current = segments.at(-1);
      if (current) current.gapFrameCount += 1;
      continue;
    }
    const offsetMs = Math.round(frame.offsetMs);
    const previous = segments.at(-1);
    if (
      previous && previous.midiNoteNumber === candidate.midiNoteNumber &&
      previous.gapFrameCount < 2 && offsetMs - previous.endOffsetMs <= maximumGapMs
    ) {
      previous.endOffsetMs = offsetMs;
      previous.frames.push(frame);
      previous.gapFrameCount = 0;
    } else {
      segments.push({
        endOffsetMs: offsetMs,
        frames: [frame],
        gapFrameCount: 0,
        midiNoteNumber: candidate.midiNoteNumber,
        startOffsetMs: offsetMs,
      });
    }
  }

  const eventSegmentMarginMs = Math.max(maximumGapMs, metadata.frameCaptureIntervalMs * 4);
  return segments.map((segment) => {
    const frames = segment.frames.map((frame): PracticeMicrophoneAnalysisFrame => {
      const confidence = frame.confidence ?? null;
      const analysisRms = frame.analysisRms ?? frame.rms;
      const ambiguous = frame.ambiguous === true;
      return {
        analysisClippedSampleRatio: frame.analysisClippedSampleRatio ?? frame.clippedSampleRatio,
        analysisPeak: frame.analysisPeak ?? frame.peak,
        analysisRms,
        ambiguous,
        clippedSampleRatio: frame.clippedSampleRatio,
        confidence,
        eligible: confidence !== null && confidence >= metadata.confidenceThreshold &&
          analysisRms >= metadata.inputRmsThreshold && !ambiguous,
        frequencyHz: frame.frequencyHz ?? null,
        offsetMs: Math.round(frame.offsetMs),
        outcome: frame.outcome ?? null,
        peak: frame.peak,
        rms: frame.rms,
      };
    });
    const thresholdEligibleFrameCount = frames.filter((frame) => frame.eligible).length;
    let currentEligibleFrameCount = 0;
    let currentEligibleStartOffsetMs = 0;
    let previousEligibleOffsetMs: number | null = null;
    let maxConsecutiveEligibleFrameCount = 0;
    let longestEligibleDurationMs = 0;
    const maximumConsecutiveGapMs = Math.max(40, metadata.frameCaptureIntervalMs * 1.75);
    for (const frame of frames) {
      const gapMs = previousEligibleOffsetMs === null ? 0 : frame.offsetMs - previousEligibleOffsetMs;
      if (!frame.eligible || (previousEligibleOffsetMs !== null && gapMs > maximumConsecutiveGapMs)) {
        currentEligibleFrameCount = 0;
        previousEligibleOffsetMs = null;
        if (!frame.eligible) continue;
      }
      if (currentEligibleFrameCount === 0) currentEligibleStartOffsetMs = frame.offsetMs;
      currentEligibleFrameCount += 1;
      previousEligibleOffsetMs = frame.offsetMs;
      maxConsecutiveEligibleFrameCount = Math.max(
        maxConsecutiveEligibleFrameCount,
        currentEligibleFrameCount,
      );
      longestEligibleDurationMs = Math.max(
        longestEligibleDurationMs,
        frame.offsetMs - currentEligibleStartOffsetMs,
      );
    }
    const stableEventCount = events.filter((event) =>
      Math.abs(event.midiNoteNumber - segment.midiNoteNumber) <= 12 &&
      ((event.midiNoteNumber - segment.midiNoteNumber) % 12 + 12) % 12 === 0 &&
      event.offsetMs >= segment.startOffsetMs - eventSegmentMarginMs &&
      event.offsetMs <= segment.endOffsetMs + eventSegmentMarginMs
    ).length;
    const stableThresholdMet =
      maxConsecutiveEligibleFrameCount >= metadata.requiredStableFrames &&
      longestEligibleDurationMs >= metadata.requiredStableMs;
    const confidenceValues = frames.flatMap((frame) => frame.confidence === null ? [] : [frame.confidence]);
    const average = (values: readonly number[]): number =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      analysisRmsAverage: average(frames.map((frame) => frame.analysisRms)),
      analysisRmsMaximum: Math.max(...frames.map((frame) => frame.analysisRms)),
      confidenceAverage: confidenceValues.length === 0 ? null : average(confidenceValues),
      confidenceMaximum: confidenceValues.length === 0 ? null : Math.max(...confidenceValues),
      endOffsetMs: segment.endOffsetMs,
      frames,
      frameCount: segment.frames.length,
      inputRmsAverage: average(frames.map((frame) => frame.rms)),
      inputRmsMaximum: Math.max(...frames.map((frame) => frame.rms)),
      lowConfidenceFrameCount: frames.filter((frame) =>
        frame.confidence === null || frame.confidence < metadata.confidenceThreshold
      ).length,
      lowRmsFrameCount: frames.filter((frame) => frame.analysisRms < metadata.inputRmsThreshold).length,
      longestEligibleDurationMs,
      maxConsecutiveEligibleFrameCount,
      midiNoteNumber: segment.midiNoteNumber,
      note: formatMidiNote(segment.midiNoteNumber),
      startOffsetMs: segment.startOffsetMs,
      stableEventCount,
      stableThresholdMet,
      thresholdEligibleFrameCount,
    };
  });
}

export function parseExpectedPracticeNoteSequence(value: string): number[] | null {
  const tokens = value.trim().split(/[\s,，、]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 64) return null;
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const sequence: number[] = [];
  for (const token of tokens) {
    const match = /^([CDEFGAB])([0-8])$/i.exec(token);
    if (!match) return null;
    const midi = (Number(match[2]) + 1) * 12 + semitones[match[1].toUpperCase()];
    if (midi < PRACTICE_NOTE_MIN_MIDI || midi > PRACTICE_NOTE_MAX_MIDI) return null;
    sequence.push(midi);
  }
  return sequence;
}

export function analyzePracticeMicrophoneCapture(
  metadata: PracticeMicrophoneCaptureMetadata,
  frames: readonly PracticeMicrophoneCaptureFrame[],
  expectedSequence: readonly number[] | null,
): PracticeMicrophoneAnalysis {
  const continuityConfidence = metadata.algorithm === "mpm-c"
    ? PRACTICE_NOTE_CONTINUITY_CONFIDENCE
    : metadata.confidenceThreshold;
  const recognizer = createPracticeNoteRecognizer(metadata.confidenceThreshold, {
    continuityConfidence,
    requiredFrames: metadata.requiredStableFrames,
    requiredMs: metadata.requiredStableMs,
  });
  const detectedEvents: Array<Omit<
    PracticeMicrophoneAnalysisEvent,
    "classification" | "expectedMidiNoteNumber" | "intervalFromPreviousMs"
  >> = [];

  for (const frame of frames) {
    const frequencyHz = frame.frequencyHz ?? null;
    const analysisRms = frame.analysisRms ?? frame.rms;
    const eligible =
      frequencyHz !== null &&
      analysisRms >= metadata.inputRmsThreshold &&
      (frame.confidence ?? 0) >= metadata.confidenceThreshold;
    const canUsePitchContinuity = metadata.algorithm === "mpm-c" &&
      (frame.confidence ?? 0) >= PRACTICE_NOTE_CONTINUITY_CONFIDENCE;
    const recognizerHasUsableFrequency = frequencyHz !== null &&
      analysisRms >= metadata.inputRmsThreshold &&
      (eligible || canUsePitchContinuity);
    const recognized = recognizer.process({
      ambiguous: frame.ambiguous,
      confidence: frame.confidence ?? 0,
      frequencyHz: recognizerHasUsableFrequency ? frequencyHz : null,
      rms: analysisRms,
      timeMs: frame.offsetMs,
    });
    if (recognized && frequencyHz !== null) {
      detectedEvents.push({
        analysisClippedSampleRatio: frame.analysisClippedSampleRatio ?? frame.clippedSampleRatio,
        analysisPeak: frame.analysisPeak ?? frame.peak,
        analysisRms,
        confidence: frame.confidence ?? 0,
        clippedSampleRatio: frame.clippedSampleRatio,
        frequencyHz,
        midiNoteNumber: recognized.midiNoteNumber,
        note: formatMidiNote(recognized.midiNoteNumber),
        offsetMs: Math.round(frame.offsetMs),
        peak: frame.peak,
        rms: frame.rms,
      });
    }
  }

  const alignment = expectedSequence
    ? alignEvents(expectedSequence, detectedEvents.map((event) => event.midiNoteNumber))
    : {
        events: detectedEvents.map(() => ({ classification: "uncompared" as const, expectedMidiNoteNumber: null })),
        missedNotes: [],
      };
  const aligned = alignment.events;
  const events = detectedEvents.map((event, index) => ({
    ...event,
    ...aligned[index],
    intervalFromPreviousMs: index === 0 ? null : event.offsetMs - detectedEvents[index - 1].offsetMs,
  }));
  const candidateSegments = findCandidateSegments(frames, metadata, events);
  const frameIntervals = frames.slice(1)
    .map((frame, index) => frame.offsetMs - frames[index].offsetMs)
    .filter((interval) => interval > 0);
  const sortedFrameIntervals = frameIntervals.slice().sort((left, right) => left - right);
  const middle = Math.floor(sortedFrameIntervals.length / 2);
  const medianFrameIntervalMs = sortedFrameIntervals.length === 0
    ? null
    : sortedFrameIntervals.length % 2 === 0
      ? (sortedFrameIntervals[middle - 1] + sortedFrameIntervals[middle]) / 2
      : sortedFrameIntervals[middle];
  const countClassification = (classification: PracticeMicrophoneEventClassification): number =>
    events.filter((event) => event.classification === classification).length;

  return {
    candidateSegments,
    counts: {
      correct: expectedSequence ? countClassification("correct") : null,
      detected: events.length,
      difference: expectedSequence ? events.length - expectedSequence.length : null,
      extra: expectedSequence ? countClassification("extra") : null,
      expected: expectedSequence?.length ?? null,
      missed: expectedSequence
        ? expectedSequence.length - countClassification("correct") - countClassification("wrong")
        : null,
      wrong: expectedSequence ? countClassification("wrong") : null,
    },
    events,
    format: "piano-learning-practice-microphone-analysis",
    missedNotes: alignment.missedNotes,
    medianFrameIntervalMs,
    parameters: {
      algorithm: metadata.algorithm,
      analysisGain: metadata.analysisGain,
      confidenceThreshold: metadata.confidenceThreshold,
      debugMode: metadata.debugMode,
      frameCaptureIntervalMs: metadata.frameCaptureIntervalMs,
      frameIntervalSelection: metadata.frameIntervalSelection,
      inputRmsThreshold: metadata.inputRmsThreshold,
      primaryClarityThreshold: metadata.primaryClarityThreshold,
      requiredStableFrames: metadata.requiredStableFrames,
      requiredStableMs: metadata.requiredStableMs,
      sensitivityLevel: metadata.sensitivityLevel,
      yinThreshold: metadata.yinThreshold,
    },
    expectedSequence: expectedSequence ? [...expectedSequence] : null,
    unansweredCandidateSegmentCount: candidateSegments.filter((segment) =>
      segment.stableEventCount === 0
    ).length,
  };
}
