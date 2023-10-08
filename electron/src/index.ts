import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, XClient, createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig } from "./types/FyrTypes";
import { logToFile, LogLevel } from "./lib/shared";
import { promisify } from "util";

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

const wmLogFilePath = join(homedir(), ".fyr", "logs", "wm.log");

let X: XClient;
let root: number;
let desktopWindow: BrowserWindow;
let desktopWid: number;

let splitDirection = SplitDirection.Horizontal;

// Tracks electron windows
const browserWindowIds: Set<number> = new Set();

// Track all open x11 windows
const openedWindows: Set<number> = new Set();

// Get user settings.
const config: FyrConfig = (() => {
  const configPath = path.join(process.env.HOME!, ".fyr/wm/config.json");
  const rawData = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(rawData);
})();

const setWallpaper = (wid: number) => {
  const wallpaperPath = config.customizations.wallpaperPath;
  exec(`feh --bg-scale ${wallpaperPath} --window-id ${wid}`, (error) => {
    if (error) {
      logToFile(
        wmLogFilePath,
        `Failed to set wallpaper: ${error}`,
        LogLevel.ERROR
      );
    }
  });
};

const initDesktop = (display: XDisplay) => {
  const screen = display.screen[0];
  root = screen.root;
  const width = screen.pixel_width;
  const height = screen.pixel_height;

  const wid = X.AllocID();
  X.CreateWindow(wid, root, 0, 0, width, height, 0, 0, 0, 0, {
    eventMask: X.eventMask.Exposure,
  });
  X.MapWindow(wid);
  setWallpaper(wid);
  return wid;
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

    X.ChangeWindowAttributes(root, {
      eventMask: X.eventMask.SubstructureNotify,
    });

    // Capture keyboard, mouse, and window events
    let focusedWindowId: number;
    X.on("event", (ev) => {
      // Pass keyboard input to focused windows
      if (ev.name === "KeyPress") {
        if (focusedWindowId) {
          X.SendEvent(false, focusedWindowId, true, X.eventMask.KeyPress, ev);
        }
      } else if (ev.name === "FocusIn") {
        focusedWindowId = ev.wid;
      } else if (ev.name === "FocusOut") {
        focusedWindowId = null;
      }

      // Map applications
      if (ev.name === "CreateNotify") {
        if (!openedWindows.has(ev.wid)) {
          // openApp(ev.wid);
          openedWindows.add(ev.wid);
        }
      } else {
        logToFile(
          wmLogFilePath,
          "Open a new window? No thanks, I already got one.",
          LogLevel.INFO
        );
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

const openAutoComplete = () => {
  const autoCompleteWindow = new BrowserWindow({
    width: 120,
    height: 70,
    x: 0,
    y: 0,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  autoCompleteWindow.loadFile("./dist/vue/app-launcher.html");
  autoCompleteWindow.setFullScreen(false);
  autoCompleteWindow.setFocusable(true);
  autoCompleteWindow.setAlwaysOnTop(true);
  const desktopWid = getElectronWindowId(desktopWindow);
  const autocompleteWid = getElectronWindowId(autoCompleteWindow);

  openedWindows.add(autocompleteWid);

  /* 
    Reparent Electron container into x11 window container
    TODO: Wrap this into new function
  */
  const x11ContainerId = X.AllocID();
  openedWindows.add(x11ContainerId);

  // Desktop should be root in almost every situation
  X.CreateWindow(x11ContainerId, desktopWid, 55, 60, 120, 80, 0, 0, 0, 0, {
    eventMask: eventMask,
    backgroundPixel: 10,
  });

  X.MapWindow(x11ContainerId);
  X.ReparentWindow(autocompleteWid, x11ContainerId, 0, 0);
  X.MapWindow(autocompleteWid);
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

const GetPropertyAsync = promisify(X.GetProperty).bind(X);

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

// Create X11 container window with desktop as parent
// Create React component and reparent inside X11 container
const openApp = async (
  appWid: number,
  splitDirection: number,
  currentWindowId: number
) => {
  // Verify that app is GUI application before launching
  const isGuiApp = await checkIfGuiApp(appWid);

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
  // Reparent and resize the new window
  X.ReparentWindow(appWid, desktopWid, newDimensions.x, newDimensions.y);
  X.ResizeWindow(appWid, newDimensions.width, newDimensions.height);
  X.MapWindow(appWid);

  // Also resize the currently focused window
  X.ResizeWindow(
    currentWindowId,
    updatedCurrentWindowDimensions.width,
    updatedCurrentWindowDimensions.height
  );
};

app.whenReady().then(() => {
  initX11Client();
  const autocompleteShortcut = globalShortcut.register("Control+Space", () => {
    console.log("Control+Space is pressed");
    // controlSpacePressed = true;
    openAutoComplete();
  });
  if (!autocompleteShortcut) {
    console.log("registration failed");
  }

  const closeAppShortcut = globalShortcut.register("Super+Shift+Q", () => {
    console.log("Super+Shift+Q is pressed");
    app.quit();
  });
  if (!closeAppShortcut) {
    console.log("Super+Shift+Q registration failed");
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
    console.error(`Failed to start child process: ${error}`);
  });

  child.on("exit", (code) => {
    if (code !== null) {
      console.log(`Child process exited with code ${code}`);
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
          const config = ini.parse(data);

          const desktopEntry = config["Desktop Entry"];
          if (desktopEntry && desktopEntry.Name && desktopEntry.Exec) {
            apps.push({
              name: desktopEntry.Name,
              exec: desktopEntry.Exec,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Could not read directory ${path}: ${err}`);
    }
  }

  return apps;
});
function exec(arg0: string, arg1: (error: any) => void) {
  throw new Error("Function not implemented.");
}
function homedir(): string {
  throw new Error("Function not implemented.");
}
