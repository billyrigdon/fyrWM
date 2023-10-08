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

// Example Usage
const config: FyrConfig = {
  customizations: {
    wallpaperPath: "/path/to/wallpaper",
    accentColor: "#FF5733",
    theme: "dark",
  },
  defaultApplications: {
    browser: "chromium",
    terminal: "alacritty",
    textEditor: "vim",
    fileManager: "",
    musicPlayer: "",
  },
  keyboardShortcuts: {
    switchApp: "Alt+Tab",
    openTerminal: "Ctrl+Alt+T",
    openBrowser: "Ctrl+Alt+B",
    openFileManager: "Ctrl+Alt+F",
    increaseVolume: "Ctrl+Up",
    decreaseVolume: "Ctrl+Down",
    muteVolume: "Ctrl+M",
  },
  systemSettings: {
    enableAnimations: true,
    dateTimeFormat: "YYYY-MM-DD HH:mm:ss",
    timezone: "UTC",
    language: "en_US",
  },
  advanced: {
    customScripts: ["/path/to/script1.sh", "/path/to/script2.sh"],
  },
};

enum LogLevel {
  INFO = 'INFO',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG'
}