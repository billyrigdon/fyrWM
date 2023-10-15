import { FyrConfig } from "../types/FyrTypes";

export const defaultFyrConfig: FyrConfig = {
  customizations: {
    wallpaperPath: "/home/billy/Wallpapers/Richard-Stallman.png",
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
