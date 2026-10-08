import { useEffect, useRef } from "react";

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetY: number;
  color: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  radius: number;
  color: string;
}

const FIREWORK_COLORS = ["#fff4c4", "#ffffff", "#ffd45b", "#7de7ff", "#ff94cf"];

export function StaffGameFireworks({ image }: { image: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let width = 0;
    let height = 0;
    let frame = 0;
    let nextLaunchAt = 20;
    let lastFrameAt = performance.now();
    const startedAt = lastFrameAt;
    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const launchRocket = (): void => {
      const x = width * (0.22 + Math.random() * 0.56);
      rockets.push({
        x,
        y: height + 3,
        vx: (Math.random() - 0.5) * 0.24,
        vy: -2.4 - Math.random() * 0.55,
        targetY: height * (0.3 + Math.random() * 0.25),
        color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
      });
    };

    const explode = (rocket: Rocket): void => {
      const count = 22 + Math.floor(Math.random() * 13);
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.45 + Math.random() * 1.65;
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          lifetime: 430 + Math.random() * 390,
          radius: 0.8 + Math.random() * 1.35,
          color: Math.random() < 0.72 ? rocket.color : FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
        });
      }
    };

    resize();
    window.addEventListener("resize", resize);

    const tick = (now: number): void => {
      const elapsed = now - startedAt;
      const deltaMs = Math.min(40, now - lastFrameAt);
      const step = Math.min(2.5, Math.max(0.5, deltaMs / 16.67));
      lastFrameAt = now;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      if (elapsed >= nextLaunchAt) {
        launchRocket();
        nextLaunchAt = elapsed + 760 + Math.random() * 560;
      }

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index];
        context.globalAlpha = 0.86;
        context.strokeStyle = rocket.color;
        context.lineWidth = 1.2;
        context.shadowColor = rocket.color;
        context.shadowBlur = 5;
        context.beginPath();
        context.moveTo(rocket.x, rocket.y + 8);
        context.lineTo(rocket.x, rocket.y);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(rocket.x, rocket.y, 1.5, 0, Math.PI * 2);
        context.fill();

        rocket.x += rocket.vx * step;
        rocket.y += rocket.vy * step;
        rocket.vy += 0.045 * step;
        if (rocket.y <= rocket.targetY || rocket.vy >= 0) {
          explode(rocket);
          rockets.splice(index, 1);
        }
      }

      context.shadowBlur = 7;
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.age += deltaMs;
        const remaining = Math.max(0, 1 - spark.age / spark.lifetime);
        if (remaining <= 0) {
          sparks.splice(index, 1);
          continue;
        }
        spark.x += spark.vx * step;
        spark.y += spark.vy * step;
        spark.vy += 0.025 * step;
        spark.vx *= 0.987;
        spark.vy *= 0.987;
        context.globalAlpha = remaining * 0.88;
        context.fillStyle = spark.color;
        context.shadowColor = spark.color;
        context.beginPath();
        context.arc(spark.x, spark.y, spark.radius * (0.45 + remaining * 0.55), 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.shadowBlur = 0;
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div aria-hidden="true" className="staff-game-result-fireworks">
      <img alt="" draggable="false" src={image} />
      <canvas className="staff-game-fireworks-canvas" ref={canvasRef} />
    </div>
  );
}
