#!/usr/bin/env python3
"""Convert Audiveris MusicXML pages into compact, single-note practice source data.

Each --page argument is PAGE:FIRST_MEASURE:FILE. The input file may be an
uncompressed MusicXML document or an Audiveris .mxl export. A grand-staff part
is reduced to its highest treble note and lowest bass note at each onset.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


NATURAL_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def read_musicxml(path: Path) -> ET.Element:
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.lower().endswith(".xml")]
            score_name = next(
                (name for name in names if "container.xml" not in name.lower()), None
            )
            if score_name is None:
                raise ValueError(f"No MusicXML score found in {path}")
            return ET.fromstring(archive.read(score_name))
    return ET.parse(path).getroot()


def element_text(element: ET.Element | None, path: str, default: str = "") -> str:
    if element is None:
        return default
    child = element.find(path)
    return child.text.strip() if child is not None and child.text else default


def source_page(value: str) -> tuple[int, int, Path]:
    try:
        page_text, measure_text, file_text = value.split(":", 2)
        page = int(page_text)
        first_measure = int(measure_text)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use PAGE:FIRST_MEASURE:FILE") from error
    if page < 1 or first_measure < 1:
        raise argparse.ArgumentTypeError("Page and measure numbers must be positive")
    return page, first_measure, Path(file_text)


def parse_page(
    page: int,
    first_measure: int,
    path: Path,
    staff_ids: dict[str, str],
    measure_quarter_beats: float | None,
) -> dict[str, list]:
    root = read_musicxml(path)
    part = root.find("./part")
    if part is None:
        raise ValueError(f"No MusicXML part found in {path}")

    divisions = 1
    selected: dict[str, dict[tuple[int, float], dict[str, Any]]] = {
        "treble": {},
        "bass": {},
    }

    for local_measure, measure in enumerate(part.findall("./measure"), start=1):
        attributes = measure.find("./attributes")
        if attributes is not None:
            parsed_divisions = element_text(attributes, "./divisions")
            if parsed_divisions:
                divisions = int(parsed_divisions)

        cursor = 0
        last_onset = 0
        candidates: dict[tuple[str, float], list[dict[str, Any]]] = defaultdict(list)

        for child in measure:
            if child.tag == "backup":
                cursor -= int(element_text(child, "./duration", "0"))
                continue
            if child.tag == "forward":
                cursor += int(element_text(child, "./duration", "0"))
                continue
            if child.tag != "note":
                continue

            duration_ticks = int(element_text(child, "./duration", "0"))
            is_chord_tone = child.find("./chord") is not None
            onset_ticks = last_onset if is_chord_tone else cursor
            if not is_chord_tone:
                last_onset = onset_ticks
                cursor += duration_ticks
            if child.find("./rest") is not None:
                continue

            staff_id = element_text(child, "./staff")
            staff_name = staff_ids.get(staff_id)
            pitch = child.find("./pitch")
            if staff_name is None or pitch is None:
                continue

            step = element_text(pitch, "./step")
            octave = int(element_text(pitch, "./octave", "4"))
            alter = float(element_text(pitch, "./alter", "0"))
            if step not in NATURAL_SEMITONES or not alter.is_integer():
                continue

            midi_pitch = NATURAL_SEMITONES[step] + int(alter) + 12 * (octave + 1)
            onset = round(onset_ticks / divisions, 6)
            duration = round(duration_ticks / divisions, 6)
            source_symbol = f"{step}{'♯' if alter == 1 else '♭' if alter == -1 else ''}{octave}"
            accidental = element_text(child, "./accidental")
            if accidental:
                source_symbol = f"{step}{accidental}{octave}"
            candidates[(staff_name, onset)].append(
                {
                    "duration": duration,
                    "midiPitch": midi_pitch,
                    "onset": onset,
                    "sourceSymbol": source_symbol,
                    "tieStart": any(
                        tie.get("type") == "start" for tie in child.findall("./tie")
                    ),
                    "tieStop": any(tie.get("type") == "stop" for tie in child.findall("./tie")),
                }
            )

        absolute_measure = first_measure + local_measure - 1
        measure_events: dict[str, list[dict[str, Any]]] = {"treble": [], "bass": []}
        for (staff_name, _), notes in candidates.items():
            selected_note = (
                max(notes, key=lambda note: note["midiPitch"])
                if staff_name == "treble"
                else min(notes, key=lambda note: note["midiPitch"])
            )
            measure_events[staff_name].append(selected_note.copy())

        if measure_quarter_beats is not None:
            for events in measure_events.values():
                overflow = max(
                    (event["onset"] + event["duration"] - measure_quarter_beats for event in events),
                    default=0,
                )
                if overflow > 0.00001:
                    # Later score pages may omit the time signature. Audiveris can then place
                    # trailing events beyond the known bar length. Move only those late starts
                    # back by the overrun, preserving in-bar positions and exact note lengths.
                    for event in events:
                        if event["onset"] >= measure_quarter_beats:
                            event["onset"] = round(max(0, event["onset"] - overflow), 6)

        for staff_name, events in measure_events.items():
            events_by_onset: dict[float, list[dict[str, Any]]] = defaultdict(list)
            for event in events:
                events_by_onset[event["onset"]].append(event)
            for onset, notes in events_by_onset.items():
                selected_note = (
                    max(notes, key=lambda note: note["midiPitch"])
                    if staff_name == "treble"
                    else min(notes, key=lambda note: note["midiPitch"])
                )
                selected[staff_name][(absolute_measure, onset)] = {
                    **selected_note,
                    "measure": absolute_measure,
                    "page": page,
                }

    output: dict[str, list] = {"treble": [], "bass": []}
    for staff_name, events in selected.items():
        ordered = sorted(events.values(), key=lambda event: (event["measure"], event["onset"]))
        merged: list[dict[str, Any]] = []
        for event in ordered:
            previous = merged[-1] if merged else None
            if (
                previous is not None
                and previous["tieStart"]
                and event["tieStop"]
                and previous["midiPitch"] == event["midiPitch"]
            ):
                previous["duration"] = round(previous["duration"] + event["duration"], 6)
                previous["tieStart"] = event["tieStart"]
                continue
            merged.append(event.copy())

        event_index_by_measure: dict[int, int] = defaultdict(int)
        for event in merged:
            measure_number = event["measure"]
            event_index = event_index_by_measure[measure_number]
            event_index_by_measure[measure_number] += 1
            output[staff_name].append(
                [
                    event["page"],
                    measure_number,
                    event["onset"],
                    event["duration"],
                    event["midiPitch"],
                    event["sourceSymbol"],
                    event_index,
                ]
            )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--page",
        action="append",
        type=source_page,
        required=True,
        help="PAGE:FIRST_MEASURE:FILE, repeat once per page in score order",
    )
    parser.add_argument("--treble-staff", default="1")
    parser.add_argument("--bass-staff", default="2")
    parser.add_argument(
        "--measure-quarter-beats",
        type=float,
        help="Known measure length; correct late OMR onsets that overrun the bar by shifting them back",
    )
    parser.add_argument("--transpose-semitones", type=int, default=0)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--symbol", default="STAFF_NOTATION_SOURCE")
    args = parser.parse_args()

    if len({page for page, _, _ in args.page}) != len(args.page):
        parser.error("Each source page number must be unique")
    if args.measure_quarter_beats is not None and args.measure_quarter_beats <= 0:
        parser.error("--measure-quarter-beats must be positive")

    combined: dict[str, list] = {"treble": [], "bass": []}
    staff_ids = {args.treble_staff: "treble", args.bass_staff: "bass"}
    for page, first_measure, path in sorted(args.page):
        page_events = parse_page(
            page, first_measure, path, staff_ids, args.measure_quarter_beats
        )
        for staff_name in combined:
            combined[staff_name].extend(page_events[staff_name])

    source_parts = [
        ("treble", "高音旋律（和弦保留最高音）"),
        ("bass", "低音旋律（和弦保留最低音）"),
    ]
    source_lines = [
        "import type { StaffNotationSource } from \"./staffNotationAdapter\";",
        "",
        f"export const {args.symbol}: StaffNotationSource = {{",
        f"  transposeSemitones: {args.transpose_semitones},",
        "  parts: [",
    ]
    for staff_name, display_name in source_parts:
        source_lines.extend(
            [
                "    {",
                f"      id: {json.dumps(staff_name, ensure_ascii=False)},",
                f"      name: {json.dumps(display_name, ensure_ascii=False)},",
                "      events: [",
            ]
        )
        source_lines.extend(
            f"        {json.dumps(event, ensure_ascii=False, separators=(',', ':'))},"
            for event in combined[staff_name]
        )
        source_lines.extend(["      ],", "    },"])
    source_lines.extend(["  ],", "};", ""])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "\n".join(source_lines),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "trebleEvents": len(combined["treble"]),
                "bassEvents": len(combined["bass"]),
                "pages": len(args.page),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
