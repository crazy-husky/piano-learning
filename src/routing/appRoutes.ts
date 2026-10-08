export type AppRoutePath = "/" | "/study" | "/practice" | "/practice/game" | "/practice/game/songs" | "/practice/game/songs/play" | "/stats" | "/vocal" | "/settings";
export type AppRoutePage = "home" | "study" | "practice" | "stats" | "settings" | "vocal";

export interface AppRoute {
  page: AppRoutePage;
  path: AppRoutePath;
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
  const songId = path === "/practice/game/songs/play"
    ? new URLSearchParams(rawQuery).get("songId")?.slice(0, 80) || undefined
    : undefined;
  const page: AppRoutePage = path === "/"
    ? "home"
    : path.startsWith("/practice/game")
      ? "practice"
      : path.slice(1) as Exclude<AppRoutePage, "home">;
  return { page, path, songId };
}

export function isStaffGameRoutePath(path: AppRoutePath): boolean {
  return path === "/practice/game" || path === "/practice/game/songs" || path === "/practice/game/songs/play";
}

export function isStaffGameSongRoutePath(path: AppRoutePath): boolean {
  return path === "/practice/game/songs" || path === "/practice/game/songs/play";
}

export function appRoutePathForPage(page: AppRoutePage): AppRoutePath {
  return page === "home" ? "/" : `/${page}` as AppRoutePath;
}

export function appRouteUrl(path: AppRoutePath, query?: Record<string, string>): string {
  const queryString = query ? new URLSearchParams(query).toString() : "";
  return `${window.location.pathname}${window.location.search}#${path}${queryString ? `?${queryString}` : ""}`;
}
