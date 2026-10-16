import { describe, expect, it } from "vitest";
import { appRouteFromHash, appRouteQuery } from "./appRoutes";

describe("practice route tabs", () => {
  it("defaults to the free practice tab", () => {
    expect(appRouteFromHash("#/practice")).toMatchObject({
      page: "practice",
      path: "/practice",
      practiceTab: "free",
    });
  });

  it.each(["free", "distance", "songs"] as const)(
    "restores the %s tab from the route query",
    (tab) => {
      expect(appRouteFromHash(`#/practice?tab=${tab}`).practiceTab).toBe(tab);
      expect(appRouteQuery(appRouteFromHash(`#/practice?tab=${tab}`))).toEqual({ tab });
    }
  );

  it("falls back to free practice for unknown tab values", () => {
    expect(appRouteFromHash("#/practice?tab=unknown").practiceTab).toBe("free");
  });
});
