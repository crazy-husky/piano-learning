import { Maximize2, Minimize2, Minus, Pause, Play, Plus, Volume2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from "react";
import type { MetronomeController } from "../useMetronomeController";
import type { MetronomeBeatSound } from "../metronomePreferences";
import { WoodfishIllustration } from "./WoodfishIllustration";

type MetronomeCoreVariant = "page" | "panel" | "compact";

interface MetronomeCoreProps {
  controller: MetronomeController;
  onSynchronizedToggle?: () => void;
  onStarted?: () => void;
  onExpand?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  closeLabel?: string;
  onOpenMenu?: () => void;
  mini?: boolean;
  miniDockEdge?: "left" | "right" | null;
  onRevealMini?: () => void;
  onMiniPointerEnter?: () => void;
  onMiniPointerLeave?: () => void;
  menu?: ReactNode;
  variant: MetronomeCoreVariant;
}

const TEMPO_MIN = 30;
const TEMPO_MAX = 240;
const TEMPO_PRESETS = [60, 90, 120, 150] as const;
const BEAT_SOUND_LABELS: Record<MetronomeBeatSound, string> = {
  woodfish1: "木鱼原声",
  woodfish2: "木鱼音色 A",
  woodfish3: "木鱼音色 B",
  mute: "静音",
};
const BEAT_SOUND_MARKS: Record<MetronomeBeatSound, string> = {
  woodfish1: "原",
  woodfish2: "A",
  woodfish3: "B",
  mute: "静",
};

function getSliderStyle(bpm: number): CSSProperties {
  return {
    "--tempo-progress": `${((bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)) * 100}%`,
  } as CSSProperties;
}

function useTempoEditor(controller: MetronomeController) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(controller.preferences.bpm));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(String(controller.preferences.bpm));
  }, [controller.preferences.bpm, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = (): void => {
    controller.setBpm(Number(draft));
    setIsEditing(false);
  };

  return { commit, draft, inputRef, isEditing, setDraft, setIsEditing };
}

function TempoValue({
  controller,
  className,
}: {
  controller: MetronomeController;
  className: string;
}): JSX.Element {
  const { commit, draft, inputRef, isEditing, setDraft, setIsEditing } = useTempoEditor(controller);
  return isEditing ? (
    <input
      aria-label="每分钟节拍数 BPM"
      className={`${className} metronome-tempo-input`}
      inputMode="numeric"
      max={TEMPO_MAX}
      min={TEMPO_MIN}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(String(controller.preferences.bpm));
          setIsEditing(false);
        }
      }}
      ref={inputRef}
      type="number"
      value={draft}
    />
  ) : (
    <button
      aria-label={`当前速度 ${controller.preferences.bpm} BPM，点击输入`}
      className={className}
      onClick={() => setIsEditing(true)}
      type="button"
    >
      {controller.preferences.bpm}
    </button>
  );
}

function TempoSlider({ controller }: { controller: MetronomeController }): JSX.Element {
  return (
    <div className="metronome-tempo-slider-wrap">
      <div aria-hidden="true" className="metronome-tempo-ruler" />
      <input
        aria-label="调节速度"
        className="metronome-tempo-slider"
        max={TEMPO_MAX}
        min={TEMPO_MIN}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          controller.setBpm(Number(event.currentTarget.value))
        }
        style={getSliderStyle(controller.preferences.bpm)}
        type="range"
        value={controller.preferences.bpm}
      />
      <span aria-hidden="true" className="metronome-tempo-indicator" />
    </div>
  );
}

function TempoPresets({ controller }: { controller: MetronomeController }): JSX.Element {
  return (
    <div aria-label="快捷速度" className="metronome-tempo-presets" role="group">
      {TEMPO_PRESETS.map((bpm) => (
        <button
          aria-label={`设为 ${bpm} BPM`}
          aria-pressed={controller.preferences.bpm === bpm}
          className={`metronome-tempo-preset${controller.preferences.bpm === bpm ? " is-selected" : ""}`}
          key={bpm}
          onClick={() => controller.setBpm(bpm)}
          title={`设为 ${bpm} BPM`}
          type="button"
        >
          {bpm}
        </button>
      ))}
    </div>
  );
}

function BeatSoundPattern({ controller }: { controller: MetronomeController }): JSX.Element {
  return (
    <div className="metronome-beat-pattern-wrap">
      <span className="metronome-beat-pattern-label">每拍木鱼声 · 点击圆点循环切换</span>
      <div aria-label="每拍音效模式" className="metronome-beat-pattern" role="group">
        {controller.preferences.beatSounds.map((sound, index) => {
          const isActive = controller.isPlaying && index === Math.max(0, controller.beatIndex - 1);
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              aria-label={`第 ${index + 1} 拍：${BEAT_SOUND_LABELS[sound]}，点击切换`}
              className={`metronome-beat-dot${isActive ? " is-active" : ""}`}
              data-sound={sound}
              key={index}
              onClick={() => controller.cycleBeatSound(index)}
              title={`第 ${index + 1} 拍：${BEAT_SOUND_LABELS[sound]}（点击切换）`}
              type="button"
            >
              {BEAT_SOUND_MARKS[sound]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MeterAndVolume({ controller }: { controller: MetronomeController }): JSX.Element {
  return (
    <div className="metronome-settings-row">
      <label className="metronome-meter-control">
        <span>拍号</span>
        <select
          aria-label="拍号"
          disabled={controller.isSyncLocked}
          onChange={(event) =>
            controller.setBeatsPerBar(Number(event.currentTarget.value) as 2 | 3 | 4 | 6)
          }
          value={controller.preferences.beatsPerBar}
        >
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
          <option value={6}>6/8</option>
        </select>
      </label>
      <label className="metronome-volume-control">
        <Volume2 aria-hidden="true" size={18} />
        <span className="visually-hidden">音量</span>
        <input
          aria-label="音量"
          max={1}
          min={0}
          onChange={(event) => controller.setVolume(Number(event.currentTarget.value))}
          step={0.01}
          style={getSliderStyle(Math.round(controller.preferences.volume * 210) + TEMPO_MIN)}
          type="range"
          value={controller.preferences.volume}
        />
      </label>
    </div>
  );
}

export function MetronomeCore({
  controller,
  onSynchronizedToggle,
  onStarted,
  onExpand,
  onMinimize,
  onClose,
  closeLabel = "关闭节拍器",
  onOpenMenu,
  mini = false,
  miniDockEdge = null,
  onRevealMini,
  onMiniPointerEnter,
  onMiniPointerLeave,
  menu,
  variant,
}: MetronomeCoreProps): JSX.Element {
  const [struckSide, setStruckSide] = useState<"left" | "right">("left");

  useEffect(() => {
    if (controller.beatSequence > 0) {
      setStruckSide((current) => (current === "left" ? "right" : "left"));
    }
  }, [controller.beatSequence]);

  const startOrStop = async (): Promise<void> => {
    if (controller.isSyncLocked) {
      const isResumingPractice = !controller.isPlaying;
      onSynchronizedToggle?.();
      if (isResumingPractice) onStarted?.();
      return;
    }
    if (controller.isPlaying) {
      controller.stop();
      return;
    }
    if (await controller.start()) onStarted?.();
  };

  const closeMetronome = (): void => {
    if (controller.isSyncLocked && controller.isPlaying) onSynchronizedToggle?.();
    controller.stop();
    onClose?.();
  };

  if (variant === "compact") {
    const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      controller.adjustBpm(event.deltaY < 0 ? 1 : -1);
    };
    return (
      <div
        className={[
          "metronome-compact-bar",
          `strike-${struckSide}`,
          mini ? "is-mini" : "",
          miniDockEdge ? `is-mini-docked-${miniDockEdge}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseLeave={mini ? undefined : onMiniPointerLeave}
        onWheel={mini ? undefined : onWheel}
      >
        <div className="metronome-menu-anchor">
          <button
            aria-label={mini ? "显示节拍器状态" : "打开节拍器设置"}
            className="metronome-compact-woodfish"
            onClick={mini ? onRevealMini : onExpand}
            onMouseEnter={mini ? onMiniPointerEnter : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenMenu?.();
            }}
            type="button"
          >
            <WoodfishIllustration />
          </button>
          {menu}
        </div>
        <div className="metronome-compact-tempo" title="滚动鼠标滚轮调节速度">
          <TempoValue className="metronome-compact-bpm" controller={controller} />
          <span>BPM</span>
        </div>
        <button
          aria-label={
            controller.isSyncLocked
              ? controller.isPlaying
                ? "暂停练习"
                : "继续练习"
              : controller.isPlaying
                ? "暂停节拍器"
                : "开始节拍器"
          }
          className="metronome-compact-action"
          disabled={controller.isLoading}
          onClick={() => void startOrStop()}
          title={
            controller.isSyncLocked
              ? controller.isPlaying
                ? "暂停练习"
                : "继续练习"
              : controller.isPlaying
                ? "暂停节拍器"
                : "开始节拍器"
          }
          type="button"
        >
          {controller.isPlaying ? (
            <Pause aria-hidden="true" size={17} />
          ) : (
            <Play aria-hidden="true" size={17} />
          )}
        </button>
        <button
          aria-label="展开节拍器"
          className="metronome-compact-expand"
          onClick={onExpand}
          type="button"
        >
          <Maximize2 aria-hidden="true" size={17} />
        </button>
        {onClose ? (
          <button
            aria-label={closeLabel}
            className="metronome-compact-close"
            onClick={closeMetronome}
            title={closeLabel}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  const isPage = variant === "page";
  return (
    <section className={`metronome-core metronome-core-${variant}`}>
      {isPage ? (
        <div className="metronome-page-heading">
          <span className="metronome-page-eyebrow">TEMPO PRACTICE</span>
          <h1>节拍器</h1>
          <p>调好速度，跟着木鱼的节拍练习。</p>
        </div>
      ) : (
        <header className="metronome-panel-heading">
          <span>木鱼节拍器</span>
          {onOpenMenu ? (
            <div className="metronome-menu-anchor">
              <button
                aria-label="节拍器显示选项"
                className="metronome-menu-toggle"
                onClick={onOpenMenu}
                type="button"
              >
                ⋯
              </button>
              {menu}
            </div>
          ) : null}
          {onMinimize ? (
            <button
              aria-label="最小化节拍器"
              className="metronome-minimize-button"
              onClick={onMinimize}
              title="最小化"
              type="button"
            >
              <Minimize2 aria-hidden="true" size={18} />
            </button>
          ) : null}
          {onClose ? (
            <button
              aria-label={closeLabel}
              onClick={closeMetronome}
              title={closeLabel}
              type="button"
            >
              ×
            </button>
          ) : null}
        </header>
      )}

      <div className={`metronome-stage${controller.isPlaying ? " is-playing" : ""}`}>
        <div className={`metronome-woodfish-stage strike-${struckSide}`}>
          <WoodfishIllustration />
        </div>

        <div className="metronome-tempo-control">
          <button
            aria-label="减慢 1 BPM"
            className="metronome-tempo-step"
            disabled={controller.preferences.bpm <= TEMPO_MIN}
            onClick={() => controller.adjustBpm(-1)}
            type="button"
          >
            <Minus aria-hidden="true" />
          </button>
          <div className="metronome-tempo-readout">
            <span>每分钟节拍</span>
            <div>
              <TempoValue className="metronome-page-bpm" controller={controller} />
              <span>BPM</span>
            </div>
          </div>
          <button
            aria-label="加快 1 BPM"
            className="metronome-tempo-step"
            disabled={controller.preferences.bpm >= TEMPO_MAX}
            onClick={() => controller.adjustBpm(1)}
            type="button"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        <TempoPresets controller={controller} />

        <BeatSoundPattern controller={controller} />

        <TempoSlider controller={controller} />

        <MeterAndVolume controller={controller} />

        <button
          aria-label={
            controller.isSyncLocked
              ? controller.isPlaying
                ? "暂停练习"
                : "继续练习"
              : controller.isPlaying
                ? "暂停节拍器"
                : "开始节拍器"
          }
          className="metronome-start-button"
          disabled={controller.isLoading}
          onClick={() => void startOrStop()}
          title={
            controller.isSyncLocked
              ? controller.isPlaying
                ? "暂停练习"
                : "继续练习"
              : controller.isPlaying
                ? "暂停节拍器"
                : "开始节拍器"
          }
          type="button"
        >
          {controller.isPlaying ? (
            <Pause aria-hidden="true" size={20} />
          ) : (
            <Play aria-hidden="true" size={20} />
          )}
          {controller.isLoading
            ? "正在加载音效"
            : controller.isSyncLocked
              ? controller.isPlaying
                ? "暂停练习"
                : "继续练习"
              : controller.isPlaying
                ? "暂停节拍"
                : "开始节拍"}
        </button>
        {controller.audioError ? (
          <p className="metronome-audio-error" role="alert">
            木鱼音效无法播放，请重试。
          </p>
        ) : null}
      </div>
    </section>
  );
}
