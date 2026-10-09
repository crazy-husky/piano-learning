import { useCallback, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { digestBlob } from "../../data/blobDigest";
import { createUuid } from "../../domain/id";
import type { VocalAudioMaterial, VocalPitchAnalysisConfig, VocalPitchFrame } from "../../domain/vocalPitch";
import { decodeAudioBlob, type DecodedAudio, type PitchAnalysisMode } from "../../vocal-pitch/pitchAnalysis";
import { encodeMonoWavPcm16 } from "../../vocal-pitch/wavEncode";

const MAX_AUDIO_SECONDS = 10 * 60;

interface DroppedFileImportActions {
  importFile: (file: File) => Promise<void>;
  runLibraryMutationPreflight: () => Promise<boolean>;
  runWithReplacementGuard: (after: () => void | Promise<void>) => void;
}

interface UseVocalFileImportOptions {
  analysisRequestGenerationRef: { current: number };
  analyzeDecoded: (target: VocalAudioMaterial, decoded: DecodedAudio, mode: PitchAnalysisMode) => Promise<void>;
  cancelAnalysis: () => void;
  config: VocalPitchAnalysisConfig;
  materialBaseUpdatedAtRef: { current: string | null };
  mutationBusy: boolean;
  runLibraryMutationPreflight: () => Promise<boolean>;
  runWithReplacementGuard: (after: () => void | Promise<void>) => void;
  selectAnalysisMode: (target: VocalAudioMaterial) => Promise<PitchAnalysisMode>;
  setAnalysisStale: Dispatch<SetStateAction<boolean>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setDisplayedFrames: Dispatch<SetStateAction<VocalPitchFrame[]>>;
  setInlineMessage: Dispatch<SetStateAction<string | null>>;
  setMaterial: Dispatch<SetStateAction<VocalAudioMaterial | null>>;
  setMaterialLibraryOutdated: Dispatch<SetStateAction<boolean>>;
}

export function hasDraggedFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

export function requestDroppedFileImport(
  file: File | null,
  mutationBusy: boolean,
  actions: DroppedFileImportActions,
): void {
  if (!file || mutationBusy) return;
  actions.runWithReplacementGuard(async () => {
    if (!(await actions.runLibraryMutationPreflight())) return;
    await actions.importFile(file);
  });
}

export function useVocalFileImport({
  analysisRequestGenerationRef,
  analyzeDecoded,
  cancelAnalysis,
  config,
  materialBaseUpdatedAtRef,
  mutationBusy,
  runLibraryMutationPreflight,
  runWithReplacementGuard,
  selectAnalysisMode,
  setAnalysisStale,
  setDirty,
  setDisplayedFrames,
  setInlineMessage,
  setMaterial,
  setMaterialLibraryOutdated,
}: UseVocalFileImportOptions) {
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);

  const importFile = useCallback(async (file: File) => {
    cancelAnalysis();
    const generation = analysisRequestGenerationRef.current;
    try {
      setInlineMessage("正在读取音频…");
      const decoded = await decodeAudioBlob(file);
      if (analysisRequestGenerationRef.current !== generation) return;
      if (decoded.durationSeconds > MAX_AUDIO_SECONDS + 0.1) {
        throw new Error("文件超过 10 分钟，未导入");
      }
      const audioBlob = file.type.startsWith("video/")
        ? encodeMonoWavPcm16(decoded.samples, decoded.sampleRate)
        : file;
      const contentDigest = await digestBlob(audioBlob);
      if (analysisRequestGenerationRef.current !== generation) return;
      const now = new Date().toISOString();
      const next: VocalAudioMaterial = {
        schemaVersion: 1,
        id: createUuid(),
        name: file.name,
        originalFileName: file.name,
        source: "upload",
        mimeType: audioBlob.type || "application/octet-stream",
        size: audioBlob.size,
        durationSeconds: decoded.durationSeconds,
        createdAt: now,
        updatedAt: now,
        contentDigest,
        audioBlob,
        config,
      };
      materialBaseUpdatedAtRef.current = null;
      setMaterialLibraryOutdated(false);
      setMaterial(next);
      setDisplayedFrames([]);
      setDirty(true);
      setAnalysisStale(false);
      setInlineMessage(null);
      const mode = await selectAnalysisMode(next);
      await analyzeDecoded(next, decoded, mode);
    } catch (error) {
      if (analysisRequestGenerationRef.current === generation) {
        setInlineMessage(error instanceof Error ? error.message : "无法导入音频文件");
      }
    }
  }, [analysisRequestGenerationRef, analyzeDecoded, cancelAnalysis, config, materialBaseUpdatedAtRef, selectAnalysisMode, setAnalysisStale, setDirty, setDisplayedFrames, setInlineMessage, setMaterial, setMaterialLibraryOutdated]);

  const openUploadPicker = useCallback(() => {
    runWithReplacementGuard(async () => {
      if (await runLibraryMutationPreflight()) fileInputRef.current?.click();
    });
  }, [runLibraryMutationPreflight, runWithReplacementGuard]);

  const beginFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    if (mutationBusy) return;
    event.dataTransfer.dropEffect = "copy";
    setFileDragActive(true);
  }, [mutationBusy]);

  const continueFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = mutationBusy ? "none" : "copy";
  }, [mutationBusy]);

  const endFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  }, []);

  const dropFile = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const file = event.dataTransfer.files.item(0);
    requestDroppedFileImport(file, mutationBusy, {
      importFile,
      runLibraryMutationPreflight,
      runWithReplacementGuard,
    });
  }, [importFile, mutationBusy, runLibraryMutationPreflight, runWithReplacementGuard]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  }, [importFile]);

  return {
    beginFileDrag,
    continueFileDrag,
    dropFile,
    endFileDrag,
    fileDragActive,
    fileInputRef,
    handleFileChange,
    importFile,
    openUploadPicker,
  };
}
