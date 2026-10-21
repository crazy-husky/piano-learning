import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Staff } from "../../../domain/types";
import type {
  ScoreChaseCursor,
  ScoreChaseEvent,
  ScoreChaseSegmentDuration,
  ScoreChaseStaffCursor,
} from "../logic/scoreChase";

interface ScoreChaseLaneRuntime {
  caughtAtAudioTime: number | null;
  caughtCount: number;
  cursor: ScoreChaseStaffCursor | null;
  cursorQueueIndex: number;
  phase: "waiting" | "chasing" | "caught";
  playedEvents: ScoreChaseEvent[];
}

interface UseScoreChaseOptions {
  activeStaves: readonly Staff[];
  enabled: boolean;
  events: readonly ScoreChaseEvent[];
  getAudioTime: () => number;
  paused: boolean;
  segmentDurationSeconds?: ScoreChaseSegmentDuration;
  speedMultiplier: number;
  startCount: number;
  tempoBpm: number;
}

const CATCH_FEEDBACK_SECONDS = 0.76;
const MIN_JUMP_SECONDS = 0.08;

function createLane(): ScoreChaseLaneRuntime {
  return {
    caughtAtAudioTime: null,
    caughtCount: 0,
    cursor: null,
    cursorQueueIndex: 0,
    phase: "waiting",
    playedEvents: [],
  };
}

function createLanes(): Record<Staff, ScoreChaseLaneRuntime> {
  return { treble: createLane(), bass: createLane() };
}

function defaultSegmentDurationSeconds(
  fromEvent: ScoreChaseEvent,
  toEvent: ScoreChaseEvent,
  tempoBpm: number,
  speedMultiplier: number
): number {
  const beatDistance = Math.max(0.05, toEvent.beatPosition - fromEvent.beatPosition);
  const duration = (beatDistance * 60) / (Math.max(1, tempoBpm) * Math.max(0.1, speedMultiplier));
  return Math.max(MIN_JUMP_SECONDS, duration);
}

function snapshotLanes(
  lanes: Record<Staff, ScoreChaseLaneRuntime>,
  speedMultiplier: number
): ScoreChaseCursor | null {
  const staffCursors: Partial<Record<Staff, ScoreChaseStaffCursor>> = {};
  (Object.keys(lanes) as Staff[]).forEach((staff) => {
    const cursor = lanes[staff].cursor;
    if (cursor) staffCursors[staff] = cursor;
  });
  return Object.keys(staffCursors).length > 0 ? { speedMultiplier, staffCursors } : null;
}

export function useScoreChase({
  activeStaves,
  enabled,
  events,
  getAudioTime,
  paused,
  segmentDurationSeconds,
  speedMultiplier,
  startCount,
  tempoBpm,
}: UseScoreChaseOptions): {
  cursor: ScoreChaseCursor | null;
  recordCorrectTarget: (eventIndex: number) => void;
  reset: () => void;
} {
  const lanesRef = useRef(createLanes());
  const [cursor, setCursor] = useState<ScoreChaseCursor | null>(null);
  const frameRef = useRef<number | null>(null);
  const scheduleRef = useRef<() => void>(() => {});
  const pausedRef = useRef(paused);
  const pausedAtAudioTimeRef = useRef<number | null>(null);
  const previousSpeedRef = useRef(speedMultiplier);
  const previousActiveStavesRef = useRef(new Set(activeStaves));
  const activeStavesKey = [...activeStaves].sort().join("|");
  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.eventIndex, event])),
    [events]
  );
  const optionsRef = useRef({
    activeStaves,
    eventMap,
    getAudioTime,
    segmentDurationSeconds,
    speedMultiplier,
    startCount,
    tempoBpm,
  });
  optionsRef.current = {
    activeStaves,
    eventMap,
    getAudioTime,
    segmentDurationSeconds,
    speedMultiplier,
    startCount,
    tempoBpm,
  };
  pausedRef.current = paused;

  const publish = useCallback((): void => {
    setCursor(snapshotLanes(lanesRef.current, optionsRef.current.speedMultiplier));
  }, []);

  const reset = useCallback((): void => {
    lanesRef.current = createLanes();
    pausedAtAudioTimeRef.current = null;
    setCursor(null);
  }, []);

  const durationFor = useCallback(
    (fromEvent: ScoreChaseEvent, toEvent: ScoreChaseEvent): number => {
      const current = optionsRef.current;
      const duration = current.segmentDurationSeconds
        ? current.segmentDurationSeconds(fromEvent, toEvent, current.speedMultiplier)
        : defaultSegmentDurationSeconds(
            fromEvent,
            toEvent,
            current.tempoBpm,
            current.speedMultiplier
          );
      return Number.isFinite(duration) ? Math.max(MIN_JUMP_SECONDS, duration) : MIN_JUMP_SECONDS;
    },
    []
  );

  const cursorForSegment = useCallback(
    (
      staff: Staff,
      fromEvent: ScoreChaseEvent,
      toEvent: ScoreChaseEvent,
      startAudioTime: number
    ): ScoreChaseStaffCursor => ({
      caught: false,
      currentEventIndices: [fromEvent.eventIndex],
      endAudioTime: startAudioTime + durationFor(fromEvent, toEvent),
      nextEventIndices: [toEvent.eventIndex],
      staff,
      startAudioTime,
    }),
    [durationFor]
  );

  useEffect(() => {
    lanesRef.current = createLanes();
    pausedAtAudioTimeRef.current = null;
    setCursor(null);
    scheduleRef.current = () => {};
    if (!enabled) return undefined;

    let disposed = false;
    const startLane = (staff: Staff, lane: ScoreChaseLaneRuntime, startAudioTime: number): void => {
      const firstQueueIndex = lane.caughtCount;
      const firstEvent = lane.playedEvents[firstQueueIndex];
      const nextEvent = lane.playedEvents[firstQueueIndex + 1];
      if (!firstEvent || !nextEvent) return;
      lane.phase = "chasing";
      lane.cursorQueueIndex = firstQueueIndex;
      lane.cursor = cursorForSegment(staff, firstEvent, nextEvent, startAudioTime);
    };

    const tick = (): void => {
      frameRef.current = null;
      if (disposed) return;
      const now = optionsRef.current.getAudioTime();
      if (!Number.isFinite(now)) {
        schedule();
        return;
      }
      if (pausedRef.current) {
        if (pausedAtAudioTimeRef.current === null) pausedAtAudioTimeRef.current = now;
        return;
      }
      if (pausedAtAudioTimeRef.current !== null) {
        const pausedDuration = Math.max(0, now - pausedAtAudioTimeRef.current);
        (Object.keys(lanesRef.current) as Staff[]).forEach((staff) => {
          const lane = lanesRef.current[staff];
          if (lane.cursor) {
            lane.cursor = {
              ...lane.cursor,
              startAudioTime: lane.cursor.startAudioTime + pausedDuration,
              endAudioTime:
                lane.cursor.endAudioTime === null
                  ? null
                  : lane.cursor.endAudioTime + pausedDuration,
            };
          }
          if (lane.caughtAtAudioTime !== null) lane.caughtAtAudioTime += pausedDuration;
        });
        pausedAtAudioTimeRef.current = null;
        publish();
      }

      let changed = false;
      let hasActiveLane = false;
      const activeStaves = new Set(optionsRef.current.activeStaves);
      (Object.keys(lanesRef.current) as Staff[]).forEach((staff) => {
        const lane = lanesRef.current[staff];
        if (!activeStaves.has(staff)) {
          if (lane.phase !== "waiting" || lane.cursor || lane.playedEvents.length > 0) {
            lanesRef.current[staff] = createLane();
            changed = true;
          }
          return;
        }
        if (lane.phase === "caught") {
          if (
            lane.caughtAtAudioTime !== null &&
            now - lane.caughtAtAudioTime >= CATCH_FEEDBACK_SECONDS
          ) {
            lane.phase = "waiting";
            lane.cursor = null;
            lane.caughtAtAudioTime = null;
            changed = true;
            if (lane.playedEvents.length - lane.caughtCount >= optionsRef.current.startCount) {
              startLane(staff, lane, now);
              changed = true;
            }
          } else {
            hasActiveLane = true;
          }
        }
        if (lane.phase !== "chasing") return;
        hasActiveLane = true;
        let safety = 0;
        while (
          lane.cursor?.endAudioTime !== null &&
          lane.cursor?.endAudioTime !== undefined &&
          now >= lane.cursor.endAudioTime &&
          safety < 64
        ) {
          safety += 1;
          const arrivalAudioTime = lane.cursor.endAudioTime;
          const arrivedQueueIndex = lane.cursorQueueIndex + 1;
          const arrivedEvent = lane.playedEvents[arrivedQueueIndex];
          if (!arrivedEvent) break;
          if (arrivedQueueIndex >= lane.playedEvents.length - 1) {
            lane.cursorQueueIndex = 0;
            lane.caughtCount = 0;
            lane.phase = "caught";
            lane.caughtAtAudioTime = now;
            lane.cursor = {
              caught: true,
              currentEventIndices: [arrivedEvent.eventIndex],
              endAudioTime: null,
              nextEventIndices: null,
              staff,
              startAudioTime: now,
            };
            lane.playedEvents = [];
            changed = true;
            break;
          }
          const nextEvent = lane.playedEvents[arrivedQueueIndex + 1];
          if (!nextEvent) break;
          lane.cursorQueueIndex = arrivedQueueIndex;
          lane.cursor = cursorForSegment(staff, arrivedEvent, nextEvent, arrivalAudioTime);
          changed = true;
        }
      });

      if (changed) publish();
      if (hasActiveLane) schedule();
    };

    function schedule(): void {
      if (disposed || frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(tick);
    }

    scheduleRef.current = schedule;
    return () => {
      disposed = true;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      scheduleRef.current = () => {};
    };
  }, [cursorForSegment, enabled, publish]);

  useEffect(() => {
    const previousStaves = previousActiveStavesRef.current;
    const nextStaves = new Set(activeStavesKey ? (activeStavesKey.split("|") as Staff[]) : []);
    previousActiveStavesRef.current = nextStaves;
    let changed = false;
    (Object.keys(lanesRef.current) as Staff[]).forEach((staff) => {
      if (previousStaves.has(staff) && !nextStaves.has(staff)) {
        lanesRef.current[staff] = createLane();
        changed = true;
      }
    });
    if (changed) {
      publish();
      scheduleRef.current();
    }
  }, [activeStavesKey, publish]);

  useEffect(() => {
    if (!paused) scheduleRef.current();
  }, [paused]);

  useEffect(() => {
    const previousSpeed = previousSpeedRef.current;
    previousSpeedRef.current = speedMultiplier;
    if (previousSpeed === speedMultiplier) return;
    const now = getAudioTime();
    if (!Number.isFinite(now)) return;
    (Object.keys(lanesRef.current) as Staff[]).forEach((staff) => {
      const lane = lanesRef.current[staff];
      if (lane.phase !== "chasing" || !lane.cursor || lane.cursor.endAudioTime === null) return;
      const fromEvent = lane.playedEvents[lane.cursorQueueIndex];
      const toEvent = lane.playedEvents[lane.cursorQueueIndex + 1];
      if (!fromEvent || !toEvent) return;
      const previousDuration = lane.cursor.endAudioTime - lane.cursor.startAudioTime;
      const progress =
        previousDuration > 0
          ? Math.max(0, Math.min(1, (now - lane.cursor.startAudioTime) / previousDuration))
          : 0;
      const current = optionsRef.current;
      const nextDuration = current.segmentDurationSeconds
        ? current.segmentDurationSeconds(fromEvent, toEvent, current.speedMultiplier)
        : defaultSegmentDurationSeconds(
            fromEvent,
            toEvent,
            current.tempoBpm,
            current.speedMultiplier
          );
      const duration = Math.max(MIN_JUMP_SECONDS, nextDuration);
      const nextStartAudioTime = now - progress * duration;
      lane.cursor = {
        ...lane.cursor,
        startAudioTime: nextStartAudioTime,
        endAudioTime: nextStartAudioTime + duration,
      };
    });
    publish();
  }, [getAudioTime, publish, speedMultiplier]);

  const recordCorrectTarget = useCallback(
    (eventIndex: number): void => {
      const currentOptions = optionsRef.current;
      if (!enabled || pausedRef.current) return;
      const event = currentOptions.eventMap.get(eventIndex);
      if (!event) return;
      const now = currentOptions.getAudioTime();
      let changed = false;
      currentOptions.activeStaves.forEach((staff) => {
        if (!event.staves.includes(staff)) return;
        const lane = lanesRef.current[staff];
        if (lane.playedEvents.at(-1)?.eventIndex === eventIndex) return;
        lane.playedEvents.push({ ...event, staves: [...event.staves] });
        changed = true;
        if (
          lane.phase === "waiting" &&
          lane.playedEvents.length - lane.caughtCount >= currentOptions.startCount &&
          Number.isFinite(now)
        ) {
          const firstQueueIndex = lane.caughtCount;
          const firstEvent = lane.playedEvents[firstQueueIndex];
          const nextEvent = lane.playedEvents[firstQueueIndex + 1];
          if (firstEvent && nextEvent) {
            lane.phase = "chasing";
            lane.cursorQueueIndex = firstQueueIndex;
            lane.cursor = cursorForSegment(staff, firstEvent, nextEvent, now);
          }
        }
      });
      if (changed) {
        publish();
        scheduleRef.current();
      }
    },
    [cursorForSegment, enabled, publish]
  );

  return { cursor, recordCorrectTarget, reset };
}
