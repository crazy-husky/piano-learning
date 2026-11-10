/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_PIANO_ANALYTICS_SCRIPT_URL?: string;
  readonly VITE_PIANO_ANALYTICS_ENDPOINT?: string;
}

declare const __APP_BUILD_ID__: string;
declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
