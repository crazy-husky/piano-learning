import { StaveNote } from "vexflow";
import type { Staff } from "../../../domain/types";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PLAYBACK_PARTICLE_LIFETIME_MS = 1200;
const CHASE_REFERENCE_SPEED_MULTIPLIER = 1.5;
const LANDING_BOUNCE_DURATION_SECONDS = 0.4;
let playbackCursorLayerId = 0;

export interface PlaybackCursorPoint {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export type PlaybackCursorTargets = Partial<Record<Staff, PlaybackCursorPoint[]>>;

export type PlaybackNoteHeadElements = Partial<Record<Staff, SVGElement[]>>;

export interface PlaybackCursorLayer {
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

export interface ActivePlaybackMotion {
  controlPoint: PlaybackCursorPoint | null;
  cursor: object | null;
  endPoint: PlaybackCursorPoint | null;
  lastParticlePoint: PlaybackCursorPoint | null;
  lastParticleProgress: number | null;
  layer: PlaybackCursorLayer | null;
  startPoint: PlaybackCursorPoint | null;
}

export function chaseParticleLifetimeMs(speedMultiplier: number): number {
  const speed = Math.max(0.1, speedMultiplier);
  return Math.round((PLAYBACK_PARTICLE_LIFETIME_MS * CHASE_REFERENCE_SPEED_MULTIPLIER) / speed);
}

export function playbackCursorLayerKey(rowIndex: number, staff: Staff): string {
  return `${rowIndex}:${staff}`;
}

export function createPlaybackCursorLayer(
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

export function setPlaybackCursorLayerVisibility(
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

export function clearPlaybackCursorLayer(layer: PlaybackCursorLayer): void {
  setPlaybackCursorLayerVisibility(layer, false, false);
  if (layer.particleLayer.childElementCount > 0) layer.particleLayer.replaceChildren();
  if (layer.rippleLayer.childElementCount > 0) layer.rippleLayer.replaceChildren();
  layer.element.classList.remove("is-catching");
}

export function noteHeadCursorPoints(staveNote: StaveNote): PlaybackCursorPoint[] {
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

export function pointOnQuadraticArc(
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

export function pointWithLandingBounce(
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

export function pointOnBouncedArc(
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

export function sampledArcLengthBetween(
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

export function spawnPlaybackArcParticles(
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

export function spawnPlaybackRipple(layer: PlaybackCursorLayer, point: PlaybackCursorPoint): void {
  const ripple = document.createElementNS(SVG_NAMESPACE, "circle");
  ripple.setAttribute("class", "playback-cursor-ripple");
  ripple.setAttribute("cx", point.x.toFixed(2));
  ripple.setAttribute("cy", point.y.toFixed(2));
  ripple.setAttribute("r", "2");
  ripple.setAttribute("vector-effect", "non-scaling-stroke");
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  layer.rippleLayer.appendChild(ripple);
}

export function spawnPlaybackParticle(
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

export function setEllipsePosition(ellipse: SVGEllipseElement, point: PlaybackCursorPoint): void {
  ellipse.setAttribute("cx", point.x.toFixed(2));
  ellipse.setAttribute("cy", point.y.toFixed(2));
}

export function setEllipsePoint(
  ellipse: SVGEllipseElement,
  point: PlaybackCursorPoint,
  paddingX = 0,
  paddingY = 0
): void {
  setEllipsePosition(ellipse, point);
  ellipse.setAttribute("rx", (point.rx + paddingX).toFixed(2));
  ellipse.setAttribute("ry", (point.ry + paddingY).toFixed(2));
}

export function getContiguousMeasureNumbers(measures: readonly (number | undefined)[]): number[] {
  const definedMeasures = measures
    .filter((measure): measure is number => measure !== undefined && Number.isFinite(measure))
    .map((measure) => Math.floor(measure));
  if (definedMeasures.length === 0) return [];
  const firstMeasure = Math.min(...definedMeasures);
  const lastMeasure = Math.max(...definedMeasures);
  return Array.from({ length: lastMeasure - firstMeasure + 1 }, (_, index) => firstMeasure + index);
}

export function playbackEventKey(rowIndex: number, eventIndices: readonly number[]): string {
  return `${rowIndex}:${eventIndices.join(",")}`;
}

export function basePlaybackTrailCount(): number {
  if (typeof navigator === "undefined") return 3;
  const isIPad =
    /iPad/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isIPad || (deviceMemory !== undefined && deviceMemory <= 4) ? 1 : 3;
}

export function playbackAmbientPulse(audioTime: number, staff: Staff): string {
  const phase = staff === "bass" ? Math.PI : 0;
  const pulse = 0.68 + ((Math.sin(audioTime * Math.PI * 1.6 + phase) + 1) / 2) * 0.14;
  return pulse.toFixed(3);
}

export function setPlaybackHighlight(
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

export function flashPlaybackNoteHighlight(
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
