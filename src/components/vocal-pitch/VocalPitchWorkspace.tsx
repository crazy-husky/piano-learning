import {
  Eraser,
  FolderUp,
  Mic,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
} from "lucide-react";
import type { ChangeEventHandler, DragEventHandler, RefObject } from "react";
import {
  formatDuration,
  type VocalAudioMaterial,
  type VocalPitchAnalysisConfig,
  type VocalPitchFrame,
} from "../../domain/vocalPitch";
import { PitchPreview } from "./PitchPreview";

interface VocalPitchWorkspaceProps {
  analysisProgress: number | null;
  backupPreflightPending: boolean;
  controlStatusMessage: string | null;
  currentFrame: VocalPitchFrame | null;
  currentPitch: { cents: number; frequencyHz: number; note: string } | null;
  dirty: boolean;
  displayedFrames: VocalPitchFrame[];
  effectiveTime: number;
  fileDragActive: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  followResetKey: number;
  material: VocalAudioMaterial | null;
  mutationBusy: boolean;
  onClearWorkspace: () => void;
  onDropFile: DragEventHandler<HTMLDivElement>;
  onEndFileDrag: DragEventHandler<HTMLDivElement>;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onOpenUploadPicker: () => void;
  onReanalyze: () => void;
  onSaveCurrentMaterial: () => void;
  onSeek: (timeSeconds: number) => void;
  onSetSidebarOpen: () => void;
  onStartRecording: () => void;
  onBeginFileDrag: DragEventHandler<HTMLDivElement>;
  onContinueFileDrag: DragEventHandler<HTMLDivElement>;
  onFinishRecording: () => void;
  onTogglePlayback: () => void;
  playbackIsPlaying: boolean;
  playbackIsPreparing: boolean;
  recordingActive: boolean;
  recordingBusy: boolean;
  recordingResultPending: boolean;
  recordingSeconds: number;
  recordingStopping: boolean;
  referencePitchHz: VocalPitchAnalysisConfig["referencePitchHz"];
  sidebarOpen: boolean;
  statusLabel: string;
}

export function VocalPitchWorkspace({
  analysisProgress,
  backupPreflightPending,
  controlStatusMessage,
  currentFrame,
  currentPitch,
  dirty,
  displayedFrames,
  effectiveTime,
  fileDragActive,
  fileInputRef,
  followResetKey,
  material,
  mutationBusy,
  onBeginFileDrag,
  onClearWorkspace,
  onContinueFileDrag,
  onDropFile,
  onEndFileDrag,
  onFileChange,
  onFinishRecording,
  onOpenUploadPicker,
  onReanalyze,
  onSaveCurrentMaterial,
  onSeek,
  onSetSidebarOpen,
  onStartRecording,
  onTogglePlayback,
  playbackIsPlaying,
  playbackIsPreparing,
  recordingActive,
  recordingBusy,
  recordingResultPending,
  recordingSeconds,
  recordingStopping,
  referencePitchHz,
  sidebarOpen,
  statusLabel,
}: VocalPitchWorkspaceProps): JSX.Element {
  return (
    <section className="vocal-preview-column">
      <header className="vocal-pitch-readout">
        <div className="vocal-current-pitch">
          <strong>{currentPitch?.note ?? "无音高"}</strong>
          <span>{currentPitch ? `${currentPitch.frequencyHz.toFixed(2)} Hz` : "— Hz"}</span>
          <span className={currentPitch && Math.abs(currentPitch.cents) <= 10 ? "in-tune" : undefined}>
            {currentPitch ? `${currentPitch.cents >= 0 ? "+" : ""}${currentPitch.cents.toFixed(1)} ¢` : "— ¢"}
          </span>
          <span>{currentFrame ? `${Math.round(currentFrame.confidence * 100)}%` : "—%"}</span>
        </div>
        <div className="vocal-readout-status">
          <span>{statusLabel}</span>
          <time>{formatDuration(effectiveTime)} / {formatDuration(recordingBusy ? recordingSeconds : material?.durationSeconds ?? 0)}</time>
        </div>
        {!sidebarOpen ? (
          <button className="vocal-sidebar-open icon-button" title="展开边栏" onClick={onSetSidebarOpen}>
            <PanelRightOpen size={19} />
          </button>
        ) : null}
      </header>

      <div
        className="vocal-preview-stage"
        onDragEnter={onBeginFileDrag}
        onDragLeave={onEndFileDrag}
        onDragOver={onContinueFileDrag}
        onDrop={onDropFile}
      >
        <PitchPreview
          currentPitchHz={currentFrame?.frequencyHz ?? null}
          currentTime={effectiveTime}
          duration={recordingBusy ? Math.max(0.01, recordingSeconds) : material?.durationSeconds ?? 10}
          followResetKey={followResetKey}
          frames={displayedFrames}
          followEnabled={recordingActive || playbackIsPlaying}
          isRecording={recordingActive}
          onSeek={onSeek}
          referencePitchHz={referencePitchHz}
          variant={recordingBusy || !material?.analysis ? "realtime" : "offline"}
        />
        {!material && !recordingBusy ? (
          <div className="vocal-empty-overlay">
            <div className="vocal-empty-actions">
              <button className="record-button" disabled={backupPreflightPending} onClick={onStartRecording}>
                <Mic size={18} /> 录一段清唱
              </button>
              <button disabled={backupPreflightPending} onClick={onOpenUploadPicker}>
                <FolderUp size={17} /> 上传音视频
              </button>
            </div>
            <span>支持最长 10 分钟的单声部人声</span>
          </div>
        ) : null}
        {fileDragActive ? (
          <div className="vocal-file-drop-overlay" role="status">
            <FolderUp size={28} />
            <strong>松开以上传音视频</strong>
          </div>
        ) : null}
      </div>

      <footer className="vocal-controls">
        <button
          className={recordingBusy ? "recording-stop" : "record-button"}
          disabled={backupPreflightPending || recordingStopping || recordingResultPending}
          onClick={() => {
            if (recordingActive) {
              onFinishRecording();
            } else onStartRecording();
          }}
        >
          {recordingBusy ? <Square size={17} /> : <Mic size={18} />}
          {recordingResultPending ? "正在完成" : recordingActive ? "停止" : "录制"}
          {recordingActive ? <kbd>Space</kbd> : null}
        </button>
        <button
          disabled={mutationBusy || playbackIsPreparing || !material}
          onClick={onTogglePlayback}
        >
          {playbackIsPlaying ? <Pause size={17} /> : <Play size={17} />}
          {playbackIsPlaying ? "暂停" : "播放"}
          {recordingActive ? null : <kbd>Space</kbd>}
        </button>
        <i className="vocal-control-divider" />
        <button disabled={mutationBusy || !material} onClick={onReanalyze}>
          <RotateCcw size={17} />
          {analysisProgress !== null ? "取消分析" : "重新分析"}
        </button>
        <button disabled={mutationBusy} onClick={onOpenUploadPicker}>
          <FolderUp size={17} /> 上传音视频
        </button>
        <button disabled={mutationBusy || analysisProgress !== null || !material || !dirty} onClick={onSaveCurrentMaterial}>
          <Save size={17} /> 保存
        </button>
        {controlStatusMessage || analysisProgress !== null ? (
          <span className="vocal-control-status" aria-live="polite" title={controlStatusMessage ?? undefined}>
            {controlStatusMessage}
            {analysisProgress !== null ? <progress max={1} value={analysisProgress} /> : null}
          </span>
        ) : null}
        <button disabled={mutationBusy || !material} onClick={onClearWorkspace}>
          <Eraser size={17} /> 清空
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          accept="audio/*,video/*"
          type="file"
          onChange={onFileChange}
        />
      </footer>
    </section>
  );
}
