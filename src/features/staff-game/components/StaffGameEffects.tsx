import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { STAFF_GAME_ART } from "../logic/staffGameResources";

const {
  mascotCelebrationFrames,
  mascotCheerFrames,
  mascotPauseFrames,
  mascotSadFrames,
} = STAFF_GAME_ART;

interface FireflyParticle {
  id: number;
  left: string;
  top: string;
  size: string;
  opacity: string;
  duration: string;
  delay: string;
  driftX: string;
  driftY: string;
  midX: string;
  midY: string;
  moving: boolean;
}

export type StaffGameMascotAction = "idle" | "cheer" | "sad" | "summarySad" | "pause" | "celebration";

interface MascotAnimationLayer {
  id: number;
  action: StaffGameMascotAction;
  token: number;
}

const MASCOT_FRAME_SHEETS: Record<StaffGameMascotAction, string> = {
  idle: mascotSadFrames,
  cheer: mascotCheerFrames,
  sad: mascotSadFrames,
  summarySad: mascotSadFrames,
  pause: mascotPauseFrames,
  celebration: mascotCelebrationFrames,
};

const MASCOT_ANIMATIONS: Record<StaffGameMascotAction, {
  frames: number[];
  frameDurationMs: number;
  loop?: boolean;
  holdFrame?: number;
  holdMs?: number;
}> = {
  // The idle pose is the same neutral end frame used by the sad recovery animation.
  idle: { frames: [6], frameDurationMs: 100, loop: true },
  // Keep the brief takeoff anticipation, then move through the peak and descent without a repeated midair frame.
  cheer: { frames: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8], frameDurationMs: 80, holdFrame: 8, holdMs: 140 },
  // Finish on the shared neutral frame so the face recovers during the animation, not after a pause.
  sad: { frames: [6, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], frameDurationMs: 95, holdFrame: 6, holdMs: 250 },
  // Settlement starts from the shared neutral frame and ends on the sad pose without the smile frame.
  summarySad: { frames: [6, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5], frameDurationMs: 95, holdFrame: 5 },
  pause: { frames: [0, 1, 2, 3, 4, 5], frameDurationMs: 100, holdFrame: 5 },
  celebration: { frames: [0, 1, 2, 3, 4, 5, 6, 7, 8], frameDurationMs: 90, holdFrame: 8 },
};

const MASCOT_STATIC_FRAMES: Record<StaffGameMascotAction, number> = {
  idle: 6,
  cheer: 4,
  sad: 5,
  summarySad: 5,
  pause: 5,
  celebration: 8,
};

// The original 3x3 atlases have 2px gutters around each 256px frame.
const MASCOT_FRAME_BACKGROUND_POSITIONS = ["0.381679%", "50%", "99.618321%"] as const;

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (): void => setPrefersReducedMotion(query.matches);
    updatePreference();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", updatePreference);
      return () => query.removeEventListener("change", updatePreference);
    }
    query.addListener(updatePreference);
    return () => query.removeListener(updatePreference);
  }, []);

  return prefersReducedMotion;
}

interface MascotAnimationLayerProps {
  action: StaffGameMascotAction;
  token: number;
  active: boolean;
  animate: boolean;
  holdFrameOverride?: number;
  onComplete?: (token: number) => void;
}

function MascotAnimationLayer({ action, token, active, animate, holdFrameOverride, onComplete }: MascotAnimationLayerProps): JSX.Element {
  const [frame, setFrame] = useState(MASCOT_ANIMATIONS[action].frames[0]);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animate && !prefersReducedMotion;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const animation = MASCOT_ANIMATIONS[action];
    const frames = shouldAnimate ? animation.frames : [MASCOT_STATIC_FRAMES[action]];
    let frameIndex = 0;
    let completionTimeout: number | null = null;
    if (!active) return undefined;
    setFrame(frames[0]);
    if (!shouldAnimate) {
      if (animation.loop || !onComplete) return undefined;
      const staticPoseDurationMs = animation.frames.length * animation.frameDurationMs + (animation.holdMs ?? 0);
      completionTimeout = window.setTimeout(() => {
        if (activeRef.current) onComplete(token);
      }, staticPoseDurationMs);
      return () => {
        if (completionTimeout !== null) window.clearTimeout(completionTimeout);
      };
    }
    if (frames.length === 1) return undefined;

    const interval = window.setInterval(() => {
      if (animation.loop) {
        frameIndex = (frameIndex + 1) % frames.length;
        setFrame(frames[frameIndex]);
        return;
      }

      if (frameIndex < frames.length - 1) {
        frameIndex += 1;
        setFrame(frames[frameIndex]);
        return;
      }

      window.clearInterval(interval);
      const heldFrame = holdFrameOverride ?? animation.holdFrame;
      if (heldFrame !== undefined) setFrame(heldFrame);
      if (activeRef.current && onComplete && animation.holdMs) {
        completionTimeout = window.setTimeout(() => onComplete(token), animation.holdMs);
      } else if (activeRef.current && onComplete) {
        onComplete(token);
      }
    }, animation.frameDurationMs);

    return () => {
      window.clearInterval(interval);
      if (completionTimeout !== null) window.clearTimeout(completionTimeout);
    };
  }, [action, active, holdFrameOverride, onComplete, shouldAnimate, token]);

  // Derive the static pose during render so disabling effects cannot paint one more
  // stale animation frame while the interval cleanup runs.
  const animationFrames = MASCOT_ANIMATIONS[action].frames;
  const currentFrame = shouldAnimate ? frame : MASCOT_STATIC_FRAMES[action];
  const displayedFrame = shouldAnimate && !animationFrames.includes(currentFrame)
    ? animationFrames[0]
    : currentFrame;
  const visualAction = action === "summarySad" ? "sad" : action;
  const column = displayedFrame % 3;
  const row = Math.floor(displayedFrame / 3);
  const style: CSSProperties = {
    backgroundImage: `url("${MASCOT_FRAME_SHEETS[action]}")`,
    backgroundSize: "304.6875% 304.6875%",
    backgroundPosition: `${MASCOT_FRAME_BACKGROUND_POSITIONS[column]} ${MASCOT_FRAME_BACKGROUND_POSITIONS[row]}`,
  };

  return (
    <div
      aria-hidden="true"
      className={`staff-game-mascot-sprite${active ? " is-current" : " is-leaving"} is-${visualAction}`}
      data-action={action}
      data-frame={displayedFrame}
      draggable={false}
      style={style}
    />
  );
}

interface StaffGameMascotProps {
  action: StaffGameMascotAction;
  token: number;
  animate: boolean;
  holdFrame?: number;
  className?: string;
  onComplete?: (token: number) => void;
}

export function StaffGameMascot({ action, token, animate, holdFrame, className = "", onComplete }: StaffGameMascotProps): JSX.Element {
  const nextLayerIdRef = useRef(0);
  const currentIdentityRef = useRef({ action, token });
  const [layers, setLayers] = useState<MascotAnimationLayer[]>(() => [{ id: 0, action, token }]);

  useLayoutEffect(() => {
    if (currentIdentityRef.current.action === action && currentIdentityRef.current.token === token) return undefined;
    const previousAction = currentIdentityRef.current.action;
    currentIdentityRef.current = { action, token };

    const nextLayer: MascotAnimationLayer = { id: ++nextLayerIdRef.current, action, token };
    if (!animate) {
      setLayers([nextLayer]);
      return undefined;
    }

    // Idle and sad share one atlas; reuse the layer in either direction to avoid a translucent crossfade dip.
    if ((previousAction === "sad" && action === "idle") || (previousAction === "idle" && action === "sad")) {
      setLayers((currentLayers) => {
        const activeLayer = currentLayers.at(-1);
        return activeLayer ? [{ ...activeLayer, action, token }] : [nextLayer];
      });
      return undefined;
    }

    setLayers((currentLayers) => [...currentLayers.slice(-1), nextLayer]);
    const transitionTimeout = window.setTimeout(() => {
      setLayers((currentLayers) => currentLayers.filter((layer) => layer.id === nextLayer.id));
    }, 170);
    return () => window.clearTimeout(transitionTimeout);
  }, [action, animate, token]);

  return (
    <div aria-hidden="true" className={`staff-game-mascot${animate ? "" : " effects-disabled"}${className ? ` ${className}` : ""}`}>
      {layers.map((layer, index) => (
        <MascotAnimationLayer
          action={layer.action}
          active={index === layers.length - 1}
          animate={animate}
          holdFrameOverride={holdFrame}
          key={layer.id}
          onComplete={onComplete}
          token={layer.token}
        />
      ))}
    </div>
  );
}

export function StaffGameParticles(): JSX.Element {
  const [particles] = useState<FireflyParticle[]>(() => {
    const clusters = Array.from({ length: 14 }, () => ({
      x: 2 + Math.random() * 96,
      y: 2 + Math.random() * 96,
      radiusX: 8 + Math.random() * 20,
      radiusY: 8 + Math.random() * 18,
    }));
    const pickCluster = (): (typeof clusters)[number] => {
      return clusters[Math.floor(Math.random() * clusters.length)];
    };
    const spreadAround = (center: number, radius: number): number => center + ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * radius * 2;
    const clampPercent = (value: number): number => Math.max(1, Math.min(99, value));

    return Array.from({ length: 112 }, (_, id) => {
      const clustered = Math.random() < 0.68;
      const cluster = clustered ? pickCluster() : null;
      const left = cluster ? clampPercent(spreadAround(cluster.x, cluster.radiusX)) : 2 + Math.random() * 96;
      const top = cluster ? clampPercent(spreadAround(cluster.y, cluster.radiusY)) : 2 + Math.random() * 96;
      const driftX = (Math.random() - 0.5) * 54;
      const driftY = (Math.random() - 0.5) * 42;
      return {
        id,
        left: `${left}%`,
        top: `${top}%`,
        size: `${id % 13 === 0 ? 3.8 + Math.random() * 1.8 : 1.5 + Math.random() * 3.2}px`,
        opacity: `${id % 13 === 0 ? 0.46 + Math.random() * 0.24 : 0.28 + Math.random() * 0.32}`,
        duration: `${11 + Math.random() * 13}s`,
        delay: `${-Math.random() * 22}s`,
        driftX: `${driftX}vw`,
        driftY: `${driftY}vh`,
        midX: `${driftX * 0.52}vw`,
        midY: `${driftY * 0.52}vh`,
        moving: Math.random() > 0.28,
      };
    });
  });

  return (
    <div aria-hidden="true" className="staff-game-fireflies">
      {particles.map((particle) => (
        <i
          className={`staff-game-firefly${particle.moving ? " is-moving" : ""}`}
          key={particle.id}
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            opacity: particle.moving ? undefined : particle.opacity,
            "--firefly-opacity": particle.opacity,
            "--firefly-duration": particle.duration,
            "--firefly-delay": particle.delay,
            "--firefly-drift-x": particle.driftX,
            "--firefly-drift-y": particle.driftY,
            "--firefly-mid-x": particle.midX,
            "--firefly-mid-y": particle.midY,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

interface RushSpeedLine {
  id: number;
  left: string;
  width: string;
  height: string;
  opacity: string;
  duration: string;
  delay: string;
}

export function StaffGameRushSpeedLines(): JSX.Element {
  const [lines] = useState<RushSpeedLine[]>(() => Array.from({ length: 16 }, (_, id) => {
    const durationSeconds = 0.2 + Math.random() * 0.4;
    return {
      id,
      left: `${Math.random() * 100}%`,
      width: `${1.5 + Math.random()}px`,
      height: `${30 + Math.random() * 150}px`,
      opacity: `${0.2 + Math.random() * 0.6}`,
      duration: `${durationSeconds}s`,
      delay: `${-Math.random() * durationSeconds}s`,
    };
  }));

  return (
    <div aria-hidden="true" className="staff-game-speed-lines">
      {lines.map((line) => (
        <div
          className="staff-game-speed-line"
          key={line.id}
          style={{
            left: line.left,
            width: line.width,
            height: line.height,
            opacity: line.opacity,
            animationDuration: line.duration,
            animationDelay: line.delay,
          }}
        />
      ))}
    </div>
  );
}

interface ShootingStar {
  id: number;
  left: string;
  top: string;
  width: string;
  angle: string;
  travelX: string;
  travelY: string;
  duration: string;
}

export function StaffGameShootingStar(): JSX.Element {
  const [meteor, setMeteor] = useState<ShootingStar | null>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const launch = (): void => {
      const travelX = (Math.random() < 0.5 ? -1 : 1) * window.innerWidth * (0.22 + Math.random() * 0.3);
      const travelY = (Math.random() < 0.5 ? -1 : 1) * window.innerHeight * (0.04 + Math.random() * 0.08);
      const angle = Math.atan2(travelY, travelX) * (180 / Math.PI);
      setMeteor({
        id: nextIdRef.current++,
        left: `${Math.random() * 100}%`,
        top: `${3 + Math.random() * 34}%`,
        width: `${130 + Math.random() * 110}px`,
        angle: `${angle}deg`,
        travelX: `${travelX}px`,
        travelY: `${travelY}px`,
        duration: `${2800 + Math.random() * 900}ms`,
      });
    };

    const intervalId = window.setInterval(launch, 4_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div aria-hidden="true" className="staff-game-shooting-star-layer">
      {meteor ? (
        <i
          className="staff-game-shooting-star"
          key={meteor.id}
          onAnimationEnd={() => setMeteor((current) => current?.id === meteor.id ? null : current)}
          style={{
            left: meteor.left,
            top: meteor.top,
            width: meteor.width,
            animationDuration: meteor.duration,
            "--meteor-angle": meteor.angle,
            "--meteor-travel-x": meteor.travelX,
            "--meteor-travel-y": meteor.travelY,
          } as CSSProperties}
        />
      ) : null}
    </div>
  );
}
