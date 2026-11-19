export type JsonResult = { data: unknown; fetchedAt: string; fromCache: boolean } | { error: 'offline' | 'network' };
declare global {
  interface Window {
    cosmos: {
      loadSettings(): Promise<unknown>; saveSettings(v: unknown): Promise<void>;
      log(level: string, message: string): void; setOffline(v: boolean): void;
      fetchJson(url: string): Promise<JsonResult>; toggleFullscreen(): Promise<boolean>;
      setResolution(w: number, h: number): Promise<void>;
      info(): Promise<{ version: string; electron: string; logFile: string }>;
      cacheSize(): Promise<number>; clearCache(): Promise<void>; openLogs(): Promise<void>; openLink(url: string): Promise<void>; allowCamera(v: boolean): Promise<void>;
    };
    Cesium?: any;
    CESIUM_BASE_URL?: string;
    __cosmos?: any;
  }
}
