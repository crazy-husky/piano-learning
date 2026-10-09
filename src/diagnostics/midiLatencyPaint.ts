import { markMidiLatencyStage, type MidiLatencyStage } from "./midiLatencyDiagnostics";

export function markMidiLatencyAfterPaint(diagnosticSampleId: number, stage: MidiLatencyStage): () => void {
  let secondFrame: number | undefined;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => markMidiLatencyStage(diagnosticSampleId, stage));
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
  };
}
