export type AppRoutePath =
  | "/"
  | "/study"
  | "/practice"
  | "/practice/game"
  | "/practice/game/songs"
  | "/practice/game/songs/play"
  | "/stats"
  | "/vocal"
  | "/settings";
export type AppRoutePage = "home" | "study" | "practice" | "game" | "stats" | "settings" | "vocal";
export type PracticeRouteTab = "free" | "distance" | "songs";
export type PracticeDistanceMode = "look" | "play";

export interface AppRoute {
  page: AppRoutePage;
  path: AppRoutePath;
  practiceTab?: PracticeRouteTab;
  practiceDistanceMode?: PracticeDistanceMode;
  songId?: string;
}

const ROUTE_PATHS = new Set<AppRoutePath>([
  "/",
  "/study",
  "/practice",
  "/practice/game",
  "/practice/game/songs",
  "/practice/game/songs/play",
  "/stats",
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
  const songId =
    path === "/practice/game/songs/play"
      ? new URLSearchParams(rawQuery).get("songId")?.slice(0, 80) || undefined
      : undefined;
  const requestedPracticeTab = new URLSearchParams(rawQuery).get("tab");
  const requestedDistanceMode = new URLSearchParams(rawQuery).get("distanceMode");
  const practiceTab: PracticeRouteTab | undefined =
    path === "/practice"
      ? requestedPracticeTab === "distance" || requestedPracticeTab === "songs"
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
      : path.startsWith("/practice/game")
        ? "game"
        : (path.slice(1) as Exclude<AppRoutePage, "home">);
  return { page, path, practiceTab, practiceDistanceMode, songId };
}

export function appRouteQuery(route: AppRoute): Record<string, string> | undefined {
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
    path === "/practice/game" ||
    path === "/practice/game/songs" ||
    path === "/practice/game/songs/play"
  );
}

export function isStaffGameSongRoutePath(path: AppRoutePath): boolean {
  return path === "/practice/game/songs" || path === "/practice/game/songs/play";
}

export function appRoutePathForPage(page: AppRoutePage): AppRoutePath {
  if (page === "home") return "/";
  if (page === "game") return "/practice/game";
  return `/${page}` as AppRoutePath;
}

export function appRouteUrl(path: AppRoutePath, query?: Record<string, string>): string {
  const queryString = query ? new URLSearchParams(query).toString() : "";
  return `${window.location.pathname}${window.location.search}#${path}${queryString ? `?${queryString}` : ""}`;
}
