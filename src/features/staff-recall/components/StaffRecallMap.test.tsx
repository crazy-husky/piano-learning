import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NOTE_NAME_COLUMNS } from "../../../domain/staffRecall";
import { NOTE_NAMES } from "../../../domain/notes";
import type { NoteName } from "../../../domain/types";
import { StaffRecallMap, type StaffRecallColumnState } from "./StaffRecallMap";

it("reserves a separate top action area for the answer button above the notation surface", () => {
  const columnStates = NOTE_NAMES.reduce(
    (states, noteName) => {
      states[noteName] = { correctNoteIds: [] };
      return states;
    },
    {} as Record<NoteName, StaffRecallColumnState>
  );
  const comparisonMedianMsByNoteName = NOTE_NAMES.reduce(
    (medians, noteName) => {
      medians[noteName] = undefined;
      return medians;
    },
    {} as Record<NoteName, number | undefined>
  );
  const columns = NOTE_NAME_COLUMNS.map((column) => ({
    ...column,
    bassNotes: [],
    notes: [],
    trebleNotes: [],
  }));
  const markup = renderToStaticMarkup(
    <StaffRecallMap
      activeNoteName="C"
      columnStates={columnStates}
      columns={columns}
      comparisonMedianMsByNoteName={comparisonMedianMsByNoteName}
      inputNotes={[]}
      onColumnSelect={() => undefined}
      onPlacement={() => undefined}
      onRevealAnswer={() => undefined}
      runCompleted={false}
      staffNotationMode="grand"
    />
  );

  expect(markup).toContain("staff-recall-map--with-answer-action");
  expect(markup.indexOf("staff-recall-map-renderer")).toBeLessThan(
    markup.indexOf('aria-label="查看 C 列答案"')
  );
});
