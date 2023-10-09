import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, XClient, createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig } from "./types/FyrTypes";
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

export const ExtraAtoms = {
  UTF8_STRING: -1,

  WM_PROTOCOLS: 10000,
  WM_DELETE_WINDOW: 10001,

  _NET_WM_NAME: 340,
};

const NO_EVENT_MASK = x11.eventMask.None;

const ROOT_WIN_EVENT_MASK =
  x11.eventMask.SubstructureRedirect |
  x11.eventMask.SubstructureNotify |
  x11.eventMask.EnterWindow |
  x11.eventMask.LeaveWindow |
  x11.eventMask.StructureNotify |
  x11.eventMask.ButtonPress |
  x11.eventMask.ButtonRelease |
  x11.eventMask.FocusChange |
  x11.eventMask.PropertyChange |
  x11.eventMask.KeyPress |
  x11.eventMask.KeyRelease |
  x11.eventMask.Exposure;

const FRAME_WIN_EVENT_MASK =
  x11.eventMask.StructureNotify |
  x11.eventMask.EnterWindow |
  x11.eventMask.LeaveWindow |
  x11.eventMask.SubstructureRedirect |
  x11.eventMask.PointerMotion |
  x11.eventMask.ButtonRelease |
  x11.eventMask.KeyPress;

const CLIENT_WIN_EVENT_MASK =
  x11.eventMask.StructureNotify |
  x11.eventMask.PropertyChange |
  x11.eventMask.FocusChange |
  x11.eventMask.PointerMotion;

export enum XWMWindowType {
  Other = 0,
  Client = 1,
  Frame = 2,
  Desktop = 3,
}

export interface XWMEventConsumerArgs {
  wid: number;
}

export interface XWMEventConsumerArgsWithType extends XWMEventConsumerArgs {
  windowType: XWMWindowType;
}

export interface XWMEventConsumerSetFrameExtentsArgs
  extends XWMEventConsumerArgs {
  frameExtents: IBounds;
}

export interface XWMEventConsumerClientMessageArgs
  extends XWMEventConsumerArgsWithType {
  messageType: Atom;
  data: number[];
}

export interface XWMEventConsumerScreenCreatedArgs {
  /** Root window id. */
  root: number;
  /** Window id of the desktop window created for the screen. */
  desktopWindowId: number;
}

export interface XWMEventConsumerPointerMotionArgs
  extends XWMEventConsumerArgsWithType {
  rootx: number;
  rooty: number;
}

export interface XWMEventConsumerKeyPressArgs
  extends XWMEventConsumerArgsWithType {
  modifiers: X11_KEY_MODIFIER;
  keycode: number;
}

export interface IXWMEventConsumer {
  onScreenCreated?(args: XWMEventConsumerScreenCreatedArgs): void;
  onClientMessage?(args: XWMEventConsumerClientMessageArgs): void;
  onMapNotify?(args: XWMEventConsumerArgsWithType): void;
  onUnmapNotify?(args: XWMEventConsumerArgsWithType): void;
  onPointerMotion?(args: XWMEventConsumerPointerMotionArgs): void;
  onButtonRelease?(args: XWMEventConsumerArgsWithType): void;
  onKeyPress?(args: XWMEventConsumerKeyPressArgs): boolean;

  onSetFrameExtents?(args: XWMEventConsumerSetFrameExtentsArgs): void;
}

export interface XWMContext {
  X: IXClient;
  XDisplay: IXDisplay;

  getWindowIdFromFrameId(wid: number): number | undefined;
  getFrameIdFromWindowId(wid: number): number | undefined;
}

export function startX(): Promise<void> {
  return initX11Client();
}

export class XServer {
  // Could put a teardown method here.
}

export interface IXWMEventConsumer {
  onScreenCreated?(args: XWMEventConsumerScreenCreatedArgs): void;
  onClientMessage?(args: XWMEventConsumerClientMessageArgs): void;
  onMapNotify?(args: XWMEventConsumerArgsWithType): void;
  onUnmapNotify?(args: XWMEventConsumerArgsWithType): void;
  onPointerMotion?(args: XWMEventConsumerPointerMotionArgs): void;
  onButtonRelease?(args: XWMEventConsumerArgsWithType): void;
  onKeyPress?(args: XWMEventConsumerKeyPressArgs): boolean;

  onSetFrameExtents?(args: XWMEventConsumerSetFrameExtentsArgs): void;
}

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
    console.log("Debug Atom:", X.atoms.WM_NAME, X.atoms.WM_CLASS); // Debug line
    const wmNameProperty = await GetPropertyAsync(
      0,
      wid,
      X.atoms.WM_NAME,
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
  logToFile(wmLogFilePath, `Opening: ${await fetchAppName(appWid)}`);
  // Verify that app is GUI application before launching
  // if (appWid === launcherWid && openedWindows.has(launcherWid)) {
  //   openedWindows.delete(launcherWid);
  //   return;
  // } else if (appWid === launcherWid && !openedWindows.has(launcherWid)) {
  //   // openedWindows.add
  // }

  if (!openedWindows.has(appWid)) return;

  //const isGuiApp = await checkIfGuiApp(appWid);

  //logToFile(
  //  wmLogFilePath,
  //  appWid.toString() + isGuiApp ? " is a gui app" : " not a gui app",
  //  LogLevel.DEBUG
  //);

  //if (!isGuiApp) return;

  openedWindows.add(appWid);
  logToFile(wmLogFilePath, "OPEN WINDOWS: " + openedWindows, LogLevel.DEBUG);
  logToFile(wmLogFilePath, openedWindows.size.toString(), LogLevel.DEBUG);
  if (openedWindows.size === 1) {
    X.ResizeWindow(appWid, screen.width_in_pixels, screen.height_in_pixels);
  }
  //
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

  logToFile(wmLogFilePath, JSON.stringify(newDimensions), LogLevel.DEBUG);

  // Make the desktop the parent
  // Resize the new window
  X.ReparentWindow(appWid, desktopWid, newDimensions.x, newDimensions.y);
  X.ResizeWindow(appWid, newDimensions.width, newDimensions.height);
  X.ChangeWindowAttributes(
    appWid,
    {
      eventMask: ROOT_WIN_EVENT_MASK,
    },
    (err) => {
      logToFile(wmLogFilePath, err.toString(), LogLevel.DEBUG);
    }
  );
  X.MapWindow(appWid);

  // Also resize the currently focused window
  X.ResizeWindow(
    currentWindowId,
    updatedCurrentWindowDimensions.width,
    updatedCurrentWindowDimensions.height
  );
  return;
};

async function onKeyPress(ev: IXKeyEvent) {
  const { wid } = ev;
  logToFile(wmLogFilePath, "onKeyPress", LogLevel.INFO);
  logToFile(
    wmLogFilePath,
    "Current window while keyboarding: " + currentWindowId.toString(),
    LogLevel.DEBUG
  );
  if (currentWindowId) {
    X.SendEvent(currentWindowId, false, x11.eventMask[ev.name], {});
  }
}

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

    logToFile(wmLogFilePath, "Getting PROPERTY", LogLevel.DEBUG);
    GetPropertyAsync = promisify(X.GetProperty).bind(X);

    X.ChangeWindowAttributes(
      root,
      {
        eventMask: x11.eventMask.SubstructureNotify,
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
      // logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
      // logToFile(wmLogFilePath, ev.name.toString(), LogLevel.DEBUG);
      const { type } = ev;
      switch (type) {
        case X11_EVENT_TYPE.KeyPress:
          onKeyPress(ev as IXKeyEvent);
          forwardKeyPress(ev);
          break;
        case X11_EVENT_TYPE.KeyRelease:
          break;
        case X11_EVENT_TYPE.ButtonPress:
          logToFile(
            wmLogFilePath,
            "Current mouse click window:" + currentWindowId.toString(),
            LogLevel.DEBUG
          );
          // Set focus to the clicked window
          X.SetInputFocus(PointerRoot, XFocusRevertTo.PointerRoot);
          forwardButtonPress(ev);
          break;
        case X11_EVENT_TYPE.ButtonRelease:
          break;
        case X11_EVENT_TYPE.MotionNotify:
          break;
        case X11_EVENT_TYPE.EnterNotify:
          break;
        case X11_EVENT_TYPE.LeaveNotify:
          break;
        case X11_EVENT_TYPE.FocusIn:
          // logToFile(wmLogFilePath, ev.format.toString, LogLevel.DEBUG);
          logToFile(
            wmLogFilePath,
            "Focusing...focusing....⭐" + currentWindowId.toString(),
            LogLevel.DEBUG
          );
          // Update currentWindowId when a window gains focus
          currentWindowId = ev.wid;
          break;
        case X11_EVENT_TYPE.FocusOut:
          // Try to set currentWindowId to a reasonable fallback
          if (openedWindows.size === 0) {
            currentWindowId = null;
          } else {
            currentWindowId = Array.from(openedWindows).pop() || null; // Last opened or focused window
          }
          break;
        case X11_EVENT_TYPE.Expose:
          break;
        case X11_EVENT_TYPE.CreateNotify:
          if (!openedWindows.has(ev.wid)) {
            openApp(ev.wid, splitDirection, currentWindowId);
            currentWindowId = ev.wid;
          } else if (ev.wid === launcherWid) {
            logToFile(wmLogFilePath, "A LAUNCH BOX? FOR LAUNCH!🐶");
          } else {
            logToFile(
              wmLogFilePath,
              "Open a new window? No thanks, I already got one 🧽",
              LogLevel.INFO
            );
          }
          break;
        case X11_EVENT_TYPE.DestroyNotify:
          openedWindows.delete(ev.wid);
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
          logToFile(wmLogFilePath, JSON.stringify(ev));
          // X.SendEvent(ev.wid, true, ev.message_type, ev.name);
          break;
        case X11_EVENT_TYPE.PropertyNotify:
          break;
        default:
          break;
      }
    });

    // Forward a KeyPress event to the currently focused window
    const forwardKeyPress = (keyEvent: any) => {
      if (currentWindowId === null) return;

      const destination = currentWindowId;
      const propagate = false; // Replace with your desired value
      const eventMask = keyEvent.event_mask || 0; // Replace with your desired mask
      const eventRawData = keyEvent.rawData;

      X.SendEvent(destination, propagate, eventMask, eventRawData);
    };

    // Forward a ButtonPress event to the clicked window
    const forwardButtonPress = (buttonEvent: any) => {
      const destination = buttonEvent.wid;
      const propagate = false; // Replace with your desired value
      const eventMask = buttonEvent.event_mask || 0; // Replace with your desired mask
      const eventRawData = buttonEvent.rawData;

      X.SendEvent(destination, propagate, eventMask, eventRawData);
    };

    client.on("event", async (ev: IXEvent) => {
      logToFile(wmLogFilePath, ev.name.toString(), LogLevel.DEBUG);
      logToFile(wmLogFilePath, ev.name.toString(), LogLevel.DEBUG);
      // Handle window closing - this is a simplification
      if (ev.name === "DestroyNotify") {
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
  //launcherWindow.close();
  //launcherWindow = null;

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

const openLauncher = () => {
  if (launcherInited) {
    launcherWindow.show();
    return;
  }
  launcherInited = true;
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

  /* 
    Reparent Electron container into x11 window container
    TODO: Wrap this into new function
  */
  // Desktop should be root in almost every situation
  //X.ReparentWindow(launcherWid, desktopWid, x, y);
  //X.MapWindow(launcherWid);
  logToFile(wmLogFilePath, launcherWid.toString(), LogLevel.DEBUG);
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
