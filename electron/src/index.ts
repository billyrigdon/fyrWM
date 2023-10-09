import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, XClient, createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig, SplitDirection, WindowGeometry } from "./types/FyrTypes";
import { logToFile, LogLevel, homedir, exec } from "./lib/utils";
import { promisify } from "util";
import { defaultFyrConfig } from "./lib/config";
import {
  Atom,
  IX11Client,
  IX11Mod,
  IXClient,
  IXDisplay,
  IXEvent,
  IXKeyEvent,
  PointerRoot,
  X11_EVENT_TYPE,
  X11_KEY_MODIFIER,
  XFocusRevertTo,
} from "./types/X11Types";
import { IBounds } from "./lib/utils";
const x11: IX11Mod = require("x11");

// Globals
const wmLogFilePath = join(homedir(), ".fyr", "logs", "wm.log");
let X: IXClient;
let client: IX11Client;
let root: number;
let desktopWindow: BrowserWindow = null;
let desktopWid: number;
let currentWindowId: number | null = null;
let screen = null;
let GetPropertyAsync: (...args) => Promise<any>;
let splitDirection = SplitDirection.Horizontal;
let launcherWid: number = null;
let launcherWindow: BrowserWindow = null;
let launcherInited: boolean = false;

// Track all open x11 windows
const openedWindows: Set<number> = new Set();

// Get user settings. Called immediately
const config: FyrConfig = (() => {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    throw new Error("HOME directory is not set.");
  }
  const configPath = path.join(homeDir, ".fyr/wm/config.json");

  try {
    const rawData = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(rawData);
  } catch (err) {
    logToFile(
      wmLogFilePath,
      `Could not read config file, creating a new one with default setting`,
      LogLevel.DEBUG
    );
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Write the default config to the file
    fs.writeFileSync(
      configPath,
      JSON.stringify(defaultFyrConfig, null, 2),
      "utf-8"
    );

    return defaultFyrConfig;
  }
})();

// Depends on feh package
const setWallpaper = (wid: number) => {
  const wallpaperPath = config.customizations.wallpaperPath;
  const command = `feh --bg-scale ${wallpaperPath}`;
  logToFile(
    wmLogFilePath,
    `Setting wallpaper from ${wallpaperPath} with command ${command}`,
    LogLevel.INFO
  );

  exec(command, (error) => {
    if (error) {
      logToFile(
        wmLogFilePath,
        `Failed to set wallpaper: ${error}. Is 'feh' installed?`,
        LogLevel.ERROR
      );
    } else {
    }
  });
};

const initDesktop = (display: XDisplay) => {
  screen = display.screen[0];
  root = screen.root;
  const width = screen.pixel_width;
  const height = screen.pixel_height;

  X.MapWindow(root);
  setWallpaper(root);
  return root;
};

const openApp = async (
  appWid: number,
  splitDirection: number,
  currentWindowId?: number
): Promise<void> => {
  // logToFile(
  //   wmLogFilePath,
  //   "OPEN WINDOWS:" + openedWindows.size.toString(),
  //   LogLevel.DEBUG
  // );

  openedWindows.add(appWid);

  logToFile(wmLogFilePath, "Beginning open map", LogLevel.ERROR);

  X.MapWindow(appWid);
};

const initX11Client = async () => {
  client = createClient((err, display: XDisplay) => {
    if (err) {
      logToFile(
        wmLogFilePath,
        `Error in X11 connection:${err}`,
        LogLevel.ERROR
      );
      return;
    }

    X = display.client;
    desktopWid = initDesktop(display);
    // GetPropertyAsync = promisify(X.GetProperty).bind(X);

    X.ChangeWindowAttributes(
      root,
      {
        eventMask:
          x11.eventMask.SubstructureNotify | x11.eventMask.SubstructureRedirect,
      },
      (err) => {
        logToFile(
          wmLogFilePath,
          "Couldn't change event mask :(",
          LogLevel.ERROR
        );
      }
    );

    // Capture keyboard, mouse, and window events
    client.on("event", async (ev: IXEvent) => {
      const { type } = ev;
      switch (type) {
        case X11_EVENT_TYPE.KeyPress:
          X.SendEvent(ev.wid, true, x11.eventMask.KeyPress, ev.rawData);
          break;
        case X11_EVENT_TYPE.KeyRelease:
          X.SendEvent(ev.wid, true, x11.eventMask.KeyRelease, ev.rawData);
          break;
        case X11_EVENT_TYPE.ButtonPress:
          // Set focus to the clicked window
          X.SetInputFocus(PointerRoot, XFocusRevertTo.PointerRoot);
          X.SendEvent(ev.wid, true, x11.eventMask.ButtonPress, ev.rawData);
          break;
        case X11_EVENT_TYPE.ButtonRelease:
          X.SendEvent(ev.wid, true, x11.eventMask.ButtonRelease, ev.rawData);
          break;
        case X11_EVENT_TYPE.MotionNotify:
          break;
        case X11_EVENT_TYPE.EnterNotify:
          break;
        case X11_EVENT_TYPE.LeaveNotify:
          break;
        case X11_EVENT_TYPE.FocusIn:
          // Update currentWindowId when a window gains focus
          currentWindowId = ev.wid;
          logToFile(wmLogFilePath, ev.name, LogLevel.ERROR);
          break;
        case X11_EVENT_TYPE.FocusOut:
          // Try to set currentWindowId to a reasonable fallback
          if (openedWindows.size === 0) {
            currentWindowId = null;
          } else {
            currentWindowId = Array.from(openedWindows).pop() || null;
          }
          break;
        case X11_EVENT_TYPE.Expose:
          break;
        case X11_EVENT_TYPE.CreateNotify:
          //currentWindowId = ev.wid;
          break;
        case X11_EVENT_TYPE.MapRequest:
          openApp(ev.wid, splitDirection, currentWindowId);
          currentWindowId = ev.wid;
          break;
        case X11_EVENT_TYPE.DestroyNotify:
          if (openedWindows.has(ev.wid)) {
            openedWindows.delete(ev.wid);
          }
          if (currentWindowId === ev.wid) {
            if (openedWindows.size === 0) {
              currentWindowId = null;
            } else {
              // Last opened or focused window
              currentWindowId = Array.from(openedWindows).pop() || null;
            }
          }
          break;
        case X11_EVENT_TYPE.UnmapNotify:
          break;
        case X11_EVENT_TYPE.MapNotify:
          break;
        case X11_EVENT_TYPE.MapRequest:
          break;
        case X11_EVENT_TYPE.ReparentNotify:
          break;
        case X11_EVENT_TYPE.ConfigureNotify:
          break;
        case X11_EVENT_TYPE.ConfigureRequest:
          break;
        case X11_EVENT_TYPE.ClientMessage:
          break;
        case X11_EVENT_TYPE.PropertyNotify:
          break;
        default:
          break;
      }
    });
  });
};

const getElectronWindowId = (browserWindow: BrowserWindow): number => {
  const nativeHandle = browserWindow.getNativeWindowHandle();
  const wid = nativeHandle.readUint32LE(0);
  return wid;
};

app.whenReady().then(() => {
  initX11Client();
  /*
   --------------------- Keyboard shortcuts!--------------
    TODO: Add more
  */

  // App launcher
  const launcherShortcut = globalShortcut.register("Super+Space", () => {
    logToFile(wmLogFilePath, "TOGGLING LAUNCHER", LogLevel.INFO);
    if (launcherWid && launcherWindow.isVisible()) {
      logToFile(wmLogFilePath, "HIDING LAUNCHER", LogLevel.INFO);
      launcherWindow.hide();
    } else if (launcherInited) {
      logToFile(wmLogFilePath, "SHOWING LAUNCHER", LogLevel.INFO);
      launcherWindow.show();
    } else {
      logToFile(wmLogFilePath, "LAUNCHING LAUNCHER", LogLevel.INFO);
      openLauncher();
    }
  });
  if (!launcherShortcut) {
    logToFile(
      wmLogFilePath,
      "Launcher keyboard registration failed :(",
      LogLevel.ERROR
    );
  }

  // Exit wm
  const closeAppShortcut = globalShortcut.register("Ctrl+Shift+Q", () => {
    app.quit();
  });
  if (!closeAppShortcut) {
    logToFile(
      wmLogFilePath,
      "You can check out any time you like, but you can never leave..",
      LogLevel.ERROR
    );
  }

  // Window split directions
  const horizontalSplitShortcut = globalShortcut.register("Super+H", () => {
    logToFile(
      wmLogFilePath,
      "Setting split direction to horizontal",
      LogLevel.INFO
    );
    splitDirection = SplitDirection.Horizontal; // Assuming SplitDirection is an enum you've defined
  });

  if (!horizontalSplitShortcut) {
    logToFile(
      wmLogFilePath,
      "Horizontal split keyboard registration failed :(",
      LogLevel.ERROR
    );
  }

  try {
    const verticalSplitShortcut = globalShortcut.register("Super+V", () => {
      logToFile(
        wmLogFilePath,
        "Setting split direction to vertical",
        LogLevel.INFO
      );
      splitDirection = SplitDirection.Vertical; // Assuming SplitDirection is an enum you've defined
    });

    if (!verticalSplitShortcut) {
      logToFile(
        wmLogFilePath,
        "Vertical split keyboard registration failed :(",
        LogLevel.ERROR
      );
    }
  } catch (err) {
    logToFile(
      wmLogFilePath,
      "Vertical split keyboard registration failed :(",
      LogLevel.ERROR
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) initX11Client();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Unregister all shortcuts.
  }
});

//---------------------------------------------- REACT EVENTS----------------------------------------------------

ipcMain.on("onLaunchApp", (event, appCommand) => {
  const [command, ...args] = appCommand.split(" ");
  // if (launcherWid) launcherWid = null;
  const child = spawn(command, args, {
    env: { ...process.env },
    shell: true,
  });
  launcherWindow.hide();

  child.on("error", (error) => {
    logToFile(
      wmLogFilePath,
      `Failed to start child process: ${error}`,
      LogLevel.ERROR
    );
  });

  child.on("exit", (code) => {
    if (code !== null) {
      logToFile(
        wmLogFilePath,
        `Child process exited with code ${code}`,
        LogLevel.DEBUG
      );
    }
  });
});

ipcMain.handle("getApps", async () => {
  const appPaths = ["/usr/share/applications"];

  const apps = [];

  for (const path of appPaths) {
    try {
      const files = fs.readdirSync(path);

      for (const file of files) {
        if (file.endsWith(".desktop")) {
          const filePath = `${path}/${file}`;
          const data = fs.readFileSync(filePath, "utf-8");
          const appConfig = ini.parse(data);

          const desktopEntry = appConfig["Desktop Entry"];
          if (desktopEntry && desktopEntry.Name && desktopEntry.Exec) {
            apps.push({
              name: desktopEntry.Name,
              exec: desktopEntry.Exec,
            });
          }
        }
      }
    } catch (err) {
      logToFile(
        wmLogFilePath,
        `Could not read directory ${path}: ${err}`,
        LogLevel.ERROR
      );
    }
  }

  return apps;
});

const openLauncher = () => {
  // if (launcherInited) {
  // launcherWindow.show();
  // return;
  // }
  // launcherInited = true;
  const [width, height] = [screen.pixel_width, screen.pixel_height];

  // Calculate the x and y coordinates to center the window
  const [x, y] = [Math.round((width - 400) / 2), Math.round((height - 60) / 2)];

  launcherWindow = new BrowserWindow({
    width: 400,
    height: 60,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    backgroundColor: "#ffffff", // white background
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  launcherWindow.webContents.loadFile("./dist/vue/app-launcher.html");

  launcherWindow.setFullScreen(false);
  launcherWindow.setFocusable(true);
  launcherWindow.setAlwaysOnTop(true);
  launcherWid = getElectronWindowId(launcherWindow);
  X.ReparentWindow(launcherWid, root, x, y);
  X.MapWindow(launcherWid);
  X.SetInputFocus(launcherWid, XFocusRevertTo.PointerRoot);
};

const checkIfGuiApp = async (windowId: number): Promise<boolean> => {
  try {
    const prop = await GetPropertyAsync(
      0,
      windowId,
      X.atoms["_NET_WM_WINDOW_TYPE"],
      X.atoms["CARDINAL"],
      0,
      4
    );

    if (prop.data && prop.data.length) {
      // Check if it's a normal or dialog window, these are usually GUI apps
      const isGui =
        prop.data.includes(X.atoms["_NET_WM_WINDOW_TYPE_NORMAL"]) ||
        prop.data.includes(X.atoms["_NET_WM_WINDOW_TYPE_DIALOG"]);

      if (isGui) {
        logToFile(
          wmLogFilePath,
          `${windowId} is a GUI application. Launching now.`,
          LogLevel.INFO
        );
      }

      return isGui;
    } else {
      return false;
    }
  } catch (err) {
    logToFile(
      wmLogFilePath,
      `An error occurred while checking if ${windowId} is a GUI application: ${err}`,
      LogLevel.ERROR
    );
    throw err; // Or return false if you prefer
  }
};
