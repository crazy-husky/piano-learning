export const BROWSER_SUPPORT_REQUIREMENTS =
  "Chrome / Edge 108+、Firefox 101+、Safari / iOS 16.4+，或具备同等新内核的浏览器";

type BrowserFloor = {
  browser: string;
  major: number;
  minor?: number;
  minimum: string;
};

export type BrowserSupportResult = {
  supported: boolean;
  versionIssue?: string;
  missingFeatures: string[];
};

function belowFloor(major: number, minor: number, floor: BrowserFloor): boolean {
  return major < floor.major || (major === floor.major && minor < (floor.minor ?? 0));
}

function findVersionIssue(userAgent: string): string | undefined {
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  if (isIOS) {
    const iosVersion = userAgent.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/i);
    if (iosVersion) {
      const floor: BrowserFloor = { browser: "iOS", major: 16, minor: 4, minimum: "16.4" };
      const major = Number(iosVersion[1]);
      const minor = Number(iosVersion[2]);
      if (belowFloor(major, minor, floor)) {
        return `检测到 iOS ${major}.${minor}，最低需要 iOS ${floor.minimum}。`;
      }
    }

    // iOS 上的 Chrome、Edge、Firefox 和第三方浏览器都使用系统 WebKit，
    // 应检查 iOS 版本及下方的实际 API，而不是浏览器自己的应用版本号。
    return undefined;
  }

  const knownFloors: Array<{ pattern: RegExp; floor: BrowserFloor }> = [
    {
      pattern: /EdgA?\/([\d]+)/i,
      floor: { browser: "Edge", major: 108, minimum: "108" },
    },
    {
      pattern: /(?:Chrome|Chromium)\/([\d]+)/i,
      floor: { browser: "Chrome", major: 108, minimum: "108" },
    },
    {
      pattern: /Firefox\/([\d]+)/i,
      floor: { browser: "Firefox", major: 101, minimum: "101" },
    },
  ];

  for (const { pattern, floor } of knownFloors) {
    const match = userAgent.match(pattern);
    if (!match) continue;
    const major = Number(match[1]);
    if (belowFloor(major, 0, floor)) {
      return `检测到 ${floor.browser} ${major}，最低需要 ${floor.browser} ${floor.minimum}。`;
    }
    return undefined;
  }

  const safariVersion = userAgent.match(/Version\/(\d+)\.(\d+)(?:\.\d+)? .*Safari\//i);
  if (safariVersion) {
    const major = Number(safariVersion[1]);
    const minor = Number(safariVersion[2]);
    const floor: BrowserFloor = { browser: "Safari", major: 16, minor: 4, minimum: "16.4" };
    if (belowFloor(major, minor, floor)) {
      return `检测到 Safari ${major}.${minor}，最低需要 Safari ${floor.minimum}。`;
    }
  }

  return undefined;
}

function findMissingFeatures(): string[] {
  const missing: string[] = [];

  if (typeof Array.prototype.at !== "function") {
    missing.push("Array.prototype.at");
  }
  if (typeof String.prototype.replaceAll !== "function") {
    missing.push("String.prototype.replaceAll");
  }
  if (typeof Promise.allSettled !== "function") {
    missing.push("Promise.allSettled");
  }
  if (typeof window.ResizeObserver !== "function") {
    missing.push("ResizeObserver");
  }
  if (
    typeof window.PointerEvent !== "function" ||
    typeof Element.prototype.setPointerCapture !== "function"
  ) {
    missing.push("Pointer Events");
  }
  if (!window.CSS || typeof window.CSS.supports !== "function" || !window.CSS.supports("height: 100dvh")) {
    missing.push("动态视口高度单位 dvh");
  }
  if (!supportsWasmSimd()) {
    missing.push("WebAssembly SIMD（清唱音高识别需要）");
  }

  return missing;
}

function supportsWasmSimd(): boolean {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") return false;

  // A minimal module returning v128.const. Engines without SIMD reject it.
  return WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0,
      1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0,
      10, 22, 1, 20, 0, 253, 12,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      11,
    ]),
  );
}

export function inspectBrowserSupport(userAgent = navigator.userAgent): BrowserSupportResult {
  const versionIssue = findVersionIssue(userAgent);
  const missingFeatures = findMissingFeatures();

  return {
    supported: !versionIssue && missingFeatures.length === 0,
    versionIssue,
    missingFeatures,
  };
}

export function renderBrowserUpgradeNotice(root: HTMLElement, result: BrowserSupportResult): void {
  while (root.firstChild) root.removeChild(root.firstChild);

  const page = document.createElement("main");
  page.className = "browser-support-gate";
  const card = document.createElement("section");
  card.className = "browser-support-card";

  const title = document.createElement("h1");
  title.textContent = "请升级浏览器后再使用";
  card.appendChild(title);

  const explanation = document.createElement("p");
  explanation.textContent = "当前浏览器或设备系统版本过低，暂时无法运行单音识谱。";
  card.appendChild(explanation);

  if (result.versionIssue) {
    const version = document.createElement("p");
    version.textContent = result.versionIssue;
    card.appendChild(version);
  }

  if (result.missingFeatures.length > 0) {
    const features = document.createElement("p");
    features.textContent = `缺少运行所需的浏览器功能：${result.missingFeatures.join("、")}。`;
    card.appendChild(features);
  }

  const requirements = document.createElement("p");
  requirements.className = "browser-support-requirements";
  requirements.textContent = `最低支持：${BROWSER_SUPPORT_REQUIREMENTS}。`;
  card.appendChild(requirements);

  const advice = document.createElement("p");
  advice.textContent = "请通过应用商店或设备系统设置升级浏览器/系统，然后重新打开本页面。";
  card.appendChild(advice);

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重新检测";
  retry.addEventListener("click", () => window.location.reload());
  card.appendChild(retry);

  page.appendChild(card);
  root.appendChild(page);
}
