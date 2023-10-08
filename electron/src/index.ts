import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, XClient, createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig } from "./types/FyrTypes";
import { logToFile, LogLevel, homedir, exec } from "./lib/shared";
import { promisify } from "util";
import { defaultFyrConfig } from "./lib/config";

enum SplitDirection {
  Horizontal = 0,
  Vertical = 1,
}

interface WindowGeometry {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

// Globals
const wmLogFilePath = join(homedir(), ".fyr", "logs", "wm.log");
let X: XClient;
let root: number;
let desktopWindow: BrowserWindow;
let desktopWid: number;
let currentWindowId: number | null = null;
let screen = null;
let GetPropertyAsync: (...args) => Promise<any>;
let splitDirection = SplitDirection.Horizontal;
let autocompleteWid: number = null;
// Tracks electron windows
const browserWindowIds: Set<number> = new Set();
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

  // const wid = X.AllocID();
  // X.CreateWindow(wid, root, 0, 0, width, height, 0, 0, 0, 0, {
  //   eventMask: X.eventMask.Exposure,
  // });
  X.MapWindow(root);
  setWallpaper(root);
  return root;
};

const getWindowGeometry = (windowId: number): Promise<any> => {
  return new Promise((resolve, reject) => {
    X.GetGeometry(windowId, (err, geometry) => {
      if (err) {
        return reject(err);
      }
      resolve({
        windowId,
        ...geometry,
      });
    });
  });
};

const fetchAppName = async (wid: number): Promise<string | null> => {
  try {
    console.log("Debug Atom:", X.atoms._NET_WM_NAME, X.atoms.WM_CLASS); // Debug line
    const wmNameProperty = await GetPropertyAsync(
      0,
      wid,
      X.atoms._NET_WM_NAME,
      X.atoms.STRING,
      0,
      100
    );
    if (wmNameProperty && wmNameProperty.data) {
      return wmNameProperty.data.toString();
    }
    // Fallback to WM_CLASS if _NET_WM_NAME is not available
    const wmClassProperty = await GetPropertyAsync(
      0,
      wid,
      X.atoms.WM_CLASS,
      X.atoms.STRING,
      0,
      100
    );
    if (wmClassProperty && wmClassProperty.data) {
      const classString = wmClassProperty.data.toString();
      const parts = classString.split("\0");
      return parts[0];
    }
    return null;
  } catch (err) {
    logToFile(
      wmLogFilePath,
      `Failed to fetch app name for wid: ${wid} - ${err}`,
      LogLevel.ERROR
    );
    return null;
  }
};

const openApp = async (
  appWid: number,
  splitDirection: number,
  currentWindowId?: number
): Promise<void> => {
  // logToFile(wmLogFilePath, `Opening: ${await fetchAppName(appWid)}`);
  // Verify that app is GUI application before launching
  const isGuiApp = await checkIfGuiApp(appWid);

  if (!isGuiApp) return;

  // logToFile(
  //   wmLogFilePath,
  //   `${fetchAppName(appWid)} is a gui application :D`,
  //   LogLevel.DEBUG
  // );

  openedWindows.add(appWid);

  if (openedWindows.size === 1) {
    X.ResizeWindow(appWid, screen.width_in_pixels, screen.height_in_pixels);
  }

  // Fetch geometry for all windows
  const allWindowDimensions = [];
  const geometryPromises = Array.from(openedWindows).map(getWindowGeometry);
  try {
    const geometries = await Promise.all(geometryPromises);
    allWindowDimensions.push(...geometries);
  } catch (err) {
    logToFile(
      wmLogFilePath,
      "Failed to get geometry for some windows: " + err,
      LogLevel.ERROR
    );
    return;
  }

  // Get size of current window for splitting
  const currentWindowGeometry = allWindowDimensions.find(
    (geom) => geom.windowId === currentWindowId
  );
  if (!currentWindowGeometry) {
    logToFile(
      wmLogFilePath,
      "Current window geometry not found. You probably fricked up, it's surely not my fault 😏"
    );
    return;
  }

  let newDimensions: WindowGeometry;
  let updatedCurrentWindowDimensions: WindowGeometry;

  // Calculate new dimensions based on split direction
  if (splitDirection === SplitDirection.Horizontal) {
    newDimensions = {
      width: currentWindowGeometry.width / 2,
      height: currentWindowGeometry.height,
      x: currentWindowGeometry.x + currentWindowGeometry.width / 2,
      y: currentWindowGeometry.y,
    };

    updatedCurrentWindowDimensions = {
      width: currentWindowGeometry.width / 2,
      height: currentWindowGeometry.height,
    };
  } else if (splitDirection === SplitDirection.Vertical) {
    newDimensions = {
      width: currentWindowGeometry.width,
      height: currentWindowGeometry.height / 2,
      x: currentWindowGeometry.x,
      y: currentWindowGeometry.y + currentWindowGeometry.height / 2,
    };

    updatedCurrentWindowDimensions = {
      width: currentWindowGeometry.width,
      height: currentWindowGeometry.height / 2,
    };
  } else {
    logToFile(
      wmLogFilePath,
      "Couldn't get split direction. Something terrible has happened.",
      LogLevel.ERROR
    );
  }

  // Make the desktop the parent
  // Resize the new window
  X.ReparentWindow(appWid, desktopWid, newDimensions.x, newDimensions.y);
  X.ResizeWindow(appWid, newDimensions.width, newDimensions.height);
  X.MapWindow(appWid);

  // Also resize the currently focused window
  X.ResizeWindow(
    currentWindowId,
    updatedCurrentWindowDimensions.width,
    updatedCurrentWindowDimensions.height
  );
  return;
};

const initX11Client = () => {
  createClient((err, display: XDisplay) => {
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

    logToFile(wmLogFilePath, "Getting PROPERTY", LogLevel.DEBUG);
    GetPropertyAsync = promisify(X.GetProperty).bind(X);

    X.ChangeWindowAttributes(root, {
      eventMask: X.eventMask.SubstructureNotify,
    });

    // Capture keyboard, mouse, and window events

    X.on("event", async (ev) => {
      // logToFile(
      //   wmLogFilePath,
      //   `wid=${ev.wid} name=${await fetchAppName(ev.wid)}`
      // );

      if (["KeyPress", "KeyRelease"].includes(ev.name)) {
        if (currentWindowId) {
          X.SendEvent(false, currentWindowId, true, X.eventMask[ev.name], ev);
        }
      } else if (ev.name === "ButtonPress") {
        // Set focus to the clicked window
        X.SetInputFocus(ev.wid);
      } else if (ev.name === "FocusIn") {
        // Update currentWindowId when a window gains focus
        currentWindowId = ev.wid;
      } else if (ev.name === "FocusOut") {
        // Try to set currentWindowId to a reasonable fallback
        if (openedWindows.size === 0) {
          currentWindowId = null;
        } else {
          currentWindowId = Array.from(openedWindows).pop() || null; // Last opened or focused window
        }
      }

      // Handle new windows
      if (ev.name === "CreateNotify") {
        if (!openedWindows.has(ev.wid)) {
          openApp(ev.wid, splitDirection, currentWindowId);
          currentWindowId = ev.wid;
        } else {
          logToFile(
            wmLogFilePath,
            "Open a new window? No thanks, I already got one.",
            LogLevel.INFO
          );
        }
      }

      // Handle window closing - this is a simplification
      if (ev.name === "DestroyNotify") {
        openedWindows.delete(ev.wid);
        if (currentWindowId === ev.wid) {
          if (openedWindows.size === 0) {
            currentWindowId = null;
          } else {
            // Last opened or focused window
            currentWindowId = Array.from(openedWindows).pop() || null;
          }
        }
      }
    });
  });
};

const addBrowserWindowId = (windowId: number) => {
  browserWindowIds.add(windowId);
};

// Get Id to create/map/reparent BrowserWindows, also add to set
const getElectronWindowId = (browserWindow: BrowserWindow): number => {
  const nativeHandle = browserWindow.getNativeWindowHandle();
  const wid = nativeHandle.readUint32LE(0);
  addBrowserWindowId(wid);
  return wid;
};

app.whenReady().then(() => {
  initX11Client();

  /*
   --------------------- Keyboard shortcuts!--------------
    TODO: Add more
  */

  // App launcher
  const autocompleteShortcut = globalShortcut.register("Super+Space", () => {
    logToFile(wmLogFilePath, "Opening launcher", LogLevel.INFO);
    openAutoComplete();
  });
  if (!autocompleteShortcut) {
    logToFile(
      wmLogFilePath,
      "Launcher keyboard registration failed :(",
      LogLevel.ERROR
    );
  }

  // Exit WM if ctrl+alt+del pressed 3 times
  let counter = 0;
  let timerId: NodeJS.Timeout | null = null;

  const resetCounter = () => {
    counter = 0;
  };

  const closeAppShortcut = globalShortcut.register("Ctrl+Alt+Delete", () => {
    counter++;

    if (timerId) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(resetCounter, 2000); // reset the counter if 2 seconds pass between key presses

    if (counter >= 3) {
      logToFile(wmLogFilePath, "Closing desktop environment", LogLevel.INFO);
      app.quit();
    }
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
    globalShortcut.unregisterAll();
    app.quit();
  }
});

//---------------------------------------------- REACT EVENTS----------------------------------------------------

ipcMain.on("onLaunchApp", (event, appCommand) => {
  const [command, ...args] = appCommand.split(" ");

  const child = spawn(command, args, {
    env: { ...process.env },
    shell: true,
  });

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
  const appPaths = [
    "/usr/share/applications",
    // Add other paths if needed
  ];

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

const openAutoComplete = () => {
  const [width, height] = [screen.pixel_width, screen.pixel_height];

  // Calculate the x and y coordinates to center the window
  const x = Math.round((width - 400) / 2);
  const y = Math.round((height - 60) / 2);

  const autoCompleteWindow = new BrowserWindow({
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

  autoCompleteWindow.loadFile("./dist/vue/app-launcher.html");

  autoCompleteWindow.setFullScreen(false);
  autoCompleteWindow.setFocusable(true);
  autoCompleteWindow.setAlwaysOnTop(true);
  const autocompleteWid = getElectronWindowId(autoCompleteWindow);
  openedWindows.add(autocompleteWid);
  /* 
    Reparent Electron container into x11 window container
    TODO: Wrap this into new function
  */
  const x11ContainerId = X.AllocID();
  openedWindows.add(x11ContainerId);

  // Desktop should be root in almost every situation
  X.CreateWindow(x11ContainerId, desktopWid, x, y, 400, 60, 0, 0, 0, 0, {
    eventMask: eventMask,
    backgroundPixel: 10,
  });

  X.MapWindow(x11ContainerId);
  X.ReparentWindow(autocompleteWid, x11ContainerId, 0, 0);
  X.MapWindow(autocompleteWid);
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
