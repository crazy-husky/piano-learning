export type AppRoutePath =
  | "/"
  | "/level/1"
  | "/level/2"
  | "/level/3"
  | "/level/4"
  | "/level/5"
  | "/playground/challenge"
  | "/playground/songs"
  | "/playground/songs/play"
  | "/playground/stats"
  // Legacy paths remain recognized during the staged route migration.
  | "/study"
  | "/practice"
  | "/practice/game"
  | "/practice/game/songs"
  | "/practice/game/songs/play"
  | "/stats"
  | "/metronome"
  | "/vocal"
  | "/settings";
export type AppRoutePage =
  "home" | "study" | "practice" | "game" | "stats" | "metronome" | "settings" | "vocal";
export type PracticeRouteTab = "free" | "distance" | "name-key" | "songs";
export type PracticeDistanceMode = "look" | "play";
export type LearningLevelId = 1 | 2 | 3 | 4 | 5;
export type LearningModuleTab = "guide" | "practice" | "stats";
export type PlaygroundStatsTab = "challenge" | "songs";

export interface AppRoute {
  page: AppRoutePage;
  path: AppRoutePath;
  levelId?: LearningLevelId;
  moduleTab?: LearningModuleTab;
  playgroundStatsTab?: PlaygroundStatsTab;
  practiceTab?: PracticeRouteTab;
  practiceDistanceMode?: PracticeDistanceMode;
  songId?: string;
}

const ROUTE_PATHS = new Set<AppRoutePath>([
  "/",
  "/level/1",
  "/level/2",
  "/level/3",
  "/level/4",
  "/level/5",
  "/playground/challenge",
  "/playground/songs",
  "/playground/songs/play",
  "/playground/stats",
  "/study",
  "/practice",
  "/practice/game",
  "/practice/game/songs",
  "/practice/game/songs/play",
  "/stats",
  "/metronome",
  "/vocal",
  "/settings",
]);

export function appRouteFromHash(hash: string): AppRoute {
  const hashPath = hash.replace(/^#/, "");
  const queryStart = hashPath.indexOf("?");
  const rawPath = (queryStart < 0 ? hashPath : hashPath.slice(0, queryStart)) || "/";
  const rawQuery = queryStart < 0 ? "" : hashPath.slice(queryStart + 1);
  const normalizedPath = (rawPath.startsWith("/") ? rawPath : `/${rawPath}`) as AppRoutePath;
  const path = ROUTE_PATHS.has(normalizedPath) ? normalizedPath : "/";
  const query = new URLSearchParams(rawQuery);
  const levelMatch = /^\/level\/([1-5])$/.exec(path);
  const levelId = levelMatch ? (Number(levelMatch[1]) as LearningLevelId) : undefined;
  const moduleTab: LearningModuleTab | undefined = levelId
    ? query.get("tab") === "guide" || query.get("tab") === "stats"
      ? query.get("tab")
      : "practice"
    : undefined;
  const playgroundStatsTab: PlaygroundStatsTab | undefined =
    path === "/playground/stats"
      ? query.get("scope") === "songs"
        ? "songs"
        : "challenge"
      : undefined;
  const songId =
    path === "/practice/game/songs/play" || path === "/playground/songs/play"
      ? query.get("songId")?.slice(0, 80) || undefined
      : undefined;
  const requestedPracticeTab = query.get("tab");
  const requestedDistanceMode = query.get("distanceMode");
  const practiceTab: PracticeRouteTab | undefined =
    path === "/practice"
      ? requestedPracticeTab === "distance" ||
        requestedPracticeTab === "name-key" ||
        requestedPracticeTab === "songs"
        ? requestedPracticeTab
        : "free"
      : undefined;
  const practiceDistanceMode: PracticeDistanceMode | undefined =
    path === "/practice" && practiceTab === "distance"
      ? requestedDistanceMode === "play"
        ? "play"
        : requestedDistanceMode === "look"
          ? "look"
          : undefined
      : undefined;
  const page: AppRoutePage =
    path === "/"
      ? "home"
      : levelId === 1
        ? "study"
        : levelId !== undefined
          ? "practice"
          : path.startsWith("/practice/game") ||
              (path.startsWith("/playground/") && path !== "/playground/stats")
            ? "game"
            : path === "/playground/stats"
              ? "stats"
              : (path.slice(1) as Exclude<AppRoutePage, "home">);
  const levelPracticeTab: PracticeRouteTab | undefined =
    levelId === 2 || levelId === 5
      ? "free"
      : levelId === 3
        ? "name-key"
        : levelId === 4
          ? "distance"
          : undefined;
  return {
    page,
    path,
    ...(levelId ? { levelId, moduleTab, practiceTab: levelPracticeTab } : { practiceTab }),
    ...(levelId === 4 && requestedDistanceMode === "play"
      ? { practiceDistanceMode: "play" as const }
      : levelId === 4 && requestedDistanceMode === "look"
        ? { practiceDistanceMode: "look" as const }
        : { practiceDistanceMode }),
    ...(playgroundStatsTab ? { playgroundStatsTab } : {}),
    songId,
  };
}

export function appRouteQuery(route: AppRoute): Record<string, string> | undefined {
  if (route.levelId !== undefined) {
    return {
      tab: route.moduleTab ?? "practice",
      ...(route.levelId === 4 && route.practiceDistanceMode
        ? { distanceMode: route.practiceDistanceMode }
        : {}),
    };
  }
  if (route.path === "/playground/stats") {
    return { scope: route.playgroundStatsTab ?? "challenge" };
  }
  if (route.path === "/playground/songs/play" && route.songId) {
    return { songId: route.songId };
  }
  if (route.path === "/practice") {
    return {
      tab: route.practiceTab ?? "free",
      ...(route.practiceTab === "distance" && route.practiceDistanceMode
        ? { distanceMode: route.practiceDistanceMode }
        : {}),
    };
  }
  if (route.songId) return { songId: route.songId };
  return undefined;
}

export function isStaffGameRoutePath(path: AppRoutePath): boolean {
  return (
    path === "/playground/challenge" ||
    path === "/playground/songs" ||
    path === "/playground/songs/play" ||
    path === "/practice/game" ||
    path === "/practice/game/songs" ||
    path === "/practice/game/songs/play"
  );
}

export function isStaffGameSongRoutePath(path: AppRoutePath): boolean {
  return (
    path === "/playground/songs" ||
    path === "/playground/songs/play" ||
    path === "/practice/game/songs" ||
    path === "/practice/game/songs/play"
  );
}

export function appRoutePathForPage(page: AppRoutePage): AppRoutePath {
  if (page === "home") return "/";
  if (page === "game") return "/playground/challenge";
  return `/${page}` as AppRoutePath;
}

export function appRouteUrl(path: AppRoutePath, query?: Record<string, string>): string {
  const queryString = query ? new URLSearchParams(query).toString() : "";
  return `${window.location.pathname}${window.location.search}#${path}${queryString ? `?${queryString}` : ""}`;
}
