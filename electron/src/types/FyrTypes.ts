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
  INFO = 'INFO',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}