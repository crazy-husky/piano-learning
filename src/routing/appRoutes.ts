export type AppRoutePath =
  | "/"
  | "/level/1"
  | "/level/2"
  | "/level/3"
  | "/level/4"
  | "/level/5"
  | "/level/6"
  | "/playground/challenge"
  | "/playground/songs"
  | "/playground/songs/play"
  | "/playground/songs/score"
  | "/playground/stats"
  | "/metronome"
  | "/vocal"
  | "/settings";

export type AppRoutePage =
  "home" | "study" | "practice" | "game" | "stats" | "metronome" | "settings" | "vocal";
export type PracticeRouteTab = "free" | "distance" | "name-key" | "songs";
export type PracticeDistanceMode = "look" | "play";
export type LearningLevelId = 1 | 2 | 3 | 4 | 5 | 6;
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
  "/level/6",
  "/playground/challenge",
  "/playground/songs",
  "/playground/songs/play",
  "/playground/songs/score",
  "/playground/stats",
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
  const levelMatch = /^\/level\/([1-6])$/.exec(path);
  const levelId = levelMatch ? (Number(levelMatch[1]) as LearningLevelId) : undefined;
  const requestedModuleTab = query.get("tab");
  const moduleTab: LearningModuleTab | undefined = levelId
    ? requestedModuleTab === "guide"
      ? "guide"
      : requestedModuleTab === "stats"
        ? "stats"
        : "practice"
    : undefined;
  const playgroundStatsTab: PlaygroundStatsTab | undefined =
    path === "/playground/stats"
      ? query.get("scope") === "songs"
        ? "songs"
        : "challenge"
      : undefined;
  const songId =
    path === "/playground/songs/play" ? query.get("songId")?.slice(0, 80) || undefined : undefined;
  const requestedDistanceMode = query.get("distanceMode");
  const practiceDistanceMode: PracticeDistanceMode | undefined =
    levelId === 4 && (requestedDistanceMode === "play" || requestedDistanceMode === "look")
      ? requestedDistanceMode
      : undefined;
  const page: AppRoutePage =
    path === "/"
      ? "home"
      : levelId === 1
        ? "study"
        : levelId !== undefined
          ? "practice"
          : path === "/playground/songs/score"
            ? "practice"
            : path.startsWith("/playground/") && path !== "/playground/stats"
              ? "game"
              : path === "/playground/stats"
                ? "stats"
                : (path.slice(1) as Exclude<AppRoutePage, "home">);
  const practiceTab: PracticeRouteTab | undefined =
    path === "/playground/songs/score"
      ? "songs"
      : levelId === 2 || levelId === 5 || levelId === 6
        ? "free"
        : levelId === 3
          ? "name-key"
          : levelId === 4
            ? "distance"
            : undefined;

  return {
    page,
    path,
    ...(levelId ? { levelId, moduleTab, practiceTab } : {}),
    ...(!levelId && practiceTab ? { practiceTab } : {}),
    ...(practiceDistanceMode ? { practiceDistanceMode } : {}),
    ...(playgroundStatsTab ? { playgroundStatsTab } : {}),
    ...(songId ? { songId } : {}),
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
  return undefined;
}

export function isStaffGameRoutePath(path: AppRoutePath): boolean {
  return (
    path === "/playground/challenge" ||
    path === "/playground/songs" ||
    path === "/playground/songs/play"
  );
}

export function isStaffGameSongRoutePath(path: AppRoutePath): boolean {
  return path === "/playground/songs" || path === "/playground/songs/play";
}

export function isProtectedPracticeRoute(route: AppRoute): boolean {
  return (
    route.page === "game" ||
    route.path === "/playground/songs/score" ||
    (route.levelId !== undefined && route.levelId > 1 && route.moduleTab === "practice")
  );
}

export function isSamePracticeContext(current: AppRoute, next: AppRoute): boolean {
  if (current.page === "game" && next.page === "game") return true;
  if (current.path === "/playground/songs/score" && next.path === current.path) return true;
  return (
    current.page === "practice" &&
    next.page === "practice" &&
    current.levelId === next.levelId &&
    current.moduleTab === "practice" &&
    next.moduleTab === "practice"
  );
}

export function appRoutesEqual(left: AppRoute, right: AppRoute): boolean {
  return (
    left.path === right.path &&
    left.songId === right.songId &&
    left.practiceTab === right.practiceTab &&
    left.practiceDistanceMode === right.practiceDistanceMode &&
    left.moduleTab === right.moduleTab &&
    left.playgroundStatsTab === right.playgroundStatsTab
  );
}

export function appRoutePathForPage(page: AppRoutePage): AppRoutePath {
  if (page === "home") return "/";
  if (page === "study") return "/level/1";
  if (page === "practice") return "/level/2";
  if (page === "game") return "/playground/challenge";
  if (page === "stats") return "/playground/stats";
  return `/${page}` as AppRoutePath;
}

export function appRouteUrl(path: AppRoutePath, query?: Record<string, string>): string {
  const queryString = query ? new URLSearchParams(query).toString() : "";
  return `${window.location.pathname}${window.location.search}#${path}${queryString ? `?${queryString}` : ""}`;
}
