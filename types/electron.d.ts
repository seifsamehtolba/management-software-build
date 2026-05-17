export {};

declare global {
  interface Window {
    electronApp?: {
      platform: string;
      onUpdateChecking: (cb: () => void) => () => void;
      onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string | null }) => void) => () => void;
      onUpdateNotAvailable: (cb: () => void) => () => void;
      onUpdateProgress: (cb: (p: { percent: number; transferred: number; total: number }) => void) => () => void;
      onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void;
      onUpdateError: (cb: (e: { message: string }) => void) => () => void;
      installUpdate: () => void;
    };
  }
}
