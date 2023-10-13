import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, XClient, createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig, FyrWindow, SplitDirection } from "./types/FyrTypes";
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
  IXScreen,
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
let currentResizableWindow: FyrWindow = null;
let screen: IXScreen = null;
let GetPropertyAsync: (...args) => Promise<any>;
let splitDirection = SplitDirection.Horizontal;
let launcherWid: number = null;
let launcherWindow: BrowserWindow = null;
let launcherInited: boolean = false;
let allOpenedFyrWindows: Set<FyrWindow> = new Set();

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

const setCurrentResizableWindow = (
  windowId: number,
  width: number,
  height: number,
  x: number,
  y: number,
  horizontalParentId: number,
  verticalParentId: number,
  horizontalChildId,
  verticalChildId,
  lastSplitType: SplitDirection
) => {
  if (windowId === launcherWid) return;
  currentResizableWindow = {
    windowId,
    width,
    height,
    x,
    y,
    horizontalParentId,
    verticalParentId,
    horizontalChildId,
    verticalChildId,
    lastSplitType,
  };
};

const deleteFyrWin = (wid: number) => {
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === wid) {
      allOpenedFyrWindows.delete(win);
      return;
    }
  });
};

const addFyrWind = (fyrWin: FyrWindow) => {
  if (fyrWin.windowId === launcherWid) return;
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === fyrWin.windowId) {
      allOpenedFyrWindows.delete(win);
    }
  });
  allOpenedFyrWindows.add(fyrWin);
};

const openApp = (
  appWid: number,
  splitDirection: number,
  currentWindowId?: number
): Promise<void> => {
  logToFile(
    wmLogFilePath,
    "currentwindowid:" + currentWindowId,
    LogLevel.ERROR
  );
  logToFile(wmLogFilePath, "launcher id:" + launcherWid, LogLevel.ERROR);

  if (launcherWid === appWid) {
    X.MapWindow(appWid);
    return;
  }

  if (!openedWindows.has(appWid)) openedWindows.add(appWid);

  if (openedWindows.size === 1) {
    X.ResizeWindow(appWid, screen.pixel_width, screen.pixel_height);
    X.ReparentWindow(appWid, root, 0, 0);
    X.MapWindow(appWid);
    X.ChangeWindowAttributes(
      appWid,
      {
        eventMask:
          x11.eventMask.StructureNotify |
          x11.eventMask.EnterWindow |
          x11.eventMask.LeaveWindow |
          x11.eventMask.KeyPress |
          x11.eventMask.KeyRelease |
          x11.eventMask.FocusChange |
          x11.eventMask.Exposure,
      },
      (err) => {
        logToFile(wmLogFilePath, JSON.stringify(err), LogLevel.ERROR);
      }
    );
    // X.SetInputFocus(appWid, XFocusRevertTo.PointerRoot);
    setCurrentResizableWindow(
      appWid,
      screen.pixel_width,
      screen.pixel_height,
      0,
      0,
      null,
      null,
      null,
      null,
      null
    );

    // First window has no pair, will be updated on next app open
    addFyrWind({
      windowId: appWid,
      width: screen.pixel_width,
      height: screen.pixel_height,
      x: 0,
      y: 0,
      horizontalParentId: null,
      verticalParentId: null,
      horizontalChildId: null,
      verticalChildId: null,
      lastSplitType: null,
    });

    return;
  } else {
    if (
      splitDirection === SplitDirection.Horizontal &&
      currentResizableWindow
    ) {
      // If horizonal selected, cut current window in half
      const newWidth = currentResizableWindow.width / 2;
      const newX = currentResizableWindow.x + newWidth;
      X.ResizeWindow(
        currentResizableWindow.windowId,
        newWidth,
        currentResizableWindow.height
      );
      X.MapWindow(currentResizableWindow.windowId);

      // Resize incoming window and map window
      X.ResizeWindow(appWid, newWidth, currentResizableWindow.height);
      X.ReparentWindow(appWid, root, newX, currentResizableWindow.y);
      X.MapWindow(appWid);

      if (currentResizableWindow.horizontalChildId) {
        const newChild = findCurrentWindow(
          currentResizableWindow.horizontalChildId
        );
        deleteFyrWin(newChild.horizontalChildId);
        addFyrWind({
          ...newChild,
          horizontalParentId: appWid,
        });
      }

      // Track new window with "parent" window id
      addFyrWind({
        windowId: appWid,
        width: newWidth,
        height: currentResizableWindow.height,
        x: newX,
        y: currentResizableWindow.y,
        horizontalParentId: currentResizableWindow.windowId,
        verticalParentId: null,
        horizontalChildId: currentResizableWindow.horizontalChildId
          ? currentResizableWindow.horizontalChildId
          : null,
        verticalChildId: null,
        lastSplitType: null,
      });

      // Modify existing window
      deleteFyrWin(currentResizableWindow.windowId);
      addFyrWind({
        ...currentResizableWindow,
        width: newWidth,
        // Last split type tracked in parent for resizing children on destroy
        lastSplitType: SplitDirection.Horizontal,
        horizontalChildId: appWid,
      });

      X.ChangeWindowAttributes(
        appWid,
        {
          eventMask:
            x11.eventMask.StructureNotify |
            x11.eventMask.EnterWindow |
            x11.eventMask.LeaveWindow |
            x11.eventMask.KeyPress |
            x11.eventMask.KeyRelease |
            x11.eventMask.FocusChange |
            x11.eventMask.Exposure,
        },
        (err) => {
          logToFile(wmLogFilePath, JSON.stringify(err), LogLevel.ERROR);
        }
      );

      setCurrentResizableWindow(
        appWid,
        newWidth,
        currentResizableWindow.height,
        newX,
        currentResizableWindow.y,
        currentResizableWindow.windowId,
        null,
        null,
        null,
        null
      );

      return;
    } else if (splitDirection === SplitDirection.Vertical) {
      // Cut in half
      const newHeight = currentResizableWindow.height / 2;
      const newY = currentResizableWindow.y + newHeight;
      X.ResizeWindow(
        currentResizableWindow.windowId,
        currentResizableWindow.width,
        newHeight
      );
      X.MapWindow(currentResizableWindow.windowId);

      // Resize incoming window and map window
      X.ResizeWindow(appWid, currentResizableWindow.width, newHeight);
      X.ReparentWindow(appWid, root, currentResizableWindow.x, newY);
      X.MapWindow(appWid);

      if (currentResizableWindow.verticalChildId) {
        const newChild = findCurrentWindow(
          currentResizableWindow.verticalChildId
        );
        deleteFyrWin(newChild.verticalChildId);
        addFyrWind({
          ...newChild,
          horizontalParentId: appWid,
        });
      }

      // Track new window
      addFyrWind({
        windowId: appWid,
        width: currentResizableWindow.width,
        height: newHeight,
        x: currentResizableWindow.x,
        y: newY,
        verticalParentId: currentResizableWindow.windowId,
        horizontalParentId: null,
        horizontalChildId: null,
        verticalChildId: null,
        lastSplitType: null,
      });

      // Modify existing window
      deleteFyrWin(currentResizableWindow.windowId);
      addFyrWind({
        ...currentResizableWindow,
        height: newHeight,
        lastSplitType: SplitDirection.Vertical,
        verticalChildId: appWid,
      });

      X.ChangeWindowAttributes(
        appWid,
        {
          eventMask:
            x11.eventMask.StructureNotify |
            x11.eventMask.EnterWindow |
            x11.eventMask.LeaveWindow |
            x11.eventMask.KeyPress |
            x11.eventMask.KeyRelease |
            x11.eventMask.FocusChange |
            x11.eventMask.Exposure,
        },
        (err) => {
          logToFile(wmLogFilePath, JSON.stringify(err), LogLevel.ERROR);
        }
      );

      // Update current selected window for next resize
      setCurrentResizableWindow(
        appWid,
        currentResizableWindow.width,
        newHeight,
        currentResizableWindow.x,
        newY,
        null,
        currentResizableWindow.windowId,
        null,
        null,
        null
      );
      return;
    }
    X.MapWindow(appWid);
    return;
  }
};

const findParent = (wid: number, splitType: SplitDirection): FyrWindow => {
  let fyrWin;
  allOpenedFyrWindows.forEach((win) => {
    if (splitType === SplitDirection.Horizontal) {
      if (win.horizontalChildId === wid) {
        fyrWin = win;
      }
    } else if (splitType === SplitDirection.Vertical) {
      if (win.verticalChildId === wid) {
        fyrWin = win;
      }
    }
  });
  return fyrWin;
};

const resizeAndMapFyrWindow = (fyrWin: FyrWindow) => {
  logToFile(
    wmLogFilePath,
    "RESIZE AND MAP: " + JSON.stringify(fyrWin),
    LogLevel.ERROR
  );
  // Resize, reparent, remap
  X.ResizeWindow(fyrWin.windowId, fyrWin.width, fyrWin.height);
  X.ReparentWindow(fyrWin.windowId, root, fyrWin.x, fyrWin.y);
  X.MapWindow(fyrWin.windowId);
};

const updateParentChildren = (
  parentWid: number,
  childId: number,
  splitType: SplitDirection
) => {
  logToFile(wmLogFilePath, "UPDATING PARENT CHILDREN");
  let fyrWin: FyrWindow;
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === parentWid) {
      fyrWin = win;
      allOpenedFyrWindows.delete(win);
    }
  });
  if (fyrWin) {
    allOpenedFyrWindows.add({
      ...fyrWin,
      horizontalChildId:
        splitType === SplitDirection.Horizontal
          ? childId
          : fyrWin.horizontalChildId,
      verticalChildId:
        splitType === SplitDirection.Vertical
          ? childId
          : fyrWin.verticalChildId,
    });
  }
};

const updateChildParents = (
  childId: number,
  parentId: number,
  splitType: SplitDirection
) => {
  logToFile(wmLogFilePath, "UPDATING CHILD PARENTS", LogLevel.ERROR);
  let fyrWin: FyrWindow;
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === childId) {
      fyrWin = win;
      allOpenedFyrWindows.delete(win);
    }
  });
  if (fyrWin) {
    allOpenedFyrWindows.add({
      ...fyrWin,
      horizontalParentId:
        splitType === SplitDirection.Horizontal
          ? parentId
          : fyrWin.horizontalParentId,
      verticalParentId:
        splitType === SplitDirection.Vertical
          ? parentId
          : fyrWin.verticalParentId,
    });
  }
};

const resizeAdjacentWindows = (
  parentWindow: FyrWindow,
  direction: SplitDirection
) => {
  logToFile(
    wmLogFilePath,
    "WINDOW DELETED IS: " + JSON.stringify(parentWindow),
    LogLevel.DEBUG
  );
  // If no children, resize parent
  if (
    (parentWindow.horizontalParentId || parentWindow.verticalParentId) &&
    ((!parentWindow.horizontalChildId &&
      parentWindow.lastSplitType === SplitDirection.Horizontal) ||
      (!parentWindow.verticalChildId &&
        parentWindow.lastSplitType === SplitDirection.Vertical))
  ) {
    logToFile(
      wmLogFilePath,
      "Resizing parent after window deletion",
      LogLevel.DEBUG
    );
    let grandParentWindow: FyrWindow;
    grandParentWindow = Array.from(allOpenedFyrWindows).find(
      (win) => win.windowId === parentWindow.verticalParentId
    );
    if (!grandParentWindow) {
      grandParentWindow = Array.from(allOpenedFyrWindows).find(
        (win) => win.windowId === parentWindow.horizontalChildId
      );
    }
    // If no grandParent, all windows are now closed
    if (!grandParentWindow) {
      logToFile(wmLogFilePath, "No window to resize", LogLevel.DEBUG);
    }

    if (parentWindow.horizontalParentId === grandParentWindow.windowId) {
      logToFile(wmLogFilePath, "RESIZING PARENT HORIZONTAL", LogLevel.DEBUG);
      //resize horizontal
      const newFyrWin: FyrWindow = {
        ...grandParentWindow,
        width: grandParentWindow.width + parentWindow.width,
        horizontalChildId: null,
      };
      deleteFyrWin(grandParentWindow.windowId);
      addFyrWind(newFyrWin);
      resizeAndMapFyrWindow(newFyrWin);
      return;
    } else if (
      parentWindow.verticalParentId === grandParentWindow.verticalChildId
    ) {
      //resize vertical parent
      const newFyrWin: FyrWindow = {
        ...grandParentWindow,
        height: grandParentWindow.height + parentWindow.height,
        verticalChildId: null,
      };
      deleteFyrWin(grandParentWindow.windowId);
      addFyrWind(newFyrWin);
      resizeAndMapFyrWindow(newFyrWin);
      return;
    }
  }

  // If children
  allOpenedFyrWindows.forEach((fyrWin) => {
    if (direction === SplitDirection.Vertical) {
      logToFile(
        wmLogFilePath,
        "Resizing vertical children after window deletion",
        LogLevel.DEBUG
      );
      // If child top is on bottom border
      if (parentWindow.y + parentWindow.height === fyrWin.y) {
        // If bordering child is within the width of the current container
        if (
          fyrWin.x >= parentWindow.x &&
          fyrWin.width + fyrWin.x <= parentWindow.x + parentWindow.width
        ) {
          logToFile(wmLogFilePath, "CONDITION 2 MATCHED", LogLevel.ERROR);
          //Resize window
          const newFyrWin: FyrWindow = {
            ...fyrWin,
            height: fyrWin.height + parentWindow.height,
            y: parentWindow.y,
            horizontalParentId: parentWindow.horizontalParentId,
            verticalParentId: parentWindow.verticalParentId,
          };
          deleteFyrWin(fyrWin.windowId);
          addFyrWind(newFyrWin);
          logToFile(wmLogFilePath, "NEW FYR WIN", LogLevel.ERROR);

          for (const win of [
            findCurrentWindow(parentWindow.verticalParentId),
            findCurrentWindow(parentWindow.horizontalParentId),
          ]) {
            if (win) {
              if (win.windowId === parentWindow.verticalParentId) {
                const grandParentWind: FyrWindow = {
                  ...win,
                  verticalChildId: newFyrWin.windowId,
                };
                deleteFyrWin(win.windowId);
                addFyrWind(grandParentWind);
              } else if (win.windowId === parentWindow.horizontalParentId) {
                const grandParentWind: FyrWindow = {
                  ...win,
                  horizontalChildId: newFyrWin.windowId,
                };
                deleteFyrWin(win.windowId);
                addFyrWind(grandParentWind);
              }
            }
          }

          resizeAndMapFyrWindow(newFyrWin);
        }
      }
    } else if (direction === SplitDirection.Horizontal) {
      logToFile(
        wmLogFilePath,
        "Resizing horizontal child after window deletion",
        LogLevel.DEBUG
      );
      if (parentWindow.x + parentWindow.width === fyrWin.x) {
        if (
          fyrWin.y >= parentWindow.y &&
          fyrWin.height + fyrWin.y <= parentWindow.height + parentWindow.y
        ) {
          //Resize window
          const newFyrWin: FyrWindow = {
            ...fyrWin,
            width: fyrWin.width + parentWindow.width,
            x: parentWindow.x,
            horizontalParentId: parentWindow.horizontalParentId,
            verticalParentId: parentWindow.verticalParentId,
          };
          deleteFyrWin(fyrWin.windowId);
          addFyrWind(newFyrWin);
          logToFile(wmLogFilePath, "NEW FYR WIN", LogLevel.ERROR);

          for (const win of [
            findCurrentWindow(parentWindow.verticalParentId),
            findCurrentWindow(parentWindow.horizontalParentId),
          ]) {
            if (win) {
              if (win.windowId === parentWindow.verticalParentId) {
                const grandParentWind: FyrWindow = {
                  ...win,
                  verticalChildId: newFyrWin.windowId,
                };
                deleteFyrWin(win.windowId);
                addFyrWind(grandParentWind);
              } else if (win.windowId === parentWindow.horizontalParentId) {
                const grandParentWind: FyrWindow = {
                  ...win,
                  horizontalChildId: newFyrWin.windowId,
                };
                deleteFyrWin(win.windowId);
                addFyrWind(grandParentWind);
              }
            }
          }

          resizeAndMapFyrWindow(newFyrWin);
        }
      }
    }
  });
};

const handleDestroyNotify = (wid: number) => {
  // Get window to delete and resize all windows
  let windowToDelete: FyrWindow = Array.from(allOpenedFyrWindows).find(
    (win) => win.windowId === wid
  );
  logToFile(wmLogFilePath, "DELETING WINDOW", LogLevel.ERROR);
  deleteFyrWin(wid);
  resizeAdjacentWindows(windowToDelete, windowToDelete.lastSplitType);
};

const findCurrentWindow = (wid: number): FyrWindow => {
  let foundWindow: FyrWindow = null;
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === wid) {
      logToFile(
        wmLogFilePath,
        "OPENED: " + JSON.stringify(win),
        LogLevel.ERROR
      );
      foundWindow = win;
    }
  });
  return foundWindow;
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
          x11.eventMask.SubstructureNotify |
          x11.eventMask.SubstructureRedirect |
          x11.eventMask.ButtonPress |
          x11.eventMask.ButtonRelease,
      },
      (err) => {
        logToFile(
          wmLogFilePath,
          "Couldn't change event mask :(",
          LogLevel.ERROR
        );
      }
    );

    X.on("event", (ev) => {
      logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.ERROR);
    });

    // Capture keyboard, mouse, and window events
    client.on("event", async (ev: IXEvent) => {
      logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
      const { type } = ev;
      switch (type) {
        case X11_EVENT_TYPE.KeyPress:
          logToFile(wmLogFilePath, "KEY PRESSED", LogLevel.DEBUG);
          logToFile(
            wmLogFilePath,
            "CURRENT WINDOW:" + JSON.stringify(findCurrentWindow(ev.wid)),
            LogLevel.DEBUG
          );
          if (ev.wid === launcherWid) return;
          const focusedWindow =
            ev.wid && ev.wid !== launcherWid ? findCurrentWindow(ev.wid) : null;
          currentWindowId =
            ev.wid && ev.wid !== launcherWid ? ev.wid : currentWindowId;
          currentResizableWindow =
            ev.wid !== launcherWid && focusedWindow
              ? focusedWindow
              : currentResizableWindow;
          // X.SendEvent(ev.wid, false, x11.eventMask.KeyPress, ev.rawData);
          break;
        case X11_EVENT_TYPE.KeyRelease:
          logToFile(wmLogFilePath, "KEY RELEASED", LogLevel.DEBUG);
          // X.SendEvent(ev.wid, false, x11.eventMask.KeyRelease, ev.rawData);
          break;
        case X11_EVENT_TYPE.ButtonPress:
          // Set focus to the clicked window
          // X.SetInputFocus(ev.wid, XFocusRevertTo.PointerRoot);

          // X.ConfigureWindow(ev.wid, { stackMode: 0 });
          // currentResizableWindow = findCurrentWindow(ev.wid);
          // X.SendEvent(ev.wid, false, x11.eventMask.ButtonPress, ev.rawData);
          logToFile(wmLogFilePath, "BUTTON PRESSED", LogLevel.DEBUG);
          logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
          break;
        case X11_EVENT_TYPE.ButtonRelease:
          logToFile(wmLogFilePath, "BUTTON RELEASED", LogLevel.DEBUG);
          // X.SendEvent(PointerRoot, true, x11.eventMask.ButtonRelease, ev.rawData);
          break;
        case X11_EVENT_TYPE.MotionNotify:
          break;
        case X11_EVENT_TYPE.EnterNotify:
          logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.ERROR);
          // if (
          //   X.GetInputFocus().focus !== ev.wid &&
          //   ev.wid &&
          //   ev.wid !== launcherWid
          // ) {
          //   X.SetInputFocus(ev.wid, XFocusRevertTo.PointerRoot);
          // } else if (!ev.wid) {
          //   X.SetInputFocus(root, XFocusRevertTo.PointerRoot);
          // }
          break;
        case X11_EVENT_TYPE.LeaveNotify:
          break;
        // case X11_EVENT_TYPE.FocusIn:
        //   // Update currentWindowId when a window gains focus
        //   logToFile(wmLogFilePath, "FOCUS IN", LogLevel.DEBUG);
        //   currentWindowId = ev.wid;
        //   currentResizableWindow = findCurrentWindow(ev.wid);
        //   logToFile(wmLogFilePath, ev.name, LogLevel.ERROR);
        //   break;
        // case X11_EVENT_TYPE.FocusOut:
        //   // Try to set currentWindowId to a reasonable fallback
        //   logToFile(wmLogFilePath, "FOCUS OUT", LogLevel.DEBUG);
        //   if (openedWindows.size === 0) {
        //     currenrtWindowId = null;
        //   } else {
        //     currentWindowId = Array.from(openedWindows).pop() || null;
        //   }
        //   break;
        case X11_EVENT_TYPE.Expose:
          break;
        case X11_EVENT_TYPE.CreateNotify:
          //currentWindowId = ev.wid;
          break;
        case X11_EVENT_TYPE.MapRequest:
          openApp(ev.wid, splitDirection, currentWindowId);
          currentWindowId = ev.wid !== launcherWid ? ev.wid : currentWindowId;
          break;
        case X11_EVENT_TYPE.DestroyNotify:
          //TODO: Resize here as well (Maybe look for items with no height/width/x/y matches?)
          logToFile(wmLogFilePath, JSON.stringify(ev.name), LogLevel.ERROR);
          if (openedWindows.has(ev.wid)) {
            openedWindows.delete(ev.wid);
          }

          handleDestroyNotify(ev.wid);

          if (currentWindowId === ev.wid) {
            if (openedWindows.size === 0) {
              currentWindowId = null;
              currentResizableWindow = null;
            } else {
              // Last opened or focused window
              currentWindowId = Array.from(openedWindows).pop() || null;
              currentResizableWindow = findCurrentWindow(currentWindowId);
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

  const closeAppShortcut = globalShortcut.register("Super+Q", () => {
    if (currentResizableWindow) {
      X.DestroyWindow(currentResizableWindow.windowId);
    }
  });
  if (!closeAppShortcut) {
    logToFile(
      wmLogFilePath,
      "You can check out any time you like, but you can never leave..",
      LogLevel.ERROR
    );
  }

  // Exit wm
  const closeWMShortcut = globalShortcut.register("Ctrl+Shift+Q", () => {
    app.quit();
  });
  if (!closeWMShortcut) {
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
  // X.SetInputFocus(launcherWid, XFocusRevertTo.PointerRoot);
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
