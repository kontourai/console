/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONSOLE_HUB_URL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
