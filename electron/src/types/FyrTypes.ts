export interface FyrConfig {
  customizations: {
    wallpaperPath: string;
    accentColor: string;
    theme: "dark" | "light";
  };
  defaultApplications: {
    browser: string;
    terminal: string;
    textEditor: string;
    fileManager: string;
    musicPlayer: string;
  };
  keyboardShortcuts: {
    switchApp: string;
    openTerminal: string;
    openBrowser: string;
    openFileManager: string;
    increaseVolume: string;
    decreaseVolume: string;
    muteVolume: string;
  };
  systemSettings: {
    enableAnimations: boolean;
    dateTimeFormat: string;
    timezone: string;
    language: string;
  };
  advanced: {
    customScripts?: string[];
  };
}

enum LogLevel {
  INFO = "INFO",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export enum SplitDirection {
  Horizontal = 0,
  Vertical = 1,
}

export interface FyrWindow {
  width: number;
  height: number;
  x: number;
  y: number;
  windowId: number;
  horizontalParentId: number;
  verticalParentId: number;
  horizontalChildId: number;
  verticalChildId: number;
  lastSplitType: SplitDirection;
}
