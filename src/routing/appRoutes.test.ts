import { describe, expect, it } from "vitest";
import { appRouteFromHash, appRouteQuery } from "./appRoutes";

describe("learning module routes", () => {
  it("defaults module routes to the practice tab", () => {
    expect(appRouteFromHash("#/level/2")).toMatchObject({
      page: "practice",
      path: "/level/2",
      levelId: 2,
      moduleTab: "practice",
      practiceTab: "free",
    });
  });

  it.each([
    [5, "/level/5"],
    [6, "/level/6"],
  ] as const)("routes Level %i to its free-practice module", (levelId, path) => {
    expect(appRouteFromHash(`#${path}`)).toMatchObject({
      page: "practice",
      path,
      levelId,
      moduleTab: "practice",
      practiceTab: "free",
    });
  });

  it.each(["guide", "practice", "stats"] as const)("restores the %s module tab", (tab) => {
    const route = appRouteFromHash(`#/level/4?tab=${tab}`);
    expect(route.moduleTab).toBe(tab);
    expect(appRouteQuery(route)).toEqual({ tab });
  });

  it("routes unknown legacy paths to the home page", () => {
    expect(appRouteFromHash("#/practice").path).toBe("/");
    expect(appRouteFromHash("#/stats").path).toBe("/");
  });
});
