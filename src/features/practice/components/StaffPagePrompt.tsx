import { Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Accidental,
  Beam,
  Formatter,
  GhostNote,
  Stave,
  StaveNote,
  StaveTie,
  Stem,
  Tuplet,
  Voice,
} from "vexflow";
import { markMidiLatencyStage } from "../../../diagnostics/midiLatencyDiagnostics";
import { noteToVexKey } from "../../../domain/notes";
import type {
  PromptNoteDuration,
  Staff,
  StaffNotationMode,
  TargetNote,
} from "../../../domain/types";
import {
  PRACTICE_PAGE_STAFF_LAYOUT,
  type PracticePageStaffLayoutProfile,
} from "../../../shared/staff/staffLayoutProfiles";
import { useNightMode } from "../../../shared/appearance/pageAppearance";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getLedgerStemDirection,
  logicalPx,
  staveNoteCenterX,
} from "../../../shared/staff/staffGeometry";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
  getVexNoteDuration,
} from "../logic/staffPageNotation";
import type { ScoreChaseCursor } from "../logic/scoreChase";
import type { ScorePlaybackCursor } from "../logic/scorePlayback";

interface StaffPagePromptProps {
  barlineAfterNoteIndices?: readonly number[];
  diagnosticSampleId?: number;
  notes: TargetNote[];
  noteGroups?: readonly (readonly TargetNote[])[];
  lyrics?: readonly (readonly string[])[];
  noteMeasures?: readonly number[];
  noteOnsets?: readonly number[];
  noteBeamGroups?: readonly number[];
  beatsPerMeasure?: number;
  timeSignature?: string;
  completedCount: number;
  completedNoteIndices?: readonly number[];
  activePairStartIndex?: number;
  isScrolling?: boolean;
  noteDuration: PromptNoteDuration;
  noteDurations?: readonly StaffPageNoteDuration[];
  staffNoteDurations?: readonly {
    treble?: StaffPageNoteDuration;
    bass?: StaffPageNoteDuration;
  }[];
  layout?: PracticePageStaffLayoutProfile;
  scrollDurationMs?: number;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  distributeNotesEvenly?: boolean;
  notesPerRow?: number;
  maxRowCount?: number;
  scrollRowCount?: number;
  minDisplayWidthPx?: number;
  visibleRowCount?: number;
  virtualizeRows?: boolean;
  isFiniteScore?: boolean;
  followRowIndex?: number;
  trackedNoteIndex?: number;
  onTrackedNoteVisibilityChange?: (isVisible: boolean) => void;
  breakBeamsAtStaffChange?: boolean;
  monophonicGrandStaff?: boolean;
  useInvisibleGapRests?: boolean;
  showGrandStaffRightConnector?: boolean;
  onToggleRowPlayback?: (rowIndex: number) => void;
  playingRowIndex?: number | null;
  playbackProgressIndex?: number | null;
  playbackCursor?: ScorePlaybackCursor | null;
  chaseCursor?: ScoreChaseCursor | null;
  cursorIndexOffset?: number;
  getAudioTime?: () => number;
  wrongIndex?: number;
}

export type StaffPageNoteDuration =
  | PromptNoteDuration
  | "half"
  | "dotted-whole"
  | "dotted-half"
  | "dotted-quarter"
  | "double-dotted-quarter"
  | "quarter-plus-sixteenth"
  | "dotted-eighth"
  | "dotted-sixteenth"
  | "triplet-eighth"
  | "triplet-half"
  | "thirty-second"
  | "sixty-fourth";

const STAFF_VEX_DURATIONS: Record<StaffPageNoteDuration, string> = {
  whole: "w",
  "dotted-whole": "wd",
  half: "h",
  "dotted-half": "hd",
  quarter: "q",
  "dotted-quarter": "qd",
  "double-dotted-quarter": "qdd",
  "quarter-plus-sixteenth": "q",
  eighth: "8",
  "dotted-eighth": "8d",
  "triplet-eighth": "8",
  "triplet-half": "h",
  sixteenth: "16",
  "dotted-sixteenth": "16d",
  "thirty-second": "32",
  "sixty-fourth": "64",
};

const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const AUTO_FOLLOW_RESUME_DELAY_MS = 2000;
type StaffPageTickable = GhostNote | StaveNote;
interface StaffPagePalette {
  active: string;
  complete: string;
  error: string;
  ink: string;
}
interface RenderedStaffPageNote {
  color: string;
  element: SVGElement;
}
interface PlaybackCursorPoint {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
type PlaybackCursorTargets = Partial<Record<Staff, PlaybackCursorPoint[]>>;
type PlaybackNoteHeadElements = Partial<Record<Staff, SVGElement[]>>;
interface PlaybackCursorLayer {
  ambient: SVGEllipseElement;
  diffuse: SVGEllipseElement;
  element: SVGGElement;
  innerGlow: SVGEllipseElement;
  light: SVGGElement;
  particleLayer: SVGGElement;
  rippleLayer: SVGGElement;
  core: SVGEllipseElement;
  rowIndex: number;
  staff: Staff;
}
interface ActivePlaybackMotion {
  controlPoint: PlaybackCursorPoint | null;
  cursor: object | null;
  endPoint: PlaybackCursorPoint | null;
  lastParticlePoint: PlaybackCursorPoint | null;
  lastParticleProgress: number | null;
  layer: PlaybackCursorLayer | null;
  startPoint: PlaybackCursorPoint | null;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PLAYBACK_PARTICLE_LIFETIME_MS = 1200;
const CHASE_REFERENCE_SPEED_MULTIPLIER = 1.5;
const LANDING_BOUNCE_DURATION_SECONDS = 0.4;
let playbackCursorLayerId = 0;

function chaseParticleLifetimeMs(speedMultiplier: number): number {
  const speed = Math.max(0.1, speedMultiplier);
  return Math.round((PLAYBACK_PARTICLE_LIFETIME_MS * CHASE_REFERENCE_SPEED_MULTIPLIER) / speed);
}

function playbackCursorLayerKey(rowIndex: number, staff: Staff): string {
  return `${rowIndex}:${staff}`;
}

function createPlaybackCursorLayer(
  rowGroup: SVGElement,
  rowIndex: number,
  staff: Staff
): PlaybackCursorLayer {
  const element = document.createElementNS(SVG_NAMESPACE, "g");
  element.setAttribute("class", `playback-cursor-layer is-${staff}-register`);
  element.setAttribute("data-playback-cursor-row", String(rowIndex));
  element.setAttribute("aria-hidden", "true");

  const instanceId = ++playbackCursorLayerId;
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  const ambientGradient = document.createElementNS(SVG_NAMESPACE, "radialGradient");
  ambientGradient.setAttribute("id", `song-playback-ambient-${instanceId}`);
  ambientGradient.setAttribute("cx", "50%");
  ambientGradient.setAttribute("cy", "50%");
  ambientGradient.setAttribute("r", "50%");
  const ambientStops =
    staff === "treble"
      ? [
          { color: "#fff0c9", offset: "0%", opacity: "0.76" },
          { color: "#ffb253", offset: "22%", opacity: "0.46" },
          { color: "#f39542", offset: "62%", opacity: "0.16" },
          { color: "#de7936", offset: "100%", opacity: "0" },
        ]
      : [
          { color: "#e8f7ff", offset: "0%", opacity: "0.76" },
          { color: "#62cfff", offset: "22%", opacity: "0.46" },
          { color: "#3c9be8", offset: "62%", opacity: "0.16" },
          { color: "#3676cb", offset: "100%", opacity: "0" },
        ];
  ambientStops.forEach(({ color, offset, opacity }) => {
    const stop = document.createElementNS(SVG_NAMESPACE, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    stop.setAttribute("stop-opacity", opacity);
    ambientGradient.appendChild(stop);
  });
  defs.appendChild(ambientGradient);

  const glowFilter = document.createElementNS(SVG_NAMESPACE, "filter");
  glowFilter.setAttribute("id", `song-playback-diffuse-${instanceId}`);
  glowFilter.setAttribute("x", "-100%");
  glowFilter.setAttribute("y", "-100%");
  glowFilter.setAttribute("width", "300%");
  glowFilter.setAttribute("height", "300%");
  glowFilter.setAttribute("color-interpolation-filters", "sRGB");
  const diffuseBlur = document.createElementNS(SVG_NAMESPACE, "feGaussianBlur");
  diffuseBlur.setAttribute("stdDeviation", "2.5");
  glowFilter.appendChild(diffuseBlur);
  defs.appendChild(glowFilter);

  const innerGlowFilter = document.createElementNS(SVG_NAMESPACE, "filter");
  innerGlowFilter.setAttribute("id", `song-playback-inner-${instanceId}`);
  innerGlowFilter.setAttribute("x", "-100%");
  innerGlowFilter.setAttribute("y", "-100%");
  innerGlowFilter.setAttribute("width", "300%");
  innerGlowFilter.setAttribute("height", "300%");
  const innerBlur = document.createElementNS(SVG_NAMESPACE, "feGaussianBlur");
  innerBlur.setAttribute("stdDeviation", "1");
  innerGlowFilter.appendChild(innerBlur);
  defs.appendChild(innerGlowFilter);
  element.appendChild(defs);

  const particleLayer = document.createElementNS(SVG_NAMESPACE, "g");
  particleLayer.setAttribute("class", "playback-cursor-particles");
  element.appendChild(particleLayer);

  const rippleLayer = document.createElementNS(SVG_NAMESPACE, "g");
  rippleLayer.setAttribute("class", "playback-cursor-ripples");
  element.appendChild(rippleLayer);

  const light = document.createElementNS(SVG_NAMESPACE, "g");
  light.setAttribute("class", "playback-cursor-light");
  const ambient = document.createElementNS(SVG_NAMESPACE, "ellipse");
  ambient.setAttribute("class", "playback-cursor-ambient");
  ambient.setAttribute("rx", "42");
  ambient.setAttribute("ry", "34");
  ambient.setAttribute("fill", `url(#song-playback-ambient-${instanceId})`);
  ambient.setAttribute("stroke", "none");
  ambient.setAttribute("stroke-width", "0");
  const diffuse = document.createElementNS(SVG_NAMESPACE, "ellipse");
  diffuse.setAttribute("class", "playback-cursor-diffuse");
  diffuse.setAttribute("rx", "9");
  diffuse.setAttribute("ry", "6");
  diffuse.setAttribute("filter", `url(#song-playback-diffuse-${instanceId})`);
  const innerGlow = document.createElementNS(SVG_NAMESPACE, "ellipse");
  innerGlow.setAttribute("class", "playback-cursor-inner-glow");
  innerGlow.setAttribute("rx", "5.5");
  innerGlow.setAttribute("ry", "3.8");
  innerGlow.setAttribute("filter", `url(#song-playback-inner-${instanceId})`);
  const core = document.createElementNS(SVG_NAMESPACE, "ellipse");
  core.setAttribute("class", "playback-cursor-core");
  core.setAttribute("rx", "2.6");
  core.setAttribute("ry", "1.8");
  element.appendChild(ambient);
  light.append(diffuse, innerGlow, core);
  element.appendChild(light);

  rowGroup.appendChild(element);
  return {
    ambient,
    core,
    diffuse,
    element,
    innerGlow,
    light,
    particleLayer,
    rippleLayer,
    rowIndex,
    staff,
  };
}

function setPlaybackCursorLayerVisibility(
  layer: PlaybackCursorLayer,
  isActive: boolean,
  preserveEffects = true
): void {
  const hasEffects =
    preserveEffects &&
    (layer.particleLayer.childElementCount > 0 || layer.rippleLayer.childElementCount > 0);
  layer.element.style.opacity = isActive || hasEffects ? "1" : "0";
  layer.light.style.opacity = isActive ? "1" : "0";
  if (!isActive) layer.ambient.style.opacity = "0";
}

function clearPlaybackCursorLayer(layer: PlaybackCursorLayer): void {
  setPlaybackCursorLayerVisibility(layer, false, false);
  if (layer.particleLayer.childElementCount > 0) layer.particleLayer.replaceChildren();
  if (layer.rippleLayer.childElementCount > 0) layer.rippleLayer.replaceChildren();
  layer.element.classList.remove("is-catching");
}

function noteHeadCursorPoints(staveNote: StaveNote): PlaybackCursorPoint[] {
  const yPositions = staveNote.getYs();
  return staveNote.noteHeads.flatMap((noteHead, noteHeadIndex) => {
    const y = yPositions[noteHeadIndex];
    if (!Number.isFinite(y)) return [];
    const rx = Math.max(2, noteHead.getWidth() / 2);
    // A NoteHead SVG group can include the stem; estimate the oval head's height from its glyph width.
    const ry = rx * 0.68;
    return [{ x: noteHead.getAbsoluteX() + rx, y: y as number, rx, ry }];
  });
}

function pointOnQuadraticArc(
  start: PlaybackCursorPoint,
  control: PlaybackCursorPoint,
  end: PlaybackCursorPoint,
  progress: number
): PlaybackCursorPoint {
  const inverse = 1 - progress;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * progress * control.x +
      progress * progress * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * progress * control.y +
      progress * progress * end.y,
    rx:
      inverse * inverse * start.rx +
      2 * inverse * progress * control.rx +
      progress * progress * end.rx,
    ry:
      inverse * inverse * start.ry +
      2 * inverse * progress * control.ry +
      progress * progress * end.ry,
  };
}

function pointWithLandingBounce(
  point: PlaybackCursorPoint,
  audioTime: number,
  arrivalAudioTime: number
): PlaybackCursorPoint {
  const elapsed = audioTime - arrivalAudioTime;
  if (elapsed <= 0 || elapsed >= LANDING_BOUNCE_DURATION_SECONDS) return point;

  const lift = Math.max(7, Math.min(12, point.ry * 2.6));
  const progress = elapsed / LANDING_BOUNCE_DURATION_SECONDS;
  const easedProgress = progress * progress * (3 - 2 * progress);
  const bounceProgress = Math.sin(Math.PI * easedProgress);

  return { ...point, y: point.y - lift * bounceProgress };
}

function pointOnBouncedArc(
  start: PlaybackCursorPoint,
  control: PlaybackCursorPoint,
  end: PlaybackCursorPoint,
  progress: number,
  startAudioTime: number,
  durationSeconds: number
): PlaybackCursorPoint {
  const pathPoint = pointOnQuadraticArc(start, control, end, progress);
  const sampleAudioTime = startAudioTime + durationSeconds * progress;
  // Keep emitted particles on the exact displayed path, including the cursor's landing bounce.
  return pointWithLandingBounce(pathPoint, sampleAudioTime, startAudioTime);
}

function sampledArcLengthBetween(
  start: PlaybackCursorPoint,
  control: PlaybackCursorPoint,
  end: PlaybackCursorPoint,
  startProgress: number,
  endProgress: number,
  startAudioTime: number,
  durationSeconds: number
): number {
  const sampleCount = Math.max(2, Math.ceil(Math.abs(endProgress - startProgress) * 16));
  let previousPoint = pointOnBouncedArc(
    start,
    control,
    end,
    startProgress,
    startAudioTime,
    durationSeconds
  );
  let length = 0;

  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const progress = startProgress + ((endProgress - startProgress) * sample) / sampleCount;
    const point = pointOnBouncedArc(start, control, end, progress, startAudioTime, durationSeconds);
    length += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    previousPoint = point;
  }

  return length;
}

function spawnPlaybackArcParticles(
  layer: PlaybackCursorLayer,
  start: PlaybackCursorPoint,
  control: PlaybackCursorPoint,
  end: PlaybackCursorPoint,
  startProgress: number,
  endProgress: number,
  maxParticlesThisFrame: number,
  maxParticles: number,
  startAudioTime: number,
  durationSeconds: number,
  currentAudioTime: number,
  lifetimeMs?: number
): boolean {
  const arcLength = sampledArcLengthBetween(
    start,
    control,
    end,
    startProgress,
    endProgress,
    startAudioTime,
    durationSeconds
  );
  if (arcLength < 1.8) return false;

  const particleSteps = Math.min(maxParticlesThisFrame, Math.ceil(arcLength / 1.8));
  for (let step = 1; step <= particleSteps; step += 1) {
    const progress = startProgress + ((endProgress - startProgress) * step) / particleSteps;
    const particleAudioTime = startAudioTime + durationSeconds * progress;
    const ageMs = Math.max(0, (currentAudioTime - particleAudioTime) * 1000);
    spawnPlaybackParticle(
      layer,
      pointOnBouncedArc(start, control, end, progress, startAudioTime, durationSeconds),
      maxParticles,
      lifetimeMs,
      ageMs
    );
  }
  return true;
}

function spawnPlaybackRipple(layer: PlaybackCursorLayer, point: PlaybackCursorPoint): void {
  const ripple = document.createElementNS(SVG_NAMESPACE, "circle");
  ripple.setAttribute("class", "playback-cursor-ripple");
  ripple.setAttribute("cx", point.x.toFixed(2));
  ripple.setAttribute("cy", point.y.toFixed(2));
  ripple.setAttribute("r", "2");
  ripple.setAttribute("vector-effect", "non-scaling-stroke");
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  layer.rippleLayer.appendChild(ripple);
}

function spawnPlaybackParticle(
  layer: PlaybackCursorLayer,
  point: PlaybackCursorPoint,
  maxParticles: number,
  lifetimeMs = PLAYBACK_PARTICLE_LIFETIME_MS,
  ageMs = 0
): void {
  if (ageMs >= lifetimeMs) return;
  while (layer.particleLayer.childElementCount >= maxParticles) {
    layer.particleLayer.firstElementChild?.remove();
  }
  const particle = document.createElementNS(SVG_NAMESPACE, "circle");
  particle.setAttribute("class", "playback-cursor-particle");
  particle.setAttribute("cx", point.x.toFixed(2));
  particle.setAttribute("cy", point.y.toFixed(2));
  particle.setAttribute("r", "1.15");
  particle.style.animationDuration = `${lifetimeMs}ms`;
  if (ageMs > 0) particle.style.animationDelay = `-${ageMs}ms`;
  particle.addEventListener("animationend", () => particle.remove(), { once: true });
  layer.particleLayer.appendChild(particle);
}

function setEllipsePosition(ellipse: SVGEllipseElement, point: PlaybackCursorPoint): void {
  ellipse.setAttribute("cx", point.x.toFixed(2));
  ellipse.setAttribute("cy", point.y.toFixed(2));
}

function setEllipsePoint(
  ellipse: SVGEllipseElement,
  point: PlaybackCursorPoint,
  paddingX = 0,
  paddingY = 0
): void {
  setEllipsePosition(ellipse, point);
  ellipse.setAttribute("rx", (point.rx + paddingX).toFixed(2));
  ellipse.setAttribute("ry", (point.ry + paddingY).toFixed(2));
}

function playbackEventKey(rowIndex: number, eventIndices: readonly number[]): string {
  return `${rowIndex}:${eventIndices.join(",")}`;
}

function basePlaybackTrailCount(): number {
  if (typeof navigator === "undefined") return 3;
  const isIPad =
    /iPad/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isIPad || (deviceMemory !== undefined && deviceMemory <= 4) ? 1 : 3;
}

function playbackAmbientPulse(audioTime: number, staff: Staff): string {
  const phase = staff === "bass" ? Math.PI : 0;
  const pulse = 0.68 + ((Math.sin(audioTime * Math.PI * 1.6 + phase) + 1) / 2) * 0.14;
  return pulse.toFixed(3);
}

function setPlaybackHighlight(
  staff: Staff,
  nextEventIndices: readonly number[],
  activeEventIndicesRef: { current: Record<Staff, readonly number[]> },
  noteHeadElements: Map<number, PlaybackNoteHeadElements>
): void {
  const activeClass = `is-playback-active-note-${staff}`;
  const previousIndices = activeEventIndicesRef.current[staff];
  previousIndices.forEach((eventIndex) =>
    noteHeadElements.get(eventIndex)?.[staff]?.forEach((element) => {
      element.classList.remove("is-playback-active-note", activeClass);
    })
  );
  nextEventIndices.forEach((eventIndex) =>
    noteHeadElements.get(eventIndex)?.[staff]?.forEach((element) => {
      element.classList.add("is-playback-active-note", activeClass);
    })
  );
  activeEventIndicesRef.current[staff] = nextEventIndices;
}

function flashPlaybackNoteHighlight(
  staff: Staff,
  eventIndices: readonly number[],
  noteHeadElements: Map<number, PlaybackNoteHeadElements>
): void {
  eventIndices.forEach((eventIndex) => {
    noteHeadElements.get(eventIndex)?.[staff]?.forEach((element) => {
      const landedClass = `is-playback-landed-note-${staff}`;
      element.classList.add(landedClass);
      const onAnimationEnd = (event: AnimationEvent): void => {
        if (event.target !== element || event.animationName !== `playback-note-landed-${staff}`)
          return;
        element.classList.remove(landedClass);
        element.removeEventListener("animationend", onAnimationEnd);
      };
      element.addEventListener("animationend", onAnimationEnd);
    });
  });
}

function chunkNoteGroups(
  noteGroups: readonly (readonly TargetNote[])[],
  notesPerRow: number,
  maxRowCount: number
): TargetNote[][][] {
  const rows: TargetNote[][][] = [];
  for (let index = 0; index < noteGroups.length; index += notesPerRow) {
    rows.push(noteGroups.slice(index, index + notesPerRow).map((group) => [...group]));
  }
  return rows.slice(0, maxRowCount);
}

function makeStaveNote(
  noteOrNotes: TargetNote | readonly TargetNote[],
  color: string,
  noteDuration: StaffPageNoteDuration
): StaveNote {
  const notes = Array.isArray(noteOrNotes) ? noteOrNotes : [noteOrNotes];
  const note = notes[0];
  if (!note) throw new Error("A staff note needs at least one pitch");
  const vexDuration = STAFF_VEX_DURATIONS[noteDuration];
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: vexDuration,
    keys: notes.map(noteToVexKey),
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  notes.forEach((chordNote, index) => {
    staveNote.setKeyStyle(index, { fillStyle: color, strokeStyle: color });
    if (chordNote.accidental) {
      staveNote.addModifier(new Accidental(chordNote.accidental === "sharp" ? "#" : "b"), index);
    }
  });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

function makeStaffGhostNote(noteDuration: StaffPageNoteDuration): GhostNote {
  const ghostNote = new GhostNote(STAFF_VEX_DURATIONS[noteDuration]);
  if (noteDuration === "triplet-eighth" || noteDuration === "triplet-half") {
    ghostNote.applyTickMultiplier(2, 3);
  }
  return ghostNote;
}

const STAFF_REST_DURATIONS: readonly {
  beats: number;
  duration: StaffPageNoteDuration;
  tuplet?: readonly [number, number];
}[] = [
  { beats: 4, duration: "whole" },
  { beats: 3, duration: "dotted-half" },
  { beats: 2, duration: "half" },
  { beats: 1.5, duration: "dotted-quarter" },
  { beats: 1, duration: "quarter" },
  { beats: 0.75, duration: "dotted-eighth" },
  { beats: 2 / 3, duration: "quarter", tuplet: [2, 3] },
  { beats: 0.5, duration: "eighth" },
  { beats: 0.375, duration: "dotted-sixteenth" },
  { beats: 1 / 3, duration: "eighth", tuplet: [2, 3] },
  { beats: 0.25, duration: "sixteenth" },
  { beats: 0.125, duration: "thirty-second" },
  { beats: 0.0625, duration: "sixty-fourth" },
];

function makeStaveRest(
  duration: StaffPageNoteDuration,
  staff: "treble" | "bass",
  stave: Stave,
  tuplet?: readonly [number, number]
): StaveNote {
  const rest = new StaveNote({
    clef: staff,
    duration: `${STAFF_VEX_DURATIONS[duration]}r`,
    keys: [staff === "treble" ? "b/4" : "d/3"],
  }).setStave(stave);
  if (tuplet) rest.applyTickMultiplier(tuplet[0], tuplet[1]);
  return rest;
}

function makeStaveRestsForGap(
  gapBeats: number,
  startBeat: number,
  beatsPerMeasure: number | undefined,
  staff: "treble" | "bass",
  stave: Stave
): StaveNote[] {
  const rests: StaveNote[] = [];
  const epsilon = 0.001;
  let cursor = startBeat;
  let remaining = gapBeats;
  while (remaining > epsilon) {
    const nextBarline =
      beatsPerMeasure && beatsPerMeasure > 0
        ? (Math.floor(cursor / beatsPerMeasure) + 1) * beatsPerMeasure
        : Number.POSITIVE_INFINITY;
    const segmentBeats = Math.min(remaining, nextBarline - cursor);
    let segmentRemaining = segmentBeats;
    while (segmentRemaining > epsilon) {
      const restDuration = STAFF_REST_DURATIONS.find(
        (candidate) => candidate.beats <= segmentRemaining + epsilon
      );
      if (!restDuration) break;
      rests.push(makeStaveRest(restDuration.duration, staff, stave, restDuration.tuplet));
      segmentRemaining -= restDuration.beats;
    }
    const consumed = segmentBeats - segmentRemaining;
    if (consumed <= epsilon) break;
    cursor += consumed;
    remaining -= consumed;
  }
  return rests;
}

function makeStaffGhostsForGap(
  gapBeats: number,
  startBeat: number,
  beatsPerMeasure: number | undefined,
  stave: Stave
): GhostNote[] {
  const ghosts: GhostNote[] = [];
  const epsilon = 0.001;
  let cursor = startBeat;
  let remaining = gapBeats;
  while (remaining > epsilon) {
    const nextBarline =
      beatsPerMeasure && beatsPerMeasure > 0
        ? (Math.floor(cursor / beatsPerMeasure) + 1) * beatsPerMeasure
        : Number.POSITIVE_INFINITY;
    const segmentBeats = Math.min(remaining, nextBarline - cursor);
    let segmentRemaining = segmentBeats;
    while (segmentRemaining > epsilon) {
      const duration = STAFF_REST_DURATIONS.find(
        (candidate) => candidate.beats <= segmentRemaining + epsilon
      );
      if (!duration) break;
      const ghost = makeStaffGhostNote(duration.duration).setStave(stave);
      if (duration.tuplet) ghost.applyTickMultiplier(duration.tuplet[0], duration.tuplet[1]);
      ghosts.push(ghost);
      segmentRemaining -= duration.beats;
    }
    const consumed = segmentBeats - segmentRemaining;
    if (consumed <= epsilon) break;
    cursor += consumed;
    remaining -= consumed;
  }
  return ghosts;
}

function padStaffTickablesToDuration(
  tickables: readonly StaffPageTickable[],
  targetTicks: number,
  staff: "treble" | "bass",
  stave: Stave,
  rowOnsets?: readonly (number | undefined)[],
  beatsPerMeasure?: number,
  useInvisiblePadding = false
): StaffPageTickable[] {
  const usedTicks = tickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0);
  const ticksPerQuarter = new Voice({ numBeats: 1, beatValue: 4 }).getTotalTicks().value();
  const missingBeats = (targetTicks - usedTicks) / ticksPerQuarter;
  if (missingBeats <= 0.001) return [...tickables];

  const firstOnset = rowOnsets?.find((onset): onset is number => onset !== undefined) ?? 0;
  const rowStartBeat =
    beatsPerMeasure && beatsPerMeasure > 0
      ? Math.floor(firstOnset / beatsPerMeasure) * beatsPerMeasure
      : firstOnset;
  return [
    ...tickables,
    ...(useInvisiblePadding
      ? makeStaffGhostsForGap(
          missingBeats,
          rowStartBeat + usedTicks / ticksPerQuarter,
          beatsPerMeasure,
          stave
        )
      : makeStaveRestsForGap(
          missingBeats,
          rowStartBeat + usedTicks / ticksPerQuarter,
          beatsPerMeasure,
          staff,
          stave
        )),
  ];
}

function assignStaffVoiceLanes(
  rowGroups: readonly (readonly TargetNote[])[],
  noteDurations: readonly StaffPageNoteDuration[],
  noteOnsets?: readonly (number | undefined)[]
): number[][] {
  const laneEndBeats: number[] = [];
  const lanes: number[][] = [];

  rowGroups.forEach((group, slotIndex) => {
    if (group.length === 0) return;
    const onset = noteOnsets?.[slotIndex];
    let laneIndex =
      noteOnsets && onset !== undefined
        ? laneEndBeats.findIndex((endBeat) => endBeat <= onset + 0.001)
        : 0;
    if (laneIndex < 0) laneIndex = laneEndBeats.length;
    if (!lanes[laneIndex]) lanes[laneIndex] = [];
    lanes[laneIndex]!.push(slotIndex);
    laneEndBeats[laneIndex] =
      (onset ?? laneEndBeats[laneIndex] ?? 0) + quarterBeatsForDuration(noteDurations[slotIndex]!);
  });

  return lanes;
}

function getLaneBeamOptions(
  options:
    | {
        barlineAfterNoteIndices?: readonly number[];
        breakBeamsAtStaffChange?: boolean;
        measures: readonly (number | undefined)[];
        noteDurations: readonly StaffPageNoteDuration[];
        noteOnsets: readonly (number | undefined)[];
        noteBeamGroups?: readonly (number | undefined)[];
        rowStartIndex: number;
      }
    | undefined,
  laneIndices: readonly number[]
): Parameters<typeof makeStaffPageBeams>[5] {
  if (!options) return undefined;
  return {
    barlineAfterNoteIndices: laneIndices.flatMap((slotIndex, laneIndex) =>
      laneIndex < laneIndices.length - 1 &&
      options.barlineAfterNoteIndices?.includes(options.rowStartIndex + slotIndex)
        ? [laneIndex]
        : []
    ),
    breakBeamsAtStaffChange: false,
    measures: laneIndices.map((slotIndex) => options.measures[slotIndex]),
    noteBeamGroups: options.noteBeamGroups
      ? laneIndices.map((slotIndex) => options.noteBeamGroups![slotIndex])
      : undefined,
    noteDurations: laneIndices.map((slotIndex) => options.noteDurations[slotIndex]!),
    noteOnsets: laneIndices.map((slotIndex) => options.noteOnsets[slotIndex]),
    rowStartIndex: 0,
  };
}

function expandTiedDurations(
  rowGroups: readonly (readonly TargetNote[])[],
  primaryTickables: readonly StaffPageTickable[],
  noteDurations: readonly StaffPageNoteDuration[],
  getColor: (slotIndex: number) => string,
  noteOnsets?: readonly number[],
  beatsPerMeasure?: number,
  staff: Staff = "treble",
  monophonicGrandStaff = false,
  useInvisibleGapRests = false
): { ties: StaveTie[]; tickables: StaffPageTickable[] } {
  const tickables: StaffPageTickable[] = [];
  const ties: StaveTie[] = [];
  let cursorBeat =
    noteOnsets?.[0] !== undefined && beatsPerMeasure && beatsPerMeasure > 0
      ? Math.floor(noteOnsets[0] / beatsPerMeasure) * beatsPerMeasure
      : (noteOnsets?.[0] ?? 0);
  rowGroups.forEach((noteGroup, slotIndex) => {
    const primary = primaryTickables[slotIndex];
    const noteOnset = noteOnsets?.[slotIndex];
    if (noteOnsets && noteGroup.length === 0 && !monophonicGrandStaff) return;
    if (noteOnsets && noteOnset !== undefined && noteOnset > cursorBeat + 0.001) {
      const gapFillers =
        monophonicGrandStaff || useInvisibleGapRests
          ? makeStaffGhostsForGap(
              noteOnset - cursorBeat,
              cursorBeat,
              beatsPerMeasure,
              primary.getStave()!
            )
          : makeStaveRestsForGap(
              noteOnset - cursorBeat,
              cursorBeat,
              beatsPerMeasure,
              staff,
              primary.getStave()!
            );
      tickables.push(...gapFillers);
    }
    tickables.push(primary);
    if (noteDurations[slotIndex] === "quarter-plus-sixteenth") {
      if (noteGroup.length > 0 && primary instanceof StaveNote) {
        const continuation = makeStaveNote(noteGroup, getColor(slotIndex), "sixteenth").setStave(
          primary.getStave()!
        );
        tickables.push(continuation);
        ties.push(
          new StaveTie({
            firstIndexes: noteGroup.map((_, index) => index),
            firstNote: primary,
            lastIndexes: noteGroup.map((_, index) => index),
            lastNote: continuation,
          })
        );
      } else if (primary instanceof GhostNote) {
        tickables.push(new GhostNote("16").setStave(primary.getStave()!));
      }
    }
    if (noteOnsets && noteOnset !== undefined) {
      cursorBeat = Math.max(
        cursorBeat,
        noteOnset + quarterBeatsForDuration(noteDurations[slotIndex])
      );
    }
  });
  return { ties, tickables };
}

function colorForIndex(
  index: number,
  completedCount: number,
  completedNoteIndices: readonly number[] | undefined,
  wrongIndex: number | undefined,
  activePairStartIndex: number | undefined,
  palette: StaffPagePalette
): string {
  if (index === wrongIndex) {
    return palette.error;
  }
  if (completedNoteIndices ? completedNoteIndices.includes(index) : index < completedCount) {
    return palette.complete;
  }
  if (activePairStartIndex !== undefined && index === activePairStartIndex) {
    return palette.active;
  }
  return palette.ink;
}

function updateRenderedNoteColor(renderedNote: RenderedStaffPageNote, color: string): void {
  if (renderedNote.color === color) {
    return;
  }
  const elements = [
    renderedNote.element,
    ...renderedNote.element.querySelectorAll<SVGElement>("*"),
  ];
  for (const element of elements) {
    for (const attribute of ["fill", "stroke"] as const) {
      const value = element.getAttribute(attribute);
      if (value?.toLowerCase() === renderedNote.color.toLowerCase()) {
        element.setAttribute(attribute, color);
      }
    }
  }
  renderedNote.element.setAttribute("fill", color);
  renderedNote.element.setAttribute("stroke", color);
  renderedNote.color = color;
}

function addStaffProgressMarker(
  parent: SVGElement,
  noteIndex: number,
  x: number,
  topY: number,
  bottomY: number,
  type: "practice" | "playback",
  width: number
): void {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const offset = type === "practice" ? -width * 0.22 : width * 0.22;
  marker.setAttribute("class", `staff-page-progress-marker is-${type}`);
  marker.setAttribute("data-staff-progress-marker", "");
  marker.setAttribute("data-progress-type", type);
  marker.setAttribute("data-note-index", String(noteIndex));
  marker.setAttribute("x", (x - width / 2 + offset).toFixed(2));
  marker.setAttribute("y", topY.toFixed(2));
  marker.setAttribute("width", width.toFixed(2));
  marker.setAttribute("height", Math.max(0, bottomY - topY).toFixed(2));
  marker.setAttribute("opacity", "0");
  marker.setAttribute("aria-hidden", "true");
  parent.appendChild(marker);
}

function updateStaffProgressMarkers(
  rendererTarget: HTMLDivElement | null,
  practiceIndex: number,
  playbackIndex: number | null
): void {
  if (!rendererTarget) return;
  rendererTarget
    .querySelectorAll<SVGRectElement>("[data-staff-progress-marker]")
    .forEach((marker) => {
      const noteIndex = Number(marker.getAttribute("data-note-index"));
      const type = marker.getAttribute("data-progress-type");
      const active =
        type === "practice"
          ? noteIndex === practiceIndex
          : type === "playback" && playbackIndex !== null && noteIndex === playbackIndex;
      marker.setAttribute("opacity", active ? (type === "practice" ? "0.32" : "0.34") : "0");
    });
}

function makeStaffPageBeams(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDuration: PromptNoteDuration,
  visibleYBounds: { bottomY: number; topY: number },
  neutralColor: string,
  options?: {
    barlineAfterNoteIndices?: readonly number[];
    breakBeamsAtStaffChange?: boolean;
    noteBeamGroups?: readonly (number | undefined)[];
    measures: readonly (number | undefined)[];
    noteDurations: readonly StaffPageNoteDuration[];
    noteOnsets: readonly (number | undefined)[];
    rowStartIndex: number;
  }
): Beam[] {
  let beamRuns = getStaffPageBeamRuns(rowSlots, noteDuration);
  if (options) {
    beamRuns = [];
    let runStart: number | undefined;
    const closeRun = (endIndex: number): void => {
      if (runStart !== undefined && endIndex - runStart >= 2) {
        beamRuns.push({ size: endIndex - runStart, startIndex: runStart });
      }
      runStart = undefined;
    };

    for (let index = 0; index <= rowSlots.length; index += 1) {
      const duration = options.noteDurations[index];
      const isBeamable =
        index < rowSlots.length &&
        rowSlots[index] !== undefined &&
        (duration === "eighth" ||
          duration === "dotted-eighth" ||
          duration === "triplet-eighth" ||
          duration === "sixteenth" ||
          duration === "dotted-sixteenth" ||
          duration === "thirty-second" ||
          duration === "sixty-fourth");
      if (!isBeamable) {
        closeRun(index);
        continue;
      }

      if (runStart !== undefined) {
        const previousIndex = index - 1;
        const sameMeasure = options.measures[index] === options.measures[previousIndex];
        const sameBeamGroup =
          options.noteBeamGroups === undefined ||
          options.noteBeamGroups[index] === options.noteBeamGroups[previousIndex];
        const previousBarline = options.barlineAfterNoteIndices?.includes(
          options.rowStartIndex + previousIndex
        );
        const staffChanged =
          options.breakBeamsAtStaffChange &&
          rowSlots[index]?.staff !== rowSlots[previousIndex]?.staff;
        const onsetGap =
          (options.noteOnsets[index] ?? 0) - (options.noteOnsets[previousIndex] ?? 0);
        const expectedGap = quarterBeatsForDuration(options.noteDurations[previousIndex]);
        if (
          !sameMeasure ||
          !sameBeamGroup ||
          previousBarline ||
          // Single-note mixed passages must begin a new beam when they move between staves.
          staffChanged ||
          onsetGap <= 0 ||
          onsetGap > expectedGap + 0.03
        ) {
          closeRun(index);
        }
      }
      runStart ??= index;
    }
  }

  return beamRuns.flatMap(({ size, startIndex }) => {
    const groupNotes = rowSlots.slice(startIndex, startIndex + size);
    const tickables = rowTickables.slice(startIndex, startIndex + size);
    if (
      !groupNotes.every((note): note is TargetNote => note !== undefined) ||
      !tickables.every((tickable) => tickable instanceof StaveNote)
    ) {
      return [];
    }
    const staveNotes = tickables as StaveNote[];
    const isCrossStaff = groupNotes.some((note) => note.staff !== groupNotes[0].staff);
    const noteYs = staveNotes.map((staveNote) => ({ y: staveNote.getYs()[0] }));
    const preferredDirection =
      getVisibleBeamStemDirection(noteYs, visibleYBounds, Stem.HEIGHT) ??
      (isCrossStaff ? getCrossStaffOuterStemDirection(noteYs) : undefined);
    const stemDirection =
      preferredDirection === undefined
        ? undefined
        : preferredDirection === "up"
          ? Stem.UP
          : Stem.DOWN;
    const beams = Beam.generateBeams(
      staveNotes,
      stemDirection === undefined ? {} : { stemDirection }
    );
    return beams.map((beam) =>
      beam.setStyle({ fillStyle: neutralColor, strokeStyle: neutralColor })
    );
  });
}

function makeStaffPageTuplets(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDurations: readonly StaffPageNoteDuration[],
  measures: readonly (number | undefined)[]
): Tuplet[] {
  const tuplets: Tuplet[] = [];
  const isTripletDuration = (duration: StaffPageNoteDuration): boolean =>
    duration === "triplet-eighth" || duration === "triplet-half";

  for (let index = 0; index < rowSlots.length;) {
    const firstNote = rowSlots[index];
    const firstTickable = rowTickables[index];
    if (
      !firstNote ||
      !(firstTickable instanceof StaveNote) ||
      !isTripletDuration(noteDurations[index])
    ) {
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (
      runEnd < rowSlots.length &&
      rowSlots[runEnd]?.staff === firstNote.staff &&
      measures[runEnd] === measures[index] &&
      isTripletDuration(noteDurations[runEnd]) &&
      rowTickables[runEnd] instanceof StaveNote
    ) {
      runEnd += 1;
    }

    const runLength = runEnd - index;
    let groupedCount = 0;
    if (runLength >= 3) {
      groupedCount = Math.floor(runLength / 3) * 3;
      for (let groupStart = index; groupStart < index + groupedCount; groupStart += 3) {
        const group = rowTickables.slice(groupStart, groupStart + 3);
        if (group.every((tickable): tickable is StaveNote => tickable instanceof StaveNote)) {
          tuplets.push(
            new Tuplet(group, {
              bracketed: true,
              notesOccupied: 2,
              numNotes: 3,
              ratioed: false,
            })
          );
        }
      }
    }

    for (let ungroupedIndex = index + groupedCount; ungroupedIndex < runEnd; ungroupedIndex += 1) {
      const tickable = rowTickables[ungroupedIndex];
      if (tickable instanceof StaveNote) tickable.applyTickMultiplier(2, 3);
    }
    index = runEnd;
  }

  return tuplets;
}

function addBarline(parent: SVGElement, x: number, y1: number, y2: number, color: string): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "staff-page-barline");
  line.setAttribute("x1", x.toFixed(2));
  line.setAttribute("x2", x.toFixed(2));
  line.setAttribute("y1", y1.toFixed(2));
  line.setAttribute("y2", y2.toFixed(2));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("shape-rendering", "crispEdges");
  parent.appendChild(line);
}

function addStaffPageLyric(
  parent: SVGElement,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string
): void {
  const lyric = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lyric.setAttribute("class", "staff-page-lyric");
  lyric.setAttribute("x", x.toFixed(2));
  lyric.setAttribute("y", y.toFixed(2));
  lyric.setAttribute("font-size", fontSize.toFixed(2));
  lyric.setAttribute("fill", color);
  lyric.setAttribute("text-anchor", "middle");
  lyric.setAttribute("dominant-baseline", "middle");
  lyric.textContent = text;
  parent.appendChild(lyric);
}

function getBarlineX(
  nextTickable: StaffPageTickable,
  previousNote: StaveNote | undefined,
  nextNote: StaveNote | undefined
): number | undefined {
  if (!previousNote) {
    return undefined;
  }
  const previousBounds = previousNote.getBoundingBox();
  const nextBounds = nextNote?.getBoundingBox();
  return getBarlineGapCenter(
    previousBounds.getX() + previousBounds.getW(),
    nextBounds?.getX() ?? nextTickable.getAbsoluteX()
  );
}

function alignRowNotesEvenly(
  tickables: readonly StaffPageTickable[],
  noteCount: number,
  noteArea: { left: number; right: number }
): void {
  const notesToAlign = tickables
    .slice(0, noteCount)
    .filter((tickable): tickable is StaveNote => tickable instanceof StaveNote);
  alignStaveNotesToCenters(
    notesToAlign,
    getEvenlySpacedCenters(notesToAlign.length, noteArea.left, noteArea.right)
  );
}

function quarterBeatsForDuration(duration: StaffPageNoteDuration): number {
  if (duration === "whole") return 4;
  if (duration === "dotted-whole") return 6;
  if (duration === "half") return 2;
  if (duration === "dotted-half") return 3;
  if (duration === "quarter") return 1;
  if (duration === "quarter-plus-sixteenth") return 1.25;
  if (duration === "dotted-quarter") return 1.5;
  if (duration === "double-dotted-quarter") return 1.75;
  if (duration === "triplet-half") return 4 / 3;
  if (duration === "eighth") return 0.5;
  if (duration === "dotted-eighth") return 0.75;
  if (duration === "triplet-eighth") return 1 / 3;
  if (duration === "dotted-sixteenth") return 0.375;
  if (duration === "thirty-second") return 0.125;
  if (duration === "sixty-fourth") return 0.0625;
  return 0.25;
}

function createVoiceOptions(tickableGroups: readonly (readonly StaffPageTickable[])[]): {
  beatValue: number;
  numBeats: number;
} {
  const ticksPerQuarter = new Voice({ numBeats: 1, beatValue: 4 }).getTotalTicks().value();
  const maxTicks = Math.max(
    0,
    ...tickableGroups.map((tickables) =>
      tickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0)
    )
  );
  // Size the strict Voice from the actual VexFlow tickables (after tuplets and
  // tied-note continuations have been applied), with a small rounding margin.
  const numBeats = Math.ceil((maxTicks / ticksPerQuarter) * 1024) / 1024;
  return { beatValue: 4, numBeats };
}

export function StaffPagePrompt({
  barlineAfterNoteIndices,
  diagnosticSampleId,
  notes,
  noteGroups,
  lyrics,
  noteMeasures,
  noteOnsets,
  noteBeamGroups,
  beatsPerMeasure,
  timeSignature,
  completedCount,
  completedNoteIndices,
  activePairStartIndex,
  isScrolling = false,
  noteDuration,
  noteDurations,
  staffNoteDurations,
  layout = PRACTICE_PAGE_STAFF_LAYOUT,
  scrollDurationMs = 0,
  staffNotationMode,
  useLedgerGap,
  distributeNotesEvenly = false,
  notesPerRow = layout.multirow.notesPerRow,
  maxRowCount = layout.multirow.rows + 1,
  scrollRowCount = 1,
  minDisplayWidthPx = layout.width.minPx,
  visibleRowCount = layout.multirow.rows,
  virtualizeRows = false,
  isFiniteScore = false,
  followRowIndex,
  trackedNoteIndex,
  onTrackedNoteVisibilityChange,
  breakBeamsAtStaffChange = false,
  monophonicGrandStaff = false,
  useInvisibleGapRests = false,
  showGrandStaffRightConnector = true,
  onToggleRowPlayback,
  playingRowIndex = null,
  playbackProgressIndex = null,
  playbackCursor = null,
  chaseCursor = null,
  cursorIndexOffset = 0,
  getAudioTime,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const [virtualRowWindow, setVirtualRowWindow] = useState({ start: 0, end: 6 });
  const [rowPlaybackButtonCenters, setRowPlaybackButtonCenters] = useState<readonly number[]>([]);
  const [playbackFollowDelayComplete, setPlaybackFollowDelayComplete] = useState(true);
  const lastManualScrollAtRef = useRef(0);
  const manualScrollAwayRef = useRef(false);
  const previousFollowRowIndexRef = useRef<number | undefined>(undefined);
  const previousPlayingRowIndexRef = useRef<number | null>(null);
  const pendingPlaybackFollowRef = useRef(false);
  const playbackFollowDelayTimerRef = useRef<number | null>(null);
  const autoScrollAnimationFrameRef = useRef(0);
  const trackedNoteIndexRef = useRef(trackedNoteIndex);
  const onTrackedNoteVisibilityChangeRef = useRef(onTrackedNoteVisibilityChange);
  const diagnosticSampleIdRef = useRef(diagnosticSampleId);
  const completedCountRef = useRef(completedCount);
  const completedNoteIndicesRef = useRef(completedNoteIndices);
  const activePairStartIndexRef = useRef(activePairStartIndex);
  const playbackProgressIndexRef = useRef(playbackProgressIndex);
  const playbackCursorRef = useRef(playbackCursor);
  const chaseCursorRef = useRef(chaseCursor);
  const getAudioTimeRef = useRef(getAudioTime);
  const renderedNotesRef = useRef<Array<RenderedStaffPageNote | undefined>>([]);
  const cursorLayersRef = useRef(new Map<string, PlaybackCursorLayer>());
  const cursorTargetsRef = useRef(new Map<number, PlaybackCursorTargets>());
  const cursorRowsRef = useRef(new Map<number, number>());
  const trackedNoteHeadElementsRef = useRef(new Map<number, SVGElement[]>());
  const playbackNoteHeadElementsRef = useRef(new Map<number, PlaybackNoteHeadElements>());
  const activePlaybackEventIndicesRef = useRef<Record<Staff, readonly number[]>>({
    treble: [],
    bass: [],
  });
  const lastLandedEventKeysRef = useRef(new Map<Staff, string>());
  const wrongIndexRef = useRef(wrongIndex);
  const isNightMode = useNightMode();
  const cursorAnimationEnabled =
    getAudioTime !== undefined && (playbackCursor !== null || chaseCursor !== null);
  const palette = useMemo<StaffPagePalette>(
    () => ({
      active: isNightMode ? "#77c8ba" : "#256f67",
      complete: isNightMode ? "#78c994" : COMPLETE_COLOR,
      error: isNightMode ? "#f18476" : WRONG_COLOR,
      ink: isNightMode ? "#bcc6be" : NEUTRAL_COLOR,
    }),
    [isNightMode]
  );
  diagnosticSampleIdRef.current = diagnosticSampleId;
  completedCountRef.current = completedCount;
  completedNoteIndicesRef.current = completedNoteIndices;
  activePairStartIndexRef.current = activePairStartIndex;
  playbackProgressIndexRef.current = playbackProgressIndex;
  playbackCursorRef.current = playbackCursor;
  chaseCursorRef.current = chaseCursor;
  getAudioTimeRef.current = getAudioTime;
  trackedNoteIndexRef.current = trackedNoteIndex;
  onTrackedNoteVisibilityChangeRef.current = onTrackedNoteVisibilityChange;
  wrongIndexRef.current = wrongIndex;
  const rows = useMemo(
    () => chunkNoteGroups(noteGroups ?? notes.map((note) => [note]), notesPerRow, maxRowCount),
    [maxRowCount, noteGroups, notes, notesPerRow]
  );
  const cursorRowsKey = useMemo(() => {
    if (!virtualizeRows) return "";
    const rowIndices = new Set<number>();
    const addEvents = (eventIndices: readonly number[] | null | undefined): void => {
      eventIndices?.forEach((eventIndex) => {
        const localIndex = eventIndex - cursorIndexOffset;
        if (localIndex >= 0) rowIndices.add(Math.floor(localIndex / notesPerRow));
      });
    };
    (
      Object.values(playbackCursor?.staffCursors ?? {}) as NonNullable<
        ScorePlaybackCursor["staffCursors"][Staff]
      >[]
    ).forEach((staffCursor) => {
      rowIndices.add(staffCursor.rowIndex);
      addEvents(staffCursor.currentEventIndices);
      addEvents(staffCursor.nextEventIndices);
    });
    (
      Object.values(chaseCursor?.staffCursors ?? {}) as NonNullable<
        ScoreChaseCursor["staffCursors"][Staff]
      >[]
    ).forEach((staffCursor) => {
      addEvents(staffCursor.currentEventIndices);
      addEvents(staffCursor.nextEventIndices);
    });
    return [...rowIndices]
      .filter((rowIndex) => rowIndex >= 0)
      .sort((left, right) => left - right)
      .join(",");
  }, [chaseCursor, cursorIndexOffset, notesPerRow, playbackCursor, virtualizeRows]);
  const cursorRowsToRender = useMemo(
    () => (cursorRowsKey ? cursorRowsKey.split(",").map(Number) : []),
    [cursorRowsKey]
  );
  const visiblePlaybackRows = rows.slice(0, Math.max(1, Math.min(visibleRowCount, rows.length)));

  useEffect(() => {
    if (!virtualizeRows) return undefined;
    const frame = frameRef.current;
    if (!frame) return undefined;

    let animationFrameId = 0;
    const syncVisibleRows = (): void => {
      animationFrameId = 0;
      const currentFrame = frameRef.current;
      if (!currentFrame) return;
      const scrollViewport = currentFrame.closest<HTMLElement>(".staff-page-scroll-viewport");
      const usesNestedScroll =
        scrollViewport !== null && scrollViewport.scrollHeight > scrollViewport.clientHeight + 1;
      const viewportTop = usesNestedScroll ? scrollViewport.getBoundingClientRect().top : 0;
      const viewportBottom = usesNestedScroll
        ? scrollViewport.getBoundingClientRect().bottom
        : window.innerHeight;
      const frameTop = currentFrame.getBoundingClientRect().top;
      const localTop = Math.max(0, viewportTop - frameTop);
      const localBottom = Math.max(localTop + 1, viewportBottom - frameTop);
      const containerWidth =
        rendererTargetRef.current?.clientWidth || currentFrame.clientWidth || 920;
      const displayWidth = Math.max(
        minDisplayWidthPx,
        Math.min(layout.width.maxPx, containerWidth)
      );
      const renderedScale = Math.min(containerWidth / displayWidth, 1);
      const rowStepPx = (layout.vertical.viewHeightPx + layout.multirow.rowGapPx) * renderedScale;
      const overscanRows = 2;
      const start = Math.min(
        Math.max(0, Math.floor(localTop / rowStepPx) - overscanRows),
        Math.max(0, rows.length - 1)
      );
      const end = Math.min(
        rows.length,
        Math.max(start + 1, Math.ceil(localBottom / rowStepPx) + overscanRows)
      );
      setVirtualRowWindow((current) =>
        current.start === start && current.end === end ? current : { start, end }
      );
    };
    const scheduleSync = (): void => {
      if (animationFrameId !== 0) return;
      animationFrameId = window.requestAnimationFrame(syncVisibleRows);
    };
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(frame);
    const scrollViewport = frame.closest<HTMLElement>(".staff-page-scroll-viewport");
    if (scrollViewport) resizeObserver.observe(scrollViewport);
    window.addEventListener("scroll", scheduleSync, { capture: true, passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    scheduleSync();
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleSync, true);
      window.removeEventListener("resize", scheduleSync);
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
    };
  }, [layout, minDisplayWidthPx, rows.length, virtualizeRows]);

  useEffect(() => {
    const markManualScroll = (): void => {
      lastManualScrollAtRef.current = performance.now();
      if (autoScrollAnimationFrameRef.current !== 0) {
        window.cancelAnimationFrame(autoScrollAnimationFrameRef.current);
        autoScrollAnimationFrameRef.current = 0;
      }
    };
    window.addEventListener("wheel", markManualScroll, { passive: true });
    window.addEventListener("touchmove", markManualScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", markManualScroll);
      window.removeEventListener("touchmove", markManualScroll);
      if (playbackFollowDelayTimerRef.current !== null) {
        window.clearTimeout(playbackFollowDelayTimerRef.current);
        playbackFollowDelayTimerRef.current = null;
      }
      if (autoScrollAnimationFrameRef.current !== 0) {
        window.cancelAnimationFrame(autoScrollAnimationFrameRef.current);
        autoScrollAnimationFrameRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    if (playingRowIndex !== null) {
      previousPlayingRowIndexRef.current = playingRowIndex;
      if (playbackFollowDelayTimerRef.current !== null) {
        window.clearTimeout(playbackFollowDelayTimerRef.current);
        playbackFollowDelayTimerRef.current = null;
      }
      setPlaybackFollowDelayComplete(false);
      return;
    }

    if (previousPlayingRowIndexRef.current === null) return;
    previousPlayingRowIndexRef.current = null;
    setPlaybackFollowDelayComplete(false);
    playbackFollowDelayTimerRef.current = window.setTimeout(() => {
      playbackFollowDelayTimerRef.current = null;
      setPlaybackFollowDelayComplete(true);
    }, AUTO_FOLLOW_RESUME_DELAY_MS);
  }, [playingRowIndex]);

  useEffect(() => {
    if (autoScrollAnimationFrameRef.current !== 0) {
      window.cancelAnimationFrame(autoScrollAnimationFrameRef.current);
      autoScrollAnimationFrameRef.current = 0;
    }
    const previousRowIndex = previousFollowRowIndexRef.current;
    previousFollowRowIndexRef.current = followRowIndex;
    const didFollowRowChange =
      previousRowIndex !== undefined && previousRowIndex !== followRowIndex;
    if (
      followRowIndex === undefined ||
      followRowIndex < 0 ||
      (!didFollowRowChange && !pendingPlaybackFollowRef.current)
    ) {
      return;
    }
    if (playingRowIndex !== null || !playbackFollowDelayComplete) {
      pendingPlaybackFollowRef.current = true;
      return;
    }
    pendingPlaybackFollowRef.current = false;
    if (manualScrollAwayRef.current) return;
    if (
      lastManualScrollAtRef.current > 0 &&
      performance.now() - lastManualScrollAtRef.current < AUTO_FOLLOW_RESUME_DELAY_MS
    ) {
      return;
    }

    const frame = frameRef.current;
    const row = rendererTargetRef.current?.querySelector<SVGElement>(
      `[data-staff-row-index="${followRowIndex}"]`
    );
    if (!frame || !row) return;

    const scrollViewport = frame.closest<HTMLElement>(".staff-page-scroll-viewport");
    const isNestedScrollViewport =
      scrollViewport !== null &&
      ["auto", "scroll", "overlay"].includes(window.getComputedStyle(scrollViewport).overflowY);
    const viewportBounds =
      isNestedScrollViewport && scrollViewport ? scrollViewport.getBoundingClientRect() : null;
    const viewportTop = viewportBounds ? viewportBounds.top + scrollViewport!.clientTop : 0;
    const viewportHeight = viewportBounds ? scrollViewport!.clientHeight : window.innerHeight;
    const rowBounds = row.getBoundingClientRect();
    const delta = (rowBounds.top + rowBounds.bottom) / 2 - (viewportTop + viewportHeight / 2);
    if (Math.abs(delta) < 1) return;

    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const currentScrollTop =
      isNestedScrollViewport && scrollViewport ? scrollViewport.scrollTop : window.scrollY;
    const maxScrollTop =
      isNestedScrollViewport && scrollViewport
        ? Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight)
        : Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    const targetScrollTop = Math.max(0, Math.min(maxScrollTop, currentScrollTop + delta));
    if (Math.abs(targetScrollTop - currentScrollTop) < 1) return;

    const setScrollTop = (scrollTop: number): void => {
      if (isNestedScrollViewport && scrollViewport) {
        scrollViewport.scrollTop = scrollTop;
      } else {
        scrollingElement.scrollTop = scrollTop;
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setScrollTop(targetScrollTop);
      return;
    }

    const startTime = performance.now();
    const durationMs = 420;
    const animateScroll = (now: number): void => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const easedProgress = progress * progress * (3 - 2 * progress);
      setScrollTop(currentScrollTop + (targetScrollTop - currentScrollTop) * easedProgress);
      if (progress < 1) {
        autoScrollAnimationFrameRef.current = window.requestAnimationFrame(animateScroll);
      } else {
        autoScrollAnimationFrameRef.current = 0;
      }
    };
    autoScrollAnimationFrameRef.current = window.requestAnimationFrame(animateScroll);
  }, [followRowIndex, playbackFollowDelayComplete, playingRowIndex]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!frame || !rendererTarget) return undefined;

    const originalMarginBottom = frame.style.marginBottom;
    const baseMarginBottom = Number.parseFloat(window.getComputedStyle(frame).marginBottom) || 0;
    let animationFrameId = 0;
    const updateTailSpace = (): void => {
      animationFrameId = 0;
      if (!isFiniteScore || rows.length === 0) {
        frame.style.marginBottom = originalMarginBottom;
        return;
      }

      const finalRow = rendererTarget.querySelector<SVGElement>(
        `[data-staff-row-index="${rows.length - 1}"]`
      );
      if (!finalRow) return;

      const scrollViewport = frame.closest<HTMLElement>(".staff-page-scroll-viewport");
      const isNestedScrollViewport =
        scrollViewport !== null &&
        ["auto", "scroll", "overlay"].includes(window.getComputedStyle(scrollViewport).overflowY);
      const viewportBounds =
        isNestedScrollViewport && scrollViewport ? scrollViewport.getBoundingClientRect() : null;
      const viewportTop = viewportBounds ? viewportBounds.top + scrollViewport!.clientTop : 0;
      const viewportHeight = viewportBounds ? scrollViewport!.clientHeight : window.innerHeight;
      const finalRowBounds = finalRow.getBoundingClientRect();
      const desiredScrollTop =
        (isNestedScrollViewport && scrollViewport ? scrollViewport.scrollTop : window.scrollY) +
        (finalRowBounds.top + finalRowBounds.bottom) / 2 -
        (viewportTop + viewportHeight / 2);
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const maxScrollTop =
        isNestedScrollViewport && scrollViewport
          ? Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight)
          : Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
      const extraSpace = Math.max(0, desiredScrollTop - maxScrollTop);
      frame.style.marginBottom = `${baseMarginBottom + extraSpace}px`;
    };
    const scheduleUpdate = (): void => {
      if (animationFrameId !== 0) return;
      animationFrameId = window.requestAnimationFrame(updateTailSpace);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(frame);
    resizeObserver.observe(rendererTarget);
    const scrollViewport = frame.closest<HTMLElement>(".staff-page-scroll-viewport");
    if (scrollViewport) resizeObserver.observe(scrollViewport);
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
      frame.style.marginBottom = originalMarginBottom;
    };
  }, [isFiniteScore, rows.length]);

  useEffect(() => {
    let animationFrameId = 0;
    const checkTrackedNoteVisibility = (): void => {
      if (animationFrameId !== 0) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0;
        const noteIndex = trackedNoteIndexRef.current;
        if (noteIndex === undefined || noteIndex < 0) return;
        const noteHeads = trackedNoteHeadElementsRef.current.get(noteIndex);
        if (!noteHeads?.length) return;

        const visibleBounds = {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        };
        const intersectBounds = (
          rect: DOMRect,
          clipX: boolean,
          clipY: boolean,
          insetLeft = 0,
          insetTop = 0,
          insetRight = 0,
          insetBottom = 0
        ): void => {
          if (clipX) {
            visibleBounds.left = Math.max(visibleBounds.left, rect.left + insetLeft);
            visibleBounds.right = Math.min(visibleBounds.right, rect.right - insetRight);
          }
          if (clipY) {
            visibleBounds.top = Math.max(visibleBounds.top, rect.top + insetTop);
            visibleBounds.bottom = Math.min(visibleBounds.bottom, rect.bottom - insetBottom);
          }
        };
        const svgViewport = noteHeads[0]?.ownerSVGElement;
        if (svgViewport) {
          intersectBounds(svgViewport.getBoundingClientRect(), true, true);
        }
        for (
          let ancestor = svgViewport?.parentElement;
          ancestor && ancestor !== document.documentElement;
          ancestor = ancestor.parentElement
        ) {
          if (!(ancestor instanceof HTMLElement)) continue;
          const style = window.getComputedStyle(ancestor);
          const clipsX = style.overflowX !== "visible";
          const clipsY = style.overflowY !== "visible";
          if (!clipsX && !clipsY) continue;
          const rect = ancestor.getBoundingClientRect();
          intersectBounds(
            rect,
            clipsX,
            clipsY,
            clipsX ? ancestor.clientLeft : 0,
            clipsY ? ancestor.clientTop : 0,
            clipsX ? rect.width - ancestor.clientLeft - ancestor.clientWidth : 0,
            clipsY ? rect.height - ancestor.clientTop - ancestor.clientHeight : 0
          );
        }
        const isVisible = noteHeads.every((noteHead) => {
          const bounds = noteHead.getBoundingClientRect();
          const centerX = (bounds.left + bounds.right) / 2;
          const centerY = (bounds.top + bounds.bottom) / 2;
          return (
            bounds.width > 0 &&
            bounds.height > 0 &&
            centerX >= visibleBounds.left &&
            centerX <= visibleBounds.right &&
            centerY >= visibleBounds.top &&
            centerY <= visibleBounds.bottom
          );
        });
        if (
          lastManualScrollAtRef.current > 0 &&
          performance.now() - lastManualScrollAtRef.current < AUTO_FOLLOW_RESUME_DELAY_MS
        ) {
          manualScrollAwayRef.current = !isVisible;
        } else if (isVisible) {
          manualScrollAwayRef.current = false;
        }
        onTrackedNoteVisibilityChangeRef.current?.(isVisible);
      });
    };

    checkTrackedNoteVisibility();
    window.addEventListener("scroll", checkTrackedNoteVisibility, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", checkTrackedNoteVisibility, { passive: true });
    return () => {
      window.removeEventListener("scroll", checkTrackedNoteVisibility, true);
      window.removeEventListener("resize", checkTrackedNoteVisibility);
      if (animationFrameId !== 0) window.cancelAnimationFrame(animationFrameId);
    };
  }, [trackedNoteIndex]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!frame || !rendererTarget) {
      return;
    }

    function render(): void {
      if (!frame || !rendererTarget) {
        return;
      }

      const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
      markMidiLatencyStage(renderedDiagnosticSampleId, "staffRenderStarted");
      renderedNotesRef.current = [];
      cursorLayersRef.current = new Map();
      cursorTargetsRef.current = new Map();
      cursorRowsRef.current = new Map();
      trackedNoteHeadElementsRef.current = new Map();
      playbackNoteHeadElementsRef.current = new Map();
      rendererTarget.innerHTML = "";
      const rowCount = Math.max(1, rows.length);
      const containerWidth = rendererTarget.clientWidth || frame.clientWidth || 920;
      const displayWidth = Math.max(
        minDisplayWidthPx,
        Math.min(layout.width.maxPx, containerWidth)
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        rowCount * layout.vertical.viewHeightPx +
          Math.max(0, rowCount - 1) * layout.multirow.rowGapPx,
        layout.notationScale
      );
      const renderedScale = Math.min(containerWidth / displayWidth, 1);
      const rowStepPx = (layout.vertical.viewHeightPx + layout.multirow.rowGapPx) * renderedScale;
      const clampedVisibleRowCount = Math.max(1, Math.min(visibleRowCount, rowCount));
      const visibleHeight =
        (clampedVisibleRowCount * layout.vertical.viewHeightPx +
          Math.max(0, clampedVisibleRowCount - 1) * layout.multirow.rowGapPx) *
        renderedScale;
      frame.style.height = `${visibleHeight}px`;
      rendererTarget.style.setProperty(
        "--staff-page-scroll-distance",
        `${rowStepPx * Math.max(1, scrollRowCount)}px`
      );
      rendererTarget.style.setProperty("--staff-page-scroll-duration", `${scrollDurationMs}ms`);
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(surface, layout.horizontal.staffSidePaddingPx);
      const rowsToRender = virtualizeRows
        ? new Set([
            ...Array.from(
              {
                length: Math.max(
                  0,
                  Math.min(rows.length, virtualRowWindow.end) - virtualRowWindow.start
                ),
              },
              (_, index) => index + virtualRowWindow.start
            ),
            ...cursorRowsToRender,
            ...(followRowIndex !== undefined ? [followRowIndex] : []),
            ...(isFiniteScore && rows.length > 0 ? [rows.length - 1] : []),
          ])
        : new Set(rows.map((_, rowIndex) => rowIndex));
      [...rowsToRender]
        .filter((rowIndex) => rowIndex >= 0 && rowIndex < rows.length)
        .sort((left, right) => left - right)
        .forEach((rowIndex) => {
          const rowGroups = rows[rowIndex];
          if (!rowGroups) return;
          const rowStep = logicalPx(
            layout.vertical.viewHeightPx + layout.multirow.rowGapPx,
            surface.scale
          );
          const baseY = rowIndex * rowStep;
          const visibleYBounds = {
            bottomY: baseY + logicalPx(layout.vertical.viewHeightPx, surface.scale),
            topY: baseY,
          };
          const rowGroup = context.openGroup("staff-page-system");
          const rowStartIndex = rowIndex * notesPerRow;
          rowGroup.setAttribute("data-staff-row-index", String(rowIndex));
          rowGroup.setAttribute("data-note-start-index", String(rowStartIndex));
          const visibleRowGroups = Array.from(
            { length: notesPerRow },
            (_, slotIndex) => rowGroups[slotIndex] ?? []
          );
          const rowSlots = visibleRowGroups.map((group) => group[0]);
          const vexDuration = getVexNoteDuration(noteDuration);
          const rowDurations = rowSlots.map(
            (_, slotIndex) => noteDurations?.[rowStartIndex + slotIndex] ?? noteDuration
          );
          const rowTrebleDurations = rowDurations.map(
            (duration, slotIndex) =>
              staffNoteDurations?.[rowStartIndex + slotIndex]?.treble ?? duration
          );
          const rowBassDurations = rowDurations.map(
            (duration, slotIndex) =>
              staffNoteDurations?.[rowStartIndex + slotIndex]?.bass ?? duration
          );
          const rowSelectedDurations = rowSlots.map((note, slotIndex) =>
            note?.staff === "bass" ? rowBassDurations[slotIndex]! : rowTrebleDurations[slotIndex]!
          );
          const rowOnsets = noteOnsets
            ? rowSlots.map((_, slotIndex) => noteOnsets[rowStartIndex + slotIndex])
            : undefined;
          const beamOptions =
            noteDurations && noteMeasures && noteOnsets
              ? {
                  barlineAfterNoteIndices,
                  breakBeamsAtStaffChange,
                  measures: rowSlots.map((_, slotIndex) => noteMeasures[rowStartIndex + slotIndex]),
                  noteBeamGroups: noteBeamGroups
                    ? rowSlots.map((_, slotIndex) => noteBeamGroups[rowStartIndex + slotIndex])
                    : undefined,
                  noteDurations: rowSelectedDurations,
                  noteOnsets: rowOnsets ?? [],
                  rowStartIndex,
                }
              : undefined;
          let beams: Beam[];
          let tuplets: Tuplet[];
          let ties: StaveTie[];
          let layoutTickables: StaffPageTickable[];
          let visibleTickables: Array<StaveNote | undefined>;
          let cursorTickablesBySlot: Array<Partial<Record<Staff, StaveNote>>> = [];
          let barlineTopY: number;
          let barlineBottomY: number;
          let lyricAnchorY: number;
          const system = drawStaffSystem({
            brace: true,
            columnCount: notesPerRow,
            context,
            frame: frameMetrics,
            horizontal: layout.horizontal,
            mode: staffNotationMode,
            scale: surface.scale,
            useLedgerGap,
            timeSignature,
            showGrandStaffRightConnector,
            vertical: layout.vertical,
            yOffset: baseY,
          });
          const { noteArea } = system;
          const distributionArea = distributeNotesEvenly
            ? {
                ...noteArea,
                right:
                  noteArea.right +
                  logicalPx(
                    layout.horizontal.noteAreaSidePaddingPx -
                      layout.horizontal.minNoteAreaSidePaddingPx,
                    surface.scale
                  ),
              }
            : noteArea;
          if (system.mode === "grand") {
            const { bass, treble } = system;
            const getColor = (slotIndex: number): string =>
              colorForIndex(
                rowStartIndex + slotIndex,
                completedCountRef.current,
                completedNoteIndicesRef.current,
                wrongIndexRef.current,
                activePairStartIndexRef.current,
                palette
              );
            const trebleGroups = visibleRowGroups.map((group) =>
              group.filter((note) => note.staff === "treble")
            );
            const bassGroups = visibleRowGroups.map((group) =>
              group.filter((note) => note.staff === "bass")
            );
            const makeStaffTickables = (
              groups: readonly (readonly TargetNote[])[],
              durations: readonly StaffPageNoteDuration[],
              stave: Stave
            ): StaffPageTickable[] =>
              groups.map((group, slotIndex) =>
                group.length > 0
                  ? makeStaveNote(group, getColor(slotIndex), durations[slotIndex]!).setStave(stave)
                  : makeStaffGhostNote(durations[slotIndex]!).setStave(stave)
              );
            const trebleTickables = makeStaffTickables(trebleGroups, rowTrebleDurations, treble);
            const bassTickables = makeStaffTickables(bassGroups, rowBassDurations, bass);
            const monophonicLaneIndices = [visibleRowGroups.map((_, index) => index)];
            const trebleLaneIndices = monophonicGrandStaff
              ? monophonicLaneIndices
              : assignStaffVoiceLanes(trebleGroups, rowTrebleDurations, rowOnsets);
            const bassLaneIndices = monophonicGrandStaff
              ? monophonicLaneIndices
              : assignStaffVoiceLanes(bassGroups, rowBassDurations, rowOnsets);
            const tickables = rowSlots.map((note, slotIndex) =>
              note?.staff === "bass" ? bassTickables[slotIndex] : trebleTickables[slotIndex]
            );
            const measures = beamOptions?.measures ?? [];
            const buildStaffLanes = (
              groups: readonly (readonly TargetNote[])[],
              durations: readonly StaffPageNoteDuration[],
              primaryTickables: readonly StaffPageTickable[],
              laneIndices: readonly (readonly number[])[],
              stave: Stave,
              staff: Staff
            ): Array<{
              beams: Beam[];
              expandedTickables: StaffPageTickable[];
              ties: StaveTie[];
              tuplets: Tuplet[];
            }> =>
              laneIndices.map((indices) => {
                const laneSlots = new Set(indices);
                const laneGroups = groups.map((group, slotIndex) =>
                  laneSlots.has(slotIndex) ? group : []
                );
                const laneTickables = primaryTickables.map((tickable, slotIndex) =>
                  laneSlots.has(slotIndex)
                    ? tickable
                    : makeStaffGhostNote(durations[slotIndex]!).setStave(stave)
                );
                const expanded = expandTiedDurations(
                  laneGroups,
                  laneTickables,
                  durations,
                  getColor,
                  rowOnsets,
                  beatsPerMeasure,
                  staff,
                  monophonicGrandStaff,
                  useInvisibleGapRests
                );
                const compactIndices = indices.filter(
                  (slotIndex) => laneGroups[slotIndex]!.length > 0
                );
                const compactSlots = compactIndices.map((slotIndex) => laneGroups[slotIndex]![0]);
                const compactTickables = compactIndices.map(
                  (slotIndex) => laneTickables[slotIndex]!
                );
                return {
                  beams: makeStaffPageBeams(
                    compactSlots,
                    compactTickables,
                    noteDuration,
                    visibleYBounds,
                    palette.ink,
                    getLaneBeamOptions(beamOptions, compactIndices)
                  ),
                  expandedTickables: expanded.tickables,
                  ties: expanded.ties,
                  tuplets: makeStaffPageTuplets(
                    compactSlots,
                    compactTickables,
                    compactIndices.map((slotIndex) => durations[slotIndex]!),
                    compactIndices.map((slotIndex) => measures[slotIndex])
                  ),
                };
              });
            const trebleLanes = buildStaffLanes(
              trebleGroups,
              rowTrebleDurations,
              trebleTickables,
              trebleLaneIndices,
              treble,
              "treble"
            );
            const bassLanes = buildStaffLanes(
              bassGroups,
              rowBassDurations,
              bassTickables,
              bassLaneIndices,
              bass,
              "bass"
            );
            ties = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.ties);
            tuplets = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.tuplets);
            beams = [...trebleLanes, ...bassLanes].flatMap((lane) => lane.beams);
            const allExpandedTickables = [...trebleLanes, ...bassLanes].map(
              (lane) => lane.expandedTickables
            );
            const longestVoiceTicks = Math.max(
              ...allExpandedTickables.map((laneTickables) =>
                laneTickables.reduce((total, tickable) => total + tickable.getTicks().value(), 0)
              )
            );
            const alignedTickableGroups = allExpandedTickables.map((laneTickables, index) =>
              padStaffTickablesToDuration(
                laneTickables,
                longestVoiceTicks,
                index < trebleLanes.length ? "treble" : "bass",
                index < trebleLanes.length ? treble : bass,
                rowOnsets,
                beatsPerMeasure,
                monophonicGrandStaff || useInvisibleGapRests
              )
            );
            const voiceOptions = createVoiceOptions(alignedTickableGroups);
            const voices = alignedTickableGroups.map((alignedTickables, index) =>
              new Voice(voiceOptions)
                .setStrict(false)
                .setStave(index < trebleLanes.length ? treble : bass)
                .addTickables(alignedTickables)
            );
            treble.setNoteStartX(noteArea.left);
            bass.setNoteStartX(noteArea.left);
            treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
            bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
            const formatter = new Formatter().joinVoices(voices);
            formatter.format(
              voices,
              treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding,
              { context }
            );
            formatter.postFormat();
            if (distributeNotesEvenly) {
              alignRowNotesEvenly(tickables, rowGroups.length, distributionArea);
            }
            voices.forEach((voice) => voice.draw(context, voice.getStave()!));
            layoutTickables = tickables;
            visibleTickables = rowSlots.map((note, index) => {
              const tickable =
                note?.staff === "bass" ? bassTickables[index] : trebleTickables[index];
              return note && tickable instanceof StaveNote ? tickable : undefined;
            });
            cursorTickablesBySlot = rowSlots.map((note, slotIndex) => {
              if (!note) return {};
              const trebleTickable = trebleTickables[slotIndex];
              const bassTickable = bassTickables[slotIndex];
              return {
                ...(trebleTickable instanceof StaveNote ? { treble: trebleTickable } : {}),
                ...(bassTickable instanceof StaveNote ? { bass: bassTickable } : {}),
              };
            });
            barlineTopY = treble.getYForLine(0);
            barlineBottomY = bass.getYForLine(4);
            lyricAnchorY = treble.getYForLine(4);
          } else {
            const { stave } = system;
            const tickables = rowSlots.map((note, slotIndex) =>
              note
                ? makeStaveNote(
                    visibleRowGroups[slotIndex],
                    colorForIndex(
                      rowStartIndex + slotIndex,
                      completedCountRef.current,
                      completedNoteIndicesRef.current,
                      wrongIndexRef.current,
                      activePairStartIndexRef.current,
                      palette
                    ),
                    rowDurations[slotIndex]
                  ).setStave(stave)
                : new GhostNote(vexDuration).setStave(stave)
            );
            const expanded = expandTiedDurations(
              visibleRowGroups,
              tickables,
              rowDurations,
              (slotIndex) =>
                colorForIndex(
                  rowStartIndex + slotIndex,
                  completedCountRef.current,
                  completedNoteIndicesRef.current,
                  wrongIndexRef.current,
                  activePairStartIndexRef.current,
                  palette
                ),
              rowOnsets,
              beatsPerMeasure,
              staffNotationMode === "bass-only" ? "bass" : "treble",
              monophonicGrandStaff,
              useInvisibleGapRests
            );
            ties = expanded.ties;
            tuplets = makeStaffPageTuplets(
              rowSlots,
              tickables,
              rowDurations,
              beamOptions?.measures ?? []
            );
            const voiceOptions = createVoiceOptions([expanded.tickables]);
            const voice = new Voice(voiceOptions).addTickables(expanded.tickables);
            beams = makeStaffPageBeams(
              rowSlots,
              tickables,
              noteDuration,
              visibleYBounds,
              palette.ink,
              beamOptions
            );
            stave.setNoteStartX(noteArea.left);
            stave.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
            const formatter = new Formatter().joinVoices([voice]);
            formatter.formatToStave([voice], stave, { context, stave });
            if (distributeNotesEvenly) {
              alignRowNotesEvenly(tickables, rowGroups.length, distributionArea);
            }
            voice.draw(context, stave);
            layoutTickables = tickables;
            visibleTickables = tickables.map((tickable, index) =>
              rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined
            );
            const cursorStaff: Staff = staffNotationMode === "bass-only" ? "bass" : "treble";
            cursorTickablesBySlot = visibleTickables.map((tickable) =>
              tickable ? { [cursorStaff]: tickable } : {}
            );
            barlineTopY = stave.getYForLine(0);
            barlineBottomY = stave.getYForLine(4);
            lyricAnchorY = barlineBottomY;
          }

          visibleTickables.forEach((staveNote, slotIndex) => {
            const element = staveNote?.getSVGElement();
            if (!staveNote || !element) {
              return;
            }
            const index = rowStartIndex + slotIndex;
            renderedNotesRef.current[index] = {
              color: colorForIndex(
                index,
                completedCountRef.current,
                completedNoteIndicesRef.current,
                wrongIndexRef.current,
                activePairStartIndexRef.current,
                palette
              ),
              element,
            };
          });

          cursorTickablesBySlot.forEach((tickables, slotIndex) => {
            const noteHeadElements = (
              Object.values(tickables) as Array<StaveNote | undefined>
            ).flatMap(
              (staveNote) =>
                staveNote?.noteHeads.flatMap((noteHead) => {
                  const element = noteHead.getSVGElement();
                  return element ? [element] : [];
                }) ?? []
            );
            if (noteHeadElements.length > 0) {
              noteHeadElements.forEach((element) => {
                element.setAttribute(
                  "data-song-practice-note-index",
                  String(rowStartIndex + slotIndex)
                );
              });
              trackedNoteHeadElementsRef.current.set(rowStartIndex + slotIndex, noteHeadElements);
            }
          });

          beams.forEach((beam) => beam.setContext(context).drawWithStyle());
          tuplets.forEach((tuplet) => tuplet.setContext(context).draw());
          ties.forEach((tie) => tie.setContext(context).draw());

          rowSlots.forEach((note, slotIndex) => {
            if (!note) return;
            const noteLyrics = lyrics?.[rowStartIndex + slotIndex];
            const staveNote = visibleTickables[slotIndex];
            if (!noteLyrics?.length || !staveNote) return;
            const noteBounds = staveNote.getBoundingBox();
            const lyricX = noteBounds.getX() + noteBounds.getW() / 2;
            noteLyrics.forEach((text, lineIndex) => {
              if (!text) return;
              addStaffPageLyric(
                rowGroup,
                text,
                lyricX,
                lyricAnchorY + logicalPx(20 + lineIndex * 22, surface.scale),
                logicalPx(15, surface.scale),
                isNightMode ? "#f0a184" : "#c45c38"
              );
            });
          });

          const barlineInterval = getStaffPageBarlineInterval(noteDuration);
          const explicitBarlineBoundaries = barlineAfterNoteIndices
            ?.map((noteIndex) => noteIndex + 1 - rowStartIndex)
            .filter((boundaryIndex) => boundaryIndex > 0 && boundaryIndex <= rowGroups.length);
          const barlineBoundaries =
            explicitBarlineBoundaries ??
            Array.from(
              { length: Math.floor(Math.min(rowGroups.length, notesPerRow - 1) / barlineInterval) },
              (_, index) => (index + 1) * barlineInterval
            );
          for (const boundaryIndex of barlineBoundaries) {
            if (boundaryIndex >= notesPerRow) continue;
            const nextTickable = layoutTickables[boundaryIndex];
            const barlineX = getBarlineX(
              nextTickable,
              visibleTickables[boundaryIndex - 1],
              visibleTickables[boundaryIndex]
            );
            if (barlineX !== undefined) {
              addBarline(rowGroup, barlineX, barlineTopY, barlineBottomY, palette.ink);
            }
          }
          visibleTickables.forEach((staveNote, slotIndex) => {
            if (!staveNote) return;
            const noteHead = staveNote.noteHeads[0];
            const noteHeadCenterX = noteHead
              ? noteHead.getAbsoluteX() + noteHead.getWidth() / 2
              : staveNoteCenterX(staveNote);
            const markerWidth = logicalPx(14, surface.scale);
            const noteIndex = rowStartIndex + slotIndex;
            addStaffProgressMarker(
              rowGroup,
              noteIndex,
              noteHeadCenterX,
              barlineTopY,
              barlineBottomY,
              "practice",
              markerWidth
            );
            addStaffProgressMarker(
              rowGroup,
              noteIndex,
              noteHeadCenterX,
              barlineTopY,
              barlineBottomY,
              "playback",
              markerWidth
            );
          });
          if (getAudioTimeRef.current) {
            cursorTickablesBySlot.forEach((tickables, slotIndex) => {
              const eventIndex = cursorIndexOffset + rowStartIndex + slotIndex;
              if (!tickables.treble && !tickables.bass) return;
              const targets: PlaybackCursorTargets = {};
              const noteHeadElements: PlaybackNoteHeadElements = {};
              (["treble", "bass"] as const).forEach((staff) => {
                const staveNote = tickables[staff];
                if (!staveNote) return;
                const points = noteHeadCursorPoints(staveNote);
                if (points.length > 0) targets[staff] = points;
                const elements = staveNote.noteHeads.flatMap((noteHead) => {
                  const element = noteHead.getSVGElement();
                  return element ? [element] : [];
                });
                if (elements.length > 0) noteHeadElements[staff] = elements;
                if (activePlaybackEventIndicesRef.current[staff].includes(eventIndex)) {
                  elements.forEach((element) =>
                    element.classList.add(
                      "is-playback-active-note",
                      `is-playback-active-note-${staff}`
                    )
                  );
                }
              });
              cursorTargetsRef.current.set(eventIndex, targets);
              cursorRowsRef.current.set(eventIndex, rowIndex);
              playbackNoteHeadElementsRef.current.set(eventIndex, noteHeadElements);
            });
          }
          context.closeGroup();
        });
      if (getAudioTimeRef.current) {
        const cursorOverlay = context.openGroup("staff-page-playback-overlay");
        const cursorStaves: Staff[] =
          staffNotationMode === "grand"
            ? ["treble", "bass"]
            : [staffNotationMode === "bass-only" ? "bass" : "treble"];
        [...rowsToRender]
          .filter((rowIndex) => rowIndex >= 0 && rowIndex < rows.length)
          .sort((left, right) => left - right)
          .forEach((rowIndex) => {
            cursorStaves.forEach((staff) => {
              cursorLayersRef.current.set(
                playbackCursorLayerKey(rowIndex, staff),
                createPlaybackCursorLayer(cursorOverlay, rowIndex, staff)
              );
            });
          });
        context.closeGroup();
      }
      updateStaffProgressMarkers(
        rendererTarget,
        completedCountRef.current,
        playbackProgressIndexRef.current
      );
      const frameTop = frame.getBoundingClientRect().top;
      const measuredRowCenters = Array.from(
        rendererTarget.querySelectorAll<SVGGElement>("[data-staff-row-index]")
      )
        .map((rowGroup) => {
          const rowIndex = Number(rowGroup.getAttribute("data-staff-row-index"));
          const staves = Array.from(rowGroup.querySelectorAll<SVGGElement>(".vf-stave"));
          if (!Number.isInteger(rowIndex) || staves.length === 0) return null;
          const firstStave = staves[0]?.getBoundingClientRect();
          const lastStave = staves[staves.length - 1]?.getBoundingClientRect();
          if (!firstStave || !lastStave) return null;
          return {
            center: (firstStave.top + lastStave.bottom) / 2 - frameTop,
            rowIndex,
          };
        })
        .filter(
          (measurement): measurement is { center: number; rowIndex: number } => measurement !== null
        )
        .sort((left, right) => left.rowIndex - right.rowIndex);
      const firstMeasuredRow = measuredRowCenters[0];
      const svgBounds = surface.svg.getBoundingClientRect();
      const rowStepInSvgUnits = logicalPx(
        layout.vertical.viewHeightPx + layout.multirow.rowGapPx,
        surface.scale
      );
      const rowStepInCssPixels = rowStepInSvgUnits * (svgBounds.width / surface.width);
      const measuredCentersByRow = new Map(
        measuredRowCenters.map(({ center, rowIndex }) => [rowIndex, center])
      );
      const nextRowPlaybackButtonCenters = firstMeasuredRow
        ? Array.from(
            { length: Math.max(1, Math.min(visibleRowCount, rows.length)) },
            (_, rowIndex) =>
              measuredCentersByRow.get(rowIndex) ??
              firstMeasuredRow.center + (rowIndex - firstMeasuredRow.rowIndex) * rowStepInCssPixels
          )
        : [];
      setRowPlaybackButtonCenters((current) =>
        current.length === nextRowPlaybackButtonCenters.length &&
        current.every(
          (center, index) => Math.abs(center - nextRowPlaybackButtonCenters[index]!) < 0.1
        )
          ? current
          : nextRowPlaybackButtonCenters
      );
      markMidiLatencyStage(renderedDiagnosticSampleId, "staffRenderEnded");
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    layout,
    barlineAfterNoteIndices,
    isNightMode,
    lyrics,
    noteMeasures,
    noteOnsets,
    noteBeamGroups,
    beatsPerMeasure,
    timeSignature,
    minDisplayWidthPx,
    distributeNotesEvenly,
    noteDuration,
    noteDurations,
    staffNoteDurations,
    notesPerRow,
    palette,
    rows,
    scrollDurationMs,
    scrollRowCount,
    staffNotationMode,
    breakBeamsAtStaffChange,
    monophonicGrandStaff,
    useInvisibleGapRests,
    showGrandStaffRightConnector,
    useLedgerGap,
    cursorIndexOffset,
    cursorRowsKey,
    cursorRowsToRender,
    followRowIndex,
    isFiniteScore,
    visibleRowCount,
    virtualizeRows,
    virtualRowWindow.end,
    virtualRowWindow.start,
  ]);

  useLayoutEffect(() => {
    if (!cursorAnimationEnabled) return;

    let animationFrameId = 0;
    const activeMotions = new Map<Staff, ActivePlaybackMotion>();
    let lastFrameTimestamp: number | undefined;
    let droppedFrameCount = 0;
    let stableFrameCount = 0;
    let trailCount = basePlaybackTrailCount();
    let diffuseGlowEnabled = basePlaybackTrailCount() > 1;
    const lastLandedEventKeys = lastLandedEventKeysRef.current;
    const pendingRipples: Array<{
      audioTime: number;
      layer: PlaybackCursorLayer;
      point: PlaybackCursorPoint;
    }> = [];

    const targetPointFor = (
      staff: Staff,
      eventIndices: readonly number[]
    ): PlaybackCursorPoint | null => {
      const candidates = eventIndices.flatMap(
        (eventIndex) => cursorTargetsRef.current.get(eventIndex)?.[staff] ?? []
      );
      if (candidates.length === 0) return null;
      return candidates.reduce((leftmost, candidate) =>
        candidate.x < leftmost.x ? candidate : leftmost
      );
    };
    const rowIndexFor = (eventIndices: readonly number[]): number | null => {
      const firstEventIndex = eventIndices[0];
      return firstEventIndex === undefined
        ? null
        : (cursorRowsRef.current.get(firstEventIndex) ?? null);
    };
    const chaseVisualRowIndex = (
      staffCursor: ScoreChaseCursor["staffCursors"][Staff]
    ): number | null => {
      if (!staffCursor) return null;
      const currentRowIndex = rowIndexFor(staffCursor.currentEventIndices);
      if (currentRowIndex === null || staffCursor.caught) return currentRowIndex;
      const nextRowIndex = rowIndexFor(staffCursor.nextEventIndices ?? []);
      const hasNextTarget =
        staffCursor.nextEventIndices !== null &&
        targetPointFor(staffCursor.staff, staffCursor.nextEventIndices) !== null;
      const hasTimedSegment =
        staffCursor.endAudioTime !== null && staffCursor.endAudioTime > staffCursor.startAudioTime;
      return hasTimedSegment &&
        hasNextTarget &&
        nextRowIndex !== null &&
        nextRowIndex !== currentRowIndex
        ? nextRowIndex
        : currentRowIndex;
    };

    const landOnEvent = (
      staff: Staff,
      eventIndices: readonly number[],
      rowIndex: number,
      point: PlaybackCursorPoint,
      audioTime: number,
      layer: PlaybackCursorLayer,
      landingSuffix = ""
    ): void => {
      const eventKey = `${playbackEventKey(rowIndex, eventIndices)}${landingSuffix}`;
      setPlaybackHighlight(
        staff,
        eventIndices,
        activePlaybackEventIndicesRef,
        playbackNoteHeadElementsRef.current
      );
      if (eventKey === lastLandedEventKeys.get(staff)) return;
      flashPlaybackNoteHighlight(staff, eventIndices, playbackNoteHeadElementsRef.current);
      lastLandedEventKeys.set(staff, eventKey);
      pendingRipples.push({ audioTime, layer, point });
    };

    const animate = (frameTimestamp: number): void => {
      const cursor = playbackCursorRef.current;
      const chaseCursor = chaseCursorRef.current;
      const audioTime = getAudioTimeRef.current?.();
      if (!cursor && !chaseCursor) {
        cursorLayersRef.current.forEach((layer) => setPlaybackCursorLayerVisibility(layer, false));
        animationFrameId = window.requestAnimationFrame(animate);
        return;
      }
      if (!Number.isFinite(audioTime)) {
        animationFrameId = window.requestAnimationFrame(animate);
        return;
      }

      // The RAF timestamp is only a frame-budget signal. Cursor position always uses Tone's audio clock.
      if (lastFrameTimestamp !== undefined) {
        const frameGapMs = frameTimestamp - lastFrameTimestamp;
        if (frameGapMs > 34) {
          droppedFrameCount += 1;
          stableFrameCount = 0;
          // Ignore one-off spikes (such as a landing animation frame); degrade only
          // when the animation stays over budget for several frames in a row.
          if (droppedFrameCount >= 3) {
            trailCount = 1;
          }
        } else {
          droppedFrameCount = 0;
          stableFrameCount += 1;
          if (stableFrameCount >= 24) {
            trailCount = basePlaybackTrailCount();
            diffuseGlowEnabled = basePlaybackTrailCount() > 1;
          }
        }
      }
      lastFrameTimestamp = frameTimestamp;

      if (cursor) {
        cursorLayersRef.current.forEach((layer) => {
          const staffCursor = cursor.staffCursors[layer.staff];
          setPlaybackCursorLayerVisibility(layer, staffCursor?.rowIndex === layer.rowIndex);
        });

        (["treble", "bass"] as const).forEach((staff) => {
          const staffCursor = cursor.staffCursors[staff];
          if (!staffCursor) {
            cursorLayersRef.current.forEach((layer) => {
              if (layer.staff === staff) clearPlaybackCursorLayer(layer);
            });
            setPlaybackHighlight(
              staff,
              [],
              activePlaybackEventIndicesRef,
              playbackNoteHeadElementsRef.current
            );
            return;
          }
          const layer = cursorLayersRef.current.get(
            playbackCursorLayerKey(staffCursor.rowIndex, staff)
          );
          if (!layer) return;
          layer.element.classList.remove("is-catching");

          let motion = activeMotions.get(staff);
          if (!motion) {
            motion = {
              controlPoint: null,
              cursor: null,
              endPoint: null,
              lastParticlePoint: null,
              lastParticleProgress: null,
              layer: null,
              startPoint: null,
            };
            activeMotions.set(staff, motion);
          }

          if (staffCursor !== motion.cursor || layer !== motion.layer) {
            const nextStartPoint = targetPointFor(staff, staffCursor.currentEventIndices);
            const nextEndPoint = staffCursor.nextEventIndices
              ? targetPointFor(staff, staffCursor.nextEventIndices)
              : null;
            if (!nextStartPoint) return;
            motion.cursor = staffCursor;
            motion.layer = layer;
            motion.startPoint = nextStartPoint;
            motion.endPoint = nextEndPoint ?? nextStartPoint;
            const distance = Math.hypot(
              motion.endPoint.x - nextStartPoint.x,
              motion.endPoint.y - nextStartPoint.y
            );
            const lift = Math.max(76, Math.min(190, distance * 0.72));
            motion.controlPoint = {
              x: (nextStartPoint.x + motion.endPoint.x) / 2,
              y: (nextStartPoint.y + motion.endPoint.y) / 2 - lift,
              rx: (nextStartPoint.rx + motion.endPoint.rx) / 2,
              ry: (nextStartPoint.ry + motion.endPoint.ry) / 2,
            };
            motion.lastParticlePoint = nextStartPoint;
            motion.lastParticleProgress = 0;
            layer.element.style.opacity = "1";

            landOnEvent(
              staff,
              staffCursor.currentEventIndices,
              staffCursor.rowIndex,
              nextStartPoint,
              staffCursor.startAudioTime,
              layer,
              ":playback"
            );
          }

          const { controlPoint, endPoint, startPoint } = motion;
          if (!controlPoint || !endPoint || !startPoint) return;

          const duration = Math.max(
            0,
            (staffCursor.endAudioTime ?? staffCursor.startAudioTime) - staffCursor.startAudioTime
          );
          const endAudioTime = staffCursor.endAudioTime;
          const hasNextNote = staffCursor.nextEventIndices !== null && endAudioTime !== null;
          const progress =
            hasNextNote && duration > 0
              ? Math.max(
                  0,
                  Math.min(1, ((audioTime as number) - staffCursor.startAudioTime) / duration)
                )
              : 0;
          const cursorPoint = pointOnBouncedArc(
            startPoint,
            controlPoint,
            endPoint,
            progress,
            staffCursor.startAudioTime,
            duration
          );
          setEllipsePosition(layer.ambient, cursorPoint);
          setEllipsePoint(layer.diffuse, cursorPoint, 5, 3.2);
          setEllipsePoint(layer.innerGlow, cursorPoint, 1.8, 1.2);
          setEllipsePoint(layer.core, cursorPoint);
          layer.ambient.style.opacity = playbackAmbientPulse(audioTime as number, staff);
          layer.diffuse.style.display = diffuseGlowEnabled ? "" : "none";
          const shouldSpawnParticles =
            hasNextNote &&
            duration >= 0.12 &&
            progress > (motion.lastParticleProgress ?? 0) &&
            trailCount > 0;
          if (
            shouldSpawnParticles &&
            motion.lastParticlePoint &&
            motion.lastParticleProgress !== null
          ) {
            const didSpawnParticles = spawnPlaybackArcParticles(
              layer,
              startPoint,
              controlPoint,
              endPoint,
              motion.lastParticleProgress,
              progress,
              trailCount === 1 ? 96 : 128,
              trailCount === 1 ? 480 : 720,
              staffCursor.startAudioTime,
              duration,
              audioTime as number
            );
            if (didSpawnParticles) {
              motion.lastParticlePoint = cursorPoint;
              motion.lastParticleProgress = progress;
            }
          } else {
            motion.lastParticlePoint = cursorPoint;
            motion.lastParticleProgress = progress;
          }

          if (hasNextNote && endAudioTime !== null && (audioTime as number) >= endAudioTime) {
            const nextEventIndices = staffCursor.nextEventIndices ?? [];
            const nextRowIndex = rowIndexFor(nextEventIndices);
            const landingLayer =
              nextRowIndex === null
                ? null
                : cursorLayersRef.current.get(playbackCursorLayerKey(nextRowIndex, staff));
            landOnEvent(
              staff,
              nextEventIndices,
              nextRowIndex ?? staffCursor.rowIndex,
              endPoint,
              endAudioTime,
              landingLayer ?? layer,
              ":playback"
            );
          }
        });
      } else if (chaseCursor) {
        cursorLayersRef.current.forEach((layer) => {
          const staffCursor = chaseCursor.staffCursors[layer.staff];
          const visibleRowIndex = chaseVisualRowIndex(staffCursor);
          const isActiveRow = visibleRowIndex === layer.rowIndex;
          setPlaybackCursorLayerVisibility(layer, isActiveRow);
          if (!isActiveRow) layer.element.classList.remove("is-catching");
        });

        (["treble", "bass"] as const).forEach((staff) => {
          const staffCursor = chaseCursor.staffCursors[staff];
          if (!staffCursor) {
            cursorLayersRef.current.forEach((layer) => {
              if (layer.staff === staff) clearPlaybackCursorLayer(layer);
            });
            setPlaybackHighlight(
              staff,
              [],
              activePlaybackEventIndicesRef,
              playbackNoteHeadElementsRef.current
            );
            return;
          }
          const rowIndex = rowIndexFor(staffCursor.currentEventIndices);
          if (rowIndex === null) return;
          const startPoint = targetPointFor(staff, staffCursor.currentEventIndices);
          if (!startPoint) return;
          const nextRowIndex = staffCursor.nextEventIndices
            ? rowIndexFor(staffCursor.nextEventIndices)
            : null;
          const nextPoint =
            staffCursor.nextEventIndices && nextRowIndex !== null
              ? targetPointFor(staff, staffCursor.nextEventIndices)
              : null;
          const canMove =
            !staffCursor.caught &&
            nextPoint !== null &&
            nextRowIndex !== null &&
            staffCursor.endAudioTime !== null &&
            staffCursor.endAudioTime > staffCursor.startAudioTime;
          const visibleRowIndex = canMove && nextRowIndex !== rowIndex ? nextRowIndex : rowIndex;
          const layer = cursorLayersRef.current.get(playbackCursorLayerKey(visibleRowIndex, staff));
          if (!layer) return;
          const endPoint = canMove ? nextPoint : startPoint;
          let motion = activeMotions.get(staff);
          if (!motion) {
            motion = {
              controlPoint: null,
              cursor: null,
              endPoint: null,
              lastParticlePoint: null,
              lastParticleProgress: null,
              layer: null,
              startPoint: null,
            };
            activeMotions.set(staff, motion);
          }

          if (staffCursor !== motion.cursor || layer !== motion.layer) {
            const distance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
            const lift = Math.max(76, Math.min(190, distance * 0.72));
            motion.cursor = staffCursor;
            motion.layer = layer;
            motion.startPoint = startPoint;
            motion.endPoint = endPoint;
            motion.controlPoint = {
              x: (startPoint.x + endPoint.x) / 2,
              y: (startPoint.y + endPoint.y) / 2 - lift,
              rx: (startPoint.rx + endPoint.rx) / 2,
              ry: (startPoint.ry + endPoint.ry) / 2,
            };
            motion.lastParticlePoint = startPoint;
            motion.lastParticleProgress = 0;
            if (staffCursor.caught) {
              landOnEvent(
                staff,
                staffCursor.currentEventIndices,
                rowIndex,
                startPoint,
                audioTime as number,
                layer,
                `:chase-caught:${staffCursor.startAudioTime}`
              );
            } else {
              layer.element.classList.remove("is-catching");
              landOnEvent(
                staff,
                staffCursor.currentEventIndices,
                rowIndex,
                startPoint,
                staffCursor.startAudioTime,
                layer,
                ":chase"
              );
            }
          }

          layer.element.classList.toggle("is-catching", staffCursor.caught);

          const { controlPoint, endPoint: motionEndPoint, startPoint: motionStartPoint } = motion;
          if (!controlPoint || !motionEndPoint || !motionStartPoint) return;
          const duration =
            staffCursor.endAudioTime === null
              ? 0
              : staffCursor.endAudioTime - staffCursor.startAudioTime;
          const progress = canMove
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((audioTime as number) - staffCursor.startAudioTime) / Math.max(0.001, duration)
                )
              )
            : 0;
          const cursorPoint = pointOnBouncedArc(
            motionStartPoint,
            controlPoint,
            motionEndPoint,
            progress,
            staffCursor.startAudioTime,
            duration
          );
          setEllipsePosition(layer.ambient, cursorPoint);
          setEllipsePoint(layer.diffuse, cursorPoint, 5, 3.2);
          setEllipsePoint(layer.innerGlow, cursorPoint, 1.8, 1.2);
          setEllipsePoint(layer.core, cursorPoint);
          layer.ambient.style.opacity = playbackAmbientPulse(audioTime as number, staff);
          layer.diffuse.style.display = diffuseGlowEnabled ? "" : "none";

          const shouldSpawnParticles =
            canMove &&
            duration >= 0.12 &&
            progress > (motion.lastParticleProgress ?? 0) &&
            trailCount > 0;
          if (
            shouldSpawnParticles &&
            motion.lastParticlePoint &&
            motion.lastParticleProgress !== null
          ) {
            const didSpawnParticles = spawnPlaybackArcParticles(
              layer,
              motionStartPoint,
              controlPoint,
              motionEndPoint,
              motion.lastParticleProgress,
              progress,
              trailCount === 1 ? 96 : 128,
              trailCount === 1 ? 480 : 720,
              staffCursor.startAudioTime,
              duration,
              audioTime as number,
              chaseParticleLifetimeMs(chaseCursor.speedMultiplier)
            );
            if (didSpawnParticles) {
              motion.lastParticlePoint = cursorPoint;
              motion.lastParticleProgress = progress;
            }
          } else {
            motion.lastParticlePoint = cursorPoint;
            motion.lastParticleProgress = progress;
          }

          if (
            canMove &&
            staffCursor.endAudioTime !== null &&
            (audioTime as number) >= staffCursor.endAudioTime &&
            nextRowIndex !== null &&
            nextPoint !== null
          ) {
            const landingLayer = cursorLayersRef.current.get(
              playbackCursorLayerKey(nextRowIndex, staff)
            );
            landOnEvent(
              staff,
              staffCursor.nextEventIndices ?? [],
              nextRowIndex,
              nextPoint,
              staffCursor.endAudioTime,
              landingLayer ?? layer,
              ":chase"
            );
          }
        });
      }

      for (let rippleIndex = 0; rippleIndex < pendingRipples.length;) {
        const pendingRipple = pendingRipples[rippleIndex];
        if (pendingRipple && (audioTime as number) >= pendingRipple.audioTime) {
          if (pendingRipple.layer.element.isConnected) {
            spawnPlaybackRipple(pendingRipple.layer, pendingRipple.point);
          }
          pendingRipples.splice(rippleIndex, 1);
        } else {
          rippleIndex += 1;
        }
      }

      animationFrameId = window.requestAnimationFrame(animate);
    };

    animationFrameId = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      lastLandedEventKeys.clear();
      cursorLayersRef.current.forEach((layer) => {
        layer.element.style.opacity = "0";
        layer.particleLayer.replaceChildren();
        layer.rippleLayer.replaceChildren();
      });
      (["treble", "bass"] as const).forEach((staff) => {
        setPlaybackHighlight(
          staff,
          [],
          activePlaybackEventIndicesRef,
          playbackNoteHeadElementsRef.current
        );
      });
    };
  }, [cursorAnimationEnabled]);

  useLayoutEffect(() => {
    updateStaffProgressMarkers(rendererTargetRef.current, completedCount, playbackProgressIndex);
  }, [completedCount, playbackProgressIndex]);

  useLayoutEffect(() => {
    const renderedDiagnosticSampleId = diagnosticSampleIdRef.current;
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorStarted");
    renderedNotesRef.current.forEach((renderedNote, index) => {
      if (renderedNote) {
        updateRenderedNoteColor(
          renderedNote,
          colorForIndex(
            index,
            completedCount,
            completedNoteIndices,
            wrongIndex,
            activePairStartIndex,
            palette
          )
        );
      }
    });
    markMidiLatencyStage(renderedDiagnosticSampleId, "staffColorEnded");
  }, [
    activePairStartIndex,
    completedCount,
    completedNoteIndices,
    isNightMode,
    palette,
    wrongIndex,
  ]);

  return (
    <div
      ref={frameRef}
      className={`staff-page${onToggleRowPlayback ? " staff-page-with-row-playback" : ""}${
        isNightMode ? " is-night-mode" : ""
      }`}
      aria-label="谱页"
    >
      <div
        ref={rendererTargetRef}
        className={`staff-page-renderer${isScrolling ? " staff-page-renderer-scrolling" : ""}`}
      />
      {onToggleRowPlayback && !isScrolling ? (
        <div className="staff-page-row-playback">
          {visiblePlaybackRows.map((row, rowIndex) => {
            if (row.length === 0) return null;
            const isPlaying = playingRowIndex === rowIndex;
            return (
              <button
                aria-label={`${isPlaying ? "停止" : "播放"}第 ${rowIndex + 1} 行`}
                aria-pressed={isPlaying}
                className={`staff-page-row-play-button${isPlaying ? " is-playing" : ""}`}
                key={rowIndex}
                style={{
                  top: rowPlaybackButtonCenters[rowIndex],
                  visibility:
                    rowPlaybackButtonCenters[rowIndex] === undefined ? "hidden" : undefined,
                }}
                title={`${isPlaying ? "停止" : "播放"}当前行`}
                type="button"
                onClick={() => onToggleRowPlayback(rowIndex)}
              >
                {isPlaying ? (
                  <Square aria-hidden="true" size={16} />
                ) : (
                  <Play aria-hidden="true" size={16} />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
