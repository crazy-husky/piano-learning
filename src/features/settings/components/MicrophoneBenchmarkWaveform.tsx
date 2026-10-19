import { useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createMicrophoneBenchmarkWaveform } from "../../vocal-pitch/logic/microphoneParameterBenchmark";

interface MicrophoneBenchmarkWaveformProps {
  disabled?: boolean;
  durationMs: number;
  onAddMarker: (timeMs: number) => void;
  onMarkerChange: (index: number, timeMs: number) => void;
  onSelectMarker: (index: number) => void;
  samples: Float32Array;
  selectedMarkerIndex: number;
  markerTimesMs: number[];
  addMarkerMode: boolean;
}

export function MicrophoneBenchmarkWaveform({
  addMarkerMode,
  disabled = false,
  durationMs,
  markerTimesMs,
  onAddMarker,
  onMarkerChange,
  onSelectMarker,
  samples,
  selectedMarkerIndex,
}: MicrophoneBenchmarkWaveformProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggedMarkerRef = useRef<number | null>(null);
  const peaks = useMemo(() => createMicrophoneBenchmarkWaveform(samples, 720), [samples]);
  const maximumPeak = Math.max(0.000001, ...peaks);

  const timeAtPointer = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg || durationMs <= 0) return 0;
    const bounds = svg.getBoundingClientRect();
    return Math.max(0, Math.min(durationMs, ((clientX - bounds.left) / bounds.width) * durationMs));
  };

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (disabled) return;
    const markerIndex = Number((event.target as SVGElement).dataset.markerIndex);
    if (Number.isInteger(markerIndex) && markerIndex >= 0) {
      draggedMarkerRef.current = markerIndex;
      onSelectMarker(markerIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (addMarkerMode) onAddMarker(timeAtPointer(event.clientX));
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!disabled && draggedMarkerRef.current !== null) {
      onMarkerChange(draggedMarkerRef.current, timeAtPointer(event.clientX));
    }
  }

  function releasePointer(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggedMarkerRef.current = null;
  }

  function moveSelectedMarker(index: number, deltaMs: number): void {
    const time = markerTimesMs[index];
    if (time !== undefined) onMarkerChange(index, time + deltaMs);
  }

  return (
    <div className={`microphone-benchmark-waveform${addMarkerMode ? " is-adding-marker" : ""}`}>
      <svg
        aria-label="录音波形和自动起音点，可拖动起音点修正时间"
        aria-disabled={disabled}
        className="microphone-benchmark-waveform-chart"
        onPointerCancel={releasePointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        ref={svgRef}
        role="group"
        viewBox="0 0 1000 120"
      >
        <line className="microphone-benchmark-waveform-midline" x1="0" x2="1000" y1="60" y2="60" />
        {peaks.map((peak, index) => {
          const x = (index / Math.max(1, peaks.length - 1)) * 1000;
          const height = Math.max(1, (peak / maximumPeak) * 106);
          return (
            <line
              className="microphone-benchmark-waveform-sample"
              key={index}
              x1={x}
              x2={x}
              y1={60 - height / 2}
              y2={60 + height / 2}
            />
          );
        })}
        {markerTimesMs.map((timeMs, index) => {
          const x = durationMs > 0 ? (timeMs / durationMs) * 1000 : 0;
          return (
            <line
              aria-label={`起音点 ${index + 1}，${Math.round(timeMs)} 毫秒。方向键可微调。`}
              aria-valuemax={durationMs}
              aria-valuemin={0}
              aria-valuenow={Math.round(timeMs)}
              className={`microphone-benchmark-waveform-onset${
                index === selectedMarkerIndex ? " is-selected" : ""
              }`}
              data-marker-index={index}
              key={`onset-${index}`}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelectedMarker(index, -5);
                } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelectedMarker(index, 5);
                }
              }}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              x1={x}
              x2={x}
              y1="8"
              y2="112"
            />
          );
        })}
      </svg>
    </div>
  );
}
