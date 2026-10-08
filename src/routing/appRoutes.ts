export type AppRoutePath = "/" | "/study" | "/practice" | "/practice/game" | "/stats" | "/vocal" | "/settings";
export type AppRoutePage = "home" | "study" | "practice" | "stats" | "settings" | "vocal";

export interface AppRoute {
  page: AppRoutePage;
  path: AppRoutePath;
}

const ROUTE_PATHS = new Set<AppRoutePath>([
  "/",
  "/study",
  "/practice",
  "/practice/game",
  "/stats",
  "/vocal",
  "/settings",
]);

export function appRouteFromHash(hash: string): AppRoute {
  const rawPath = hash.replace(/^#/, "").split("?")[0] || "/";
  const normalizedPath = (rawPath.startsWith("/") ? rawPath : `/${rawPath}`) as AppRoutePath;
  const path = ROUTE_PATHS.has(normalizedPath) ? normalizedPath : "/";
  const page: AppRoutePage = path === "/"
    ? "home"
    : path === "/practice/game"
      ? "practice"
      : path.slice(1) as Exclude<AppRoutePage, "home">;
  return { page, path };
}

export function appRoutePathForPage(page: AppRoutePage): AppRoutePath {
  return page === "home" ? "/" : `/${page}` as AppRoutePath;
}

export function appRouteUrl(path: AppRoutePath): string {
  return `${window.location.pathname}${window.location.search}#${path}`;
}
