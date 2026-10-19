import type { NoteName } from "../../domain/types";

/** 固定调唱名：C 始终对应 Do，与下方简谱数字保持一致。 */
export const FIXED_DO_SOLFEGE: Record<NoteName, string> = {
  A: "La",
  B: "Si",
  C: "Do",
  D: "Re",
  E: "Mi",
  F: "Fa",
  G: "Sol",
};
