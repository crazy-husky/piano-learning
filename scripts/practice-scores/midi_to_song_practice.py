#!/usr/bin/env python3
"""Convert a standard MIDI file into traceable, compact song-practice source data.

The converter intentionally preserves absolute MIDI pitches and event ticks. It
does not infer musical spelling, simplify chords, or quantize timing; those are
arrangement/display decisions made by the app.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from collections import defaultdict, deque
from pathlib import Path
from typing import Any


def read_vlq(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    while True:
        if offset >= len(data):
            raise ValueError("Unexpected end of file while reading variable-length quantity")
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if byte < 0x80:
            return value, offset


def parse_track(
    data: bytes, track_index: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, int]], int]:
    offset = 0
    tick = 0
    running_status: int | None = None
    active: dict[tuple[int, int], deque[tuple[int, int]]] = defaultdict(deque)
    events: list[dict[str, Any]] = []
    metadata: list[dict[str, Any]] = []
    unmatched_note_offs: list[dict[str, int]] = []
    event_index = 0
    note_on_count = 0

    while offset < len(data):
        delta, offset = read_vlq(data, offset)
        tick += delta
        status = data[offset]
        if status < 0x80:
            if running_status is None:
                raise ValueError(f"Track {track_index}: running status missing at tick {tick}")
            status = running_status
        else:
            offset += 1
            if status < 0xF0:
                running_status = status

        if status == 0xFF:
            if offset >= len(data):
                raise ValueError(f"Track {track_index}: truncated meta event")
            meta_type = data[offset]
            offset += 1
            length, offset = read_vlq(data, offset)
            payload = data[offset : offset + length]
            offset += length
            if len(payload) != length:
                raise ValueError(f"Track {track_index}: truncated meta payload")
            if meta_type in (0x03, 0x51, 0x58, 0x59):
                metadata.append(
                    {"tick": tick, "type": meta_type, "data": payload.hex(), "eventOrder": len(metadata)}
                )
            if meta_type == 0x2F:
                break
            continue

        if status in (0xF0, 0xF7):
            length, offset = read_vlq(data, offset)
            offset += length
            continue

        kind = status & 0xF0
        channel = status & 0x0F
        if offset >= len(data):
            raise ValueError(f"Track {track_index}: truncated channel event")
        first = data[offset]
        offset += 1
        if kind in (0xC0, 0xD0):
            continue
        if offset >= len(data):
            raise ValueError(f"Track {track_index}: truncated channel event data")
        second = data[offset]
        offset += 1

        pitch = first
        velocity = second
        is_note_on = kind == 0x90 and velocity > 0
        is_note_off = kind == 0x80 or (kind == 0x90 and velocity == 0)
        if is_note_on:
            active[(channel, pitch)].append((tick, event_index))
            event_index += 1
            note_on_count += 1
        elif is_note_off:
            key = (channel, pitch)
            if not active[key]:
                unmatched_note_offs.append(
                    {"tick": tick, "channel": channel, "midiPitch": pitch, "velocity": velocity}
                )
                continue
            onset, onset_index = active[key].popleft()
            events.append(
                {
                    "onsetTick": onset,
                    "durationTicks": tick - onset,
                    "midiPitch": pitch,
                    "eventIndex": onset_index,
                    "channel": channel,
                }
            )

    dangling = [(key, len(queue)) for key, queue in active.items() if queue]
    if dangling:
        raise ValueError(f"Track {track_index}: notes without note-off: {dangling[:8]}")
    events.sort(key=lambda item: (item["onsetTick"], item["midiPitch"], item["eventIndex"]))
    return events, metadata, unmatched_note_offs, note_on_count


def parse_midi(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if data[:4] != b"MThd" or len(data) < 14:
        raise ValueError("Not a valid Standard MIDI File")
    header_length = struct.unpack_from(">I", data, 4)[0]
    if header_length < 6:
        raise ValueError("Invalid MIDI header length")
    file_format, track_count, division = struct.unpack_from(">HHH", data, 8)
    if division & 0x8000:
        raise ValueError("SMPTE time division is not supported")
    offset = 8 + header_length
    tracks = []
    all_metadata = []
    for track_index in range(track_count):
        if data[offset : offset + 4] != b"MTrk":
            raise ValueError(f"Track {track_index}: missing MTrk header")
        length = struct.unpack_from(">I", data, offset + 4)[0]
        start = offset + 8
        end = start + length
        if end > len(data):
            raise ValueError(f"Track {track_index}: track extends beyond the file")
        events, metadata, unmatched_note_offs, note_on_count = parse_track(data[start:end], track_index)
        tracks.append(
            {
                "trackIndex": track_index,
                "events": events,
                "noteOnCount": note_on_count,
                "unmatchedNoteOffs": unmatched_note_offs,
            }
        )
        all_metadata.extend({**item, "trackIndex": track_index} for item in metadata)
        offset = end
    return {
        "fileFormat": file_format,
        "ticksPerQuarter": division,
        "trackCount": track_count,
        "tracks": tracks,
        "metadata": all_metadata,
        "sha256": hashlib.sha256(data).hexdigest(),
        "fileBytes": len(data),
    }


def metadata_value(midi: dict[str, Any], meta_type: int) -> dict[str, Any] | None:
    matches = [
        item
        for item in midi["metadata"]
        if item["type"] == meta_type and item["tick"] == 0
    ]
    # Multiple tempo events can share tick zero; the last one is effective.
    return matches[-1] if matches else None


def build_source(
    midi: dict[str, Any],
    *,
    source_file: str,
    treble_track_index: int,
    bass_track_index: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    tempo_event = metadata_value(midi, 0x51)
    meter_event = metadata_value(midi, 0x58)
    key_event = metadata_value(midi, 0x59)
    if not tempo_event or not meter_event or not key_event:
        raise ValueError("MIDI is missing tempo, time signature, or key signature metadata")
    micros_per_quarter = int(tempo_event["data"], 16)
    meter = bytes.fromhex(meter_event["data"])
    key_data = bytes.fromhex(key_event["data"])
    beats_per_measure = meter[0] * 4 / (2**meter[1])
    tracks_by_index = {track["trackIndex"]: track for track in midi["tracks"]}
    if treble_track_index == bass_track_index:
        raise ValueError("Treble and bass must use different MIDI tracks")
    note_tracks = [
        ("treble", "右手声部", treble_track_index),
        ("bass", "左手声部", bass_track_index),
    ]
    parts = []
    for part_id, part_name, track_index in note_tracks:
        track = tracks_by_index.get(track_index)
        if track is None or not track["events"]:
            raise ValueError(f"MIDI track {track_index} is missing or has no notes")
        events = track["events"]
        parts.append(
            {
                "id": part_id,
                "name": part_name,
                "midiTrackIndex": track_index,
                "events": [
                    [
                        event["onsetTick"],
                        event["durationTicks"],
                        event["midiPitch"],
                        event["eventIndex"],
                        event["channel"],
                    ]
                    for event in events
                ],
            }
        )
    max_tick = max(
        event[0] + event[1]
        for part in parts
        for event in part["events"]
    )
    source = {
        "fileFormat": midi["fileFormat"],
        "sourceFileSha256": midi["sha256"],
        "ticksPerQuarter": midi["ticksPerQuarter"],
        "tempoMicrosPerQuarter": micros_per_quarter,
        "timeSignature": [meter[0], 2**meter[1]],
        "keySignatureFifths": key_data[0] - 256 if key_data[0] > 127 else key_data[0],
        "keySignatureIsMinor": bool(key_data[1]),
        "lastNoteOffTick": max_tick,
        "tempoEvents": [
            [item["tick"], int(item["data"], 16), item["trackIndex"]]
            for item in midi["metadata"]
            if item["type"] == 0x51
        ],
        "parts": parts,
    }
    report = {
        "sourceFile": source_file,
        "sha256": midi["sha256"],
        "fileBytes": midi["fileBytes"],
        "fileFormat": midi["fileFormat"],
        "trackCount": midi["trackCount"],
        "ticksPerQuarter": midi["ticksPerQuarter"],
        "tempoBpm": round(60_000_000 / micros_per_quarter, 4),
        "timeSignature": source["timeSignature"],
        "keySignatureFifths": source["keySignatureFifths"],
        "keySignatureIsMinor": source["keySignatureIsMinor"],
        "measureCountByLastNoteOff": round(max_tick / midi["ticksPerQuarter"] / beats_per_measure, 4),
        "tempoEvents": [
            {
                "tick": item["tick"],
                "microsecondsPerQuarter": int(item["data"], 16),
                "trackIndex": item["trackIndex"],
            }
            for item in midi["metadata"]
            if item["type"] == 0x51
        ],
        "parts": [
            {
                "id": part["id"],
                "midiTrackIndex": part["midiTrackIndex"],
                "eventCount": len(part["events"]),
                "pitchRange": [
                    min(event[2] for event in part["events"]),
                    max(event[2] for event in part["events"]),
                ],
                "channels": sorted({event[4] for event in part["events"]}),
                "firstOnsetTick": min(event[0] for event in part["events"]),
                "lastNoteOffTick": max(event[0] + event[1] for event in part["events"]),
            }
            for part in parts
        ],
        "trackDiagnostics": [
            {
                "trackIndex": track["trackIndex"],
                "noteOnCount": track["noteOnCount"],
                "pairedNoteCount": len(track["events"]),
                "unmatchedNoteOffCount": len(track["unmatchedNoteOffs"]),
                "unmatchedNoteOffSamples": track["unmatchedNoteOffs"][:5],
            }
            for track in midi["tracks"]
        ],
        "noteOnOffPairing": "all note-ons paired; unmatched note-offs are reported separately and excluded from score notes",
        "limitations": [
            "This report validates MIDI structure and event preservation, not musical correctness against the score images.",
            "Repeated sections remain in the MIDI's performed order; the printed score pages are retained as provenance, not used to reorder events.",
        ],
    }
    return source, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--source-file", required=True)
    parser.add_argument("--output-symbol", required=True)
    parser.add_argument("--treble-track", type=int, required=True)
    parser.add_argument("--bass-track", type=int, required=True)
    args = parser.parse_args()
    midi = parse_midi(args.input)
    source, report = build_source(
        midi,
        source_file=args.source_file,
        treble_track_index=args.treble_track,
        bass_track_index=args.bass_track,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "/* Generated by scripts/practice-scores/midi_to_song_practice.py. Do not edit by hand. */\n"
        f"export const {args.output_symbol} = "
        + json.dumps(source, ensure_ascii=False, separators=(",", ":"))
        + " as const;\n",
        encoding="utf-8",
    )
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
