import { ToggleSwitch } from "../../../shared/components/ui/ToggleSwitch";

export type StaffGameInputMode = "physical" | "virtual" | "midi";
export type GameDisplayMode = "note" | "solfege" | "number" | "none";

export interface StaffGameSettingsDraft {
  inputMode: StaffGameInputMode;
  displayMode: GameDisplayMode;
  gameEffectsEnabled: boolean;
}

export interface StaffGameAudioSettingsDraft {
  soundEffectsEnabled: boolean;
  backgroundMusicEnabled: boolean;
  pianoSoundEnabled: boolean;
}

interface StaffGameSettingsControlsProps {
  settingsDraft: StaffGameSettingsDraft;
  draftAudioSettings: StaffGameAudioSettingsDraft;
  onToggleSoundEffects: () => void;
  onToggleBackgroundMusic: () => void;
  onTogglePianoSound: () => void;
  onDisplayModeChange: (mode: GameDisplayMode) => void;
  onToggleGameEffects: () => void;
}

const DISPLAY_MODES: Array<{ id: GameDisplayMode; label: string }> = [
  { id: "note", label: "音名" },
  { id: "solfege", label: "唱名" },
  { id: "number", label: "简谱" },
  { id: "none", label: "无" },
];

interface ToggleSettingProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

function ToggleSetting({ title, description, enabled, onToggle }: ToggleSettingProps) {
  return (
    <section className="staff-game-settings-section staff-game-settings-row">
      <div><h3>{title}</h3><p>{description}</p></div>
      <ToggleSwitch
        aria-label={title}
      checked={enabled}
      className="staff-game-settings-toggle"
      onCheckedChange={() => onToggle()}
      />
    </section>
  );
}

function DisplaySetting({ value, onChange }: { value: GameDisplayMode; onChange: (mode: GameDisplayMode) => void }) {
  return (
    <section className="staff-game-settings-section staff-game-display-setting">
      <label htmlFor="staff-game-display-mode">虚拟钢琴显示</label>
      <select
        id="staff-game-display-mode"
        onChange={(event) => onChange(event.currentTarget.value as GameDisplayMode)}
        value={value}
      >
        {DISPLAY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
      </select>
    </section>
  );
}

export function StaffGameSettingsControls({
  settingsDraft,
  draftAudioSettings,
  onToggleSoundEffects,
  onToggleBackgroundMusic,
  onTogglePianoSound,
  onDisplayModeChange,
  onToggleGameEffects,
}: StaffGameSettingsControlsProps) {
  const soundEffects = (
    <ToggleSetting
      description="答对、连击和关卡反馈"
      enabled={draftAudioSettings.soundEffectsEnabled}
      onToggle={onToggleSoundEffects}
      title="音效"
    />
  );
  const backgroundMusic = (
    <ToggleSetting
      description="轻快旋律循环播放"
      enabled={draftAudioSettings.backgroundMusicEnabled}
      onToggle={onToggleBackgroundMusic}
      title="背景音乐"
    />
  );
  const pianoSound = (
    <ToggleSetting
      description="弹奏虚拟琴键时播放琴音"
      enabled={draftAudioSettings.pianoSoundEnabled}
      onToggle={onTogglePianoSound}
      title="钢琴声"
    />
  );
  const gameEffects = (
    <ToggleSetting
      description="萤火粒子、流星、泡泡星光与烟花"
      enabled={settingsDraft.gameEffectsEnabled}
      onToggle={onToggleGameEffects}
      title="游戏特效"
    />
  );

  if (settingsDraft.inputMode === "virtual") {
    return (
      <>
        <div className="staff-game-settings-pair-grid staff-game-virtual-audio-grid">
          {soundEffects}
          {backgroundMusic}
          {pianoSound}
        </div>
        <div className="staff-game-settings-pair-grid staff-game-virtual-display-effects-grid">
          <DisplaySetting onChange={onDisplayModeChange} value={settingsDraft.displayMode} />
          {gameEffects}
        </div>
      </>
    );
  }

  if (settingsDraft.inputMode === "physical") {
    return (
      <div className="staff-game-settings-pair-grid staff-game-physical-controls-grid">
        {soundEffects}
        {gameEffects}
      </div>
    );
  }

  return (
    <div className="staff-game-settings-pair-grid staff-game-midi-controls-grid">
      {soundEffects}
      {backgroundMusic}
      {gameEffects}
    </div>
  );
}
