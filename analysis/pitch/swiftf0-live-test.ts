import { createPitchFrameDetector } from "../../src/features/vocal-pitch/logic/pitchFrameDetector";
import { PRACTICE_NOTE_FREQUENCY_RANGE } from "../../src/features/vocal-pitch/logic/practiceNoteRecognizer";
import {
  SWIFTF0_CONFIDENCE_THRESHOLD,
  SWIFTF0_FRAME_INTERVAL_MS,
  SWIFTF0_INPUT_FRAME_SIZE,
} from "../../src/features/vocal-pitch/logic/swiftF0Config";
import "./swiftf0-live-test.css";

const NATURAL_AND_ACCIDENTAL_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const elements = {
  audioFile: document.querySelector<HTMLInputElement>("#audio-file")!,
  audioPlayer: document.querySelector<HTMLAudioElement>("#audio-player")!,
  clearHistory: document.querySelector<HTMLButtonElement>("#clear-history")!,
  history: document.querySelector<HTMLTableSectionElement>("#candidate-history")!,
  loadModel: document.querySelector<HTMLButtonElement>("#load-model")!,
  modelStatus: document.querySelector<HTMLElement>("#model-status")!,
  mpmDetail: document.querySelector<HTMLElement>("#mpm-detail")!,
  mpmNote: document.querySelector<HTMLElement>("#mpm-note")!,
  runtimeBackend: document.querySelector<HTMLElement>("#runtime-backend")!,
  runtimeInference: document.querySelector<HTMLElement>("#runtime-inference")!,
  runtimeInput: document.querySelector<HTMLElement>("#runtime-input")!,
  runtimeWindow: document.querySelector<HTMLElement>("#runtime-window")!,
  startMicrophone: document.querySelector<HTMLButtonElement>("#start-microphone")!,
  stopInput: document.querySelector<HTMLButtonElement>("#stop-input")!,
  swiftDetail: document.querySelector<HTMLElement>("#swift-detail")!,
  swiftNote: document.querySelector<HTMLElement>("#swift-note")!,
};

const worker = new Worker(new URL("./swiftf0-live-test.worker.ts", import.meta.url), { type: "module" });
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let inputSource: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
let monitorGain: GainNode | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let microphoneStream: MediaStream | null = null;
let animationFrame: number | null = null;
let lastFrameAt = 0;
let requestInFlight = false;
let requestId = 0;
let activeRequestId: number | null = null;
let inputGeneration = 0;
let currentInput = "none";
let inputStartedAt = 0;
let audioObjectUrl: string | null = null;
let modelReady = false;
let selectedBackend = "--";
let currentMpm: { frequencyHz: number; clarity: number; note: string | null } | null = null;
let pitchDetector = createPitchFrameDetector(SWIFTF0_INPUT_FRAME_SIZE);
const sampleBuffer = new Float32Array(SWIFTF0_INPUT_FRAME_SIZE);
const historyRows: HTMLTableRowElement[] = [];
const pendingRequests = new Map<number, {
  generation: number;
  inputTimeSeconds: number;
  mpm: { frequencyHz: number; clarity: number; note: string | null };
}>();

function setStatus(message: string, kind: "default" | "error" = "default"): void {
  elements.modelStatus.textContent = message;
  elements.modelStatus.dataset.kind = kind;
}

function frequencyToNote(frequencyHz: number): string | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const midi = 69 + 12 * Math.log2(frequencyHz / 440);
  const nearestMidi = Math.round(midi);
  if (Math.abs(midi - nearestMidi) > 0.45) return null;
  const noteName = NATURAL_AND_ACCIDENTAL_NOTES[(nearestMidi % 12 + 12) % 12];
  return `${noteName}${Math.floor(nearestMidi / 12) - 1}`;
}

function formatNote(note: string | null, frequencyHz: number): string {
  return note ? `${note} · ${frequencyHz.toFixed(1)} Hz` : "未识别";
}

function getInputTimeSeconds(): number {
  if (currentInput === "file") return elements.audioPlayer.currentTime;
  if (currentInput === "microphone") return (performance.now() - inputStartedAt) / 1000;
  return 0;
}

function appendHistoryRow(
  timeSeconds: number,
  mpm: { frequencyHz: number; clarity: number; note: string | null } | null,
  swift: { frequencyHz: number; confidence: number; inferenceMs: number; note: string | null },
): void {
  if (historyRows.length === 0) elements.history.replaceChildren();
  const row = document.createElement("tr");
  const values = [
    `${timeSeconds.toFixed(2)} s`,
    mpm?.note ? `${mpm.note} · ${mpm.clarity.toFixed(2)}` : "--",
    swift.note ?? "--",
    swift.confidence.toFixed(2),
    `${swift.inferenceMs.toFixed(1)} ms`,
  ];
  for (const [index, value] of values.entries()) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (index === 3 && swift.confidence < SWIFTF0_CONFIDENCE_THRESHOLD) cell.className = "low-confidence";
    row.append(cell);
  }
  elements.history.prepend(row);
  historyRows.unshift(row);
  while (historyRows.length > 100) historyRows.pop()?.remove();
}

function updateRuntime(sampleRate: number): void {
  elements.runtimeInput.textContent = `输入：${sampleRate.toLocaleString()} Hz`;
  elements.runtimeWindow.textContent = `窗口：${(SWIFTF0_INPUT_FRAME_SIZE / sampleRate * 1000).toFixed(1)} ms · ${SWIFTF0_FRAME_INTERVAL_MS} ms 更新`;
}

function runAnalysisLoop(): void {
  if (!analyser || currentInput === "none") return;
  const now = performance.now();
  if (now - lastFrameAt >= SWIFTF0_FRAME_INTERVAL_MS) {
    lastFrameAt = now;
    analyser.getFloatTimeDomainData(sampleBuffer);
    const sampleRate = analyser.context.sampleRate;
    const detection = pitchDetector.detect(sampleBuffer, sampleRate).fallback;
    const inPracticeRange = detection.frequencyHz >= PRACTICE_NOTE_FREQUENCY_RANGE.minFrequencyHz &&
      detection.frequencyHz <= PRACTICE_NOTE_FREQUENCY_RANGE.maxFrequencyHz;
    const mpm = {
      clarity: detection.clarity,
      frequencyHz: detection.frequencyHz,
      note: inPracticeRange ? frequencyToNote(detection.frequencyHz) : null,
    };
    currentMpm = mpm;
    elements.mpmNote.textContent = formatNote(mpm.note, mpm.frequencyHz);
    elements.mpmDetail.textContent = `清晰度 ${mpm.clarity.toFixed(3)}`;
    updateRuntime(sampleRate);

    if (!requestInFlight && modelReady) {
      requestInFlight = true;
      requestId += 1;
      activeRequestId = requestId;
      const samples = sampleBuffer.slice();
      const inputTimeSeconds = getInputTimeSeconds();
      pendingRequests.set(requestId, { generation: inputGeneration, inputTimeSeconds, mpm });
      worker.postMessage({
        type: "analyze",
        id: requestId,
        generation: inputGeneration,
        samples: samples.buffer,
        sampleRate,
      }, [samples.buffer]);
    }
  }
  animationFrame = requestAnimationFrame(runAnalysisLoop);
}

function stopAnalysis(): void {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  inputSource?.disconnect();
  inputSource = null;
  analyser?.disconnect();
  analyser = null;
  monitorGain?.disconnect();
  monitorGain = null;
  currentInput = "none";
  inputGeneration += 1;
  currentMpm = null;
  elements.stopInput.disabled = true;
  elements.startMicrophone.disabled = !modelReady;
  elements.modelStatus.textContent = modelReady ? "模型已就绪" : "模型尚未加载";
  elements.mpmNote.textContent = "--";
  elements.mpmDetail.textContent = "等待输入";
  elements.swiftNote.textContent = "--";
  elements.swiftDetail.textContent = "等待输入";
}

async function ensureAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  if (audioContext.state !== "running") await audioContext.resume();
  return audioContext;
}

async function connectInput(source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode, kind: "file" | "microphone"): Promise<void> {
  stopAnalysis();
  const context = await ensureAudioContext();
  const nextAnalyser = context.createAnalyser();
  nextAnalyser.fftSize = SWIFTF0_INPUT_FRAME_SIZE;
  nextAnalyser.smoothingTimeConstant = 0;
  const gain = context.createGain();
  gain.gain.value = kind === "file" ? 1 : 0;
  source.connect(nextAnalyser);
  nextAnalyser.connect(gain);
  gain.connect(context.destination);

  inputSource = source;
  analyser = nextAnalyser;
  monitorGain = gain;
  currentInput = kind;
  inputStartedAt = performance.now();
  lastFrameAt = 0;
  pitchDetector = createPitchFrameDetector(SWIFTF0_INPUT_FRAME_SIZE);
  elements.stopInput.disabled = false;
  elements.startMicrophone.disabled = true;
  setStatus(kind === "file" ? "正在分析录音" : "正在监听麦克风");
  updateRuntime(context.sampleRate);
  animationFrame = requestAnimationFrame(runAnalysisLoop);
}

elements.loadModel.addEventListener("click", () => {
  elements.loadModel.disabled = true;
  setStatus("正在加载 SwiftF0 模型…");
  worker.postMessage({ type: "initialize" });
});

elements.startMicrophone.addEventListener("click", async () => {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: false, channelCount: 1, echoCancellation: false, noiseSuppression: false },
    });
    const context = await ensureAudioContext();
    await connectInput(context.createMediaStreamSource(stream), "microphone");
    microphoneStream = stream;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

elements.audioFile.addEventListener("change", () => {
  const file = elements.audioFile.files?.[0];
  if (!file) return;
  stopAnalysis();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(file);
  elements.audioPlayer.src = audioObjectUrl;
  elements.audioPlayer.hidden = false;
  elements.audioPlayer.load();
  setStatus(`已载入 ${file.name}，播放以开始分析`);
});

elements.audioPlayer.addEventListener("play", async () => {
  try {
    const context = await ensureAudioContext();
    mediaSource ??= context.createMediaElementSource(elements.audioPlayer);
    await connectInput(mediaSource, "file");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

elements.audioPlayer.addEventListener("pause", () => {
  if (currentInput === "file") stopAnalysis();
});

elements.audioPlayer.addEventListener("ended", () => {
  if (currentInput === "file") {
    stopAnalysis();
    setStatus("录音回放结束");
  }
});

elements.stopInput.addEventListener("click", () => {
  if (currentInput === "file") elements.audioPlayer.pause();
  stopAnalysis();
});

elements.clearHistory.addEventListener("click", () => {
  historyRows.length = 0;
  elements.history.innerHTML = '<tr class="empty-row"><td colspan="5">尚无候选记录</td></tr>';
});

worker.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as {
    type: "ready" | "result" | "error";
    backend?: string;
    error?: string;
    confidence?: number;
    frequencyHz?: number;
    inferenceMs?: number;
    note?: string | null;
    id?: number;
    generation?: number;
  };
  if (message.type === "ready") {
    modelReady = true;
    selectedBackend = message.backend ?? "未知";
    elements.runtimeBackend.textContent = `后端：${selectedBackend}`;
    elements.startMicrophone.disabled = false;
    elements.loadModel.disabled = true;
    setStatus("SwiftF0 已就绪");
    return;
  }
  if (message.type === "error") {
    pendingRequests.delete(message.id ?? -1);
    if (message.id === activeRequestId) {
      requestInFlight = false;
      activeRequestId = null;
    }
    if (message.generation !== undefined && message.generation !== inputGeneration) return;
    elements.loadModel.disabled = modelReady;
    elements.modelStatus.textContent = message.error ?? "模型运行失败";
    elements.modelStatus.dataset.kind = "error";
    return;
  }
  const request = pendingRequests.get(message.id ?? -1);
  pendingRequests.delete(message.id ?? -1);
  if (message.id === activeRequestId) {
    requestInFlight = false;
    activeRequestId = null;
  }
  if (!request || request.generation !== inputGeneration) return;
  const frequencyHz = message.frequencyHz ?? 0;
  const confidence = message.confidence ?? 0;
  const note = message.note ?? null;
  const inferenceMs = message.inferenceMs ?? 0;
  elements.swiftNote.textContent = formatNote(note, frequencyHz);
  elements.swiftDetail.textContent = `置信度 ${confidence.toFixed(3)}${confidence < SWIFTF0_CONFIDENCE_THRESHOLD ? " · 低于 0.60" : ""}`;
  elements.swiftDetail.classList.toggle("low-confidence", confidence < SWIFTF0_CONFIDENCE_THRESHOLD);
  elements.runtimeInference.textContent = `推理：${inferenceMs.toFixed(1)} ms`;
  elements.runtimeBackend.textContent = `后端：${selectedBackend}`;
  appendHistoryRow(request.inputTimeSeconds, request.mpm, { confidence, frequencyHz, inferenceMs, note });
});

worker.addEventListener("error", (event) => {
  requestInFlight = false;
  elements.loadModel.disabled = false;
  setStatus(event.message || "SwiftF0 Worker 启动失败", "error");
});

window.addEventListener("beforeunload", () => {
  stopAnalysis();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  if (audioContext && audioContext.state !== "closed") void audioContext.close();
  worker.terminate();
});
