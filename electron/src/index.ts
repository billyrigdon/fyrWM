import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { XDisplay, createClient } from "x11";
import ini from "ini";
import fs from "fs";
import path, { join } from "path";
import { FyrConfig, FyrWindow, SplitDirection } from "./types/FyrTypes";
import { logToFile, LogLevel, homedir, exec } from "./lib/utils";
import { defaultFyrConfig } from "./lib/config";
import {
  IX11Client,
  IX11Mod,
  IXClient,
  IXEvent,
  IXScreen,
  X11_EVENT_TYPE,
  XFocusRevertTo,
  XPropMode,
} from "./types/X11Types";
const x11: IX11Mod = require("x11");

// Globals
const wmLogFilePath = join(homedir(), ".fyr", "logs", "wm.log");
let X: IXClient;
let client: IX11Client;
let root: number;
let currentWindowId: number | null = null;
let currentResizableWindow: FyrWindow = null;
let screen: IXScreen = null;
let GetPropertyAsync: (...args) => Promise<any>;
let splitDirection = SplitDirection.Horizontal;
let launcherWid: number = null;
let launcherWindow: BrowserWindow = null;
let launcherInited: boolean = false;
let allOpenedFyrWindows: Set<FyrWindow> = new Set();
let wmClassAtom;
let stringAtom;
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
const setWallpaper = () => {
  const wallpaperPath = config.customizations.wallpaperPath;
  const command = `feh --bg-scale ${wallpaperPath}`;

  exec(command, (error) => {
    if (error) {
    } else {
      logToFile(wmLogFilePath, "Failed to set wallpaper", LogLevel.ERROR);
    }
  });
};

const setXRootCursor = (): void => {
  const command = `xsetroot -cursor_name arrow`;
  exec(command, (err) => {
    logToFile(wmLogFilePath, "Failed to set cursor", LogLevel.ERROR);
  });
};

// Needs picom installed, set window class to electronTransparent for a fully transparent window.
const initCompositing = (): void => {
  const command = `picom -b --config ~/.config/picom/picom.conf`;
  exec(command, (err) => {
    logToFile(
      wmLogFilePath,
      "Failed to initialize compositor" + err,
      LogLevel.ERROR
    );
  });
};

const initDesktop = async (display: XDisplay): Promise<number> => {
  screen = display.screen[0];
  root = screen.root;
  X.MapWindow(root);
  setWallpaper();
  setXRootCursor();
  return root;
};

const isTopLevelApplication = async (windowId: number): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    // Query the tree structure from the parent window to children
    X.QueryTree(windowId, (err, tree) => {
      if (err) {
        reject(err);
        return;
      }
      // If the parent of the window is the root window, it's a top-level window
      if (tree.parent === root) {
        // Further checks can be added here, such as checking window attributes for override-redirect flag
        X.GetWindowAttributes(windowId, (err, attrs) => {
          if (err) {
            reject(err);
            return;
          }
          // Make sure the window is not an override-redirect window (like a tooltip or a menu)
          if (!attrs.overrideRedirect) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
  });
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

  if (!isTopLevelApplication(windowId)) return;

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

const openApp = async (
  appWid: number,
  splitDirection: number,
  currentWindowId?: number
): Promise<void> => {
  if (launcherWid === appWid) {
    X.MapWindow(appWid);
    return;
  }

  logToFile(
    wmLogFilePath,
    "NOT THE LAUNCHER: " + JSON.stringify(currentResizableWindow),
    LogLevel.ERROR
  );

  const shouldRender = await isTopLevelApplication(appWid);

  if (!shouldRender) return;

  if (!openedWindows.has(appWid)) openedWindows.add(appWid);

  if (openedWindows.size === 1) {
    // Gap
    X.ResizeWindow(appWid, screen.pixel_width - 10, screen.pixel_height - 10);
    // X.ReparentWindow(appWid, root, 5, 5);
    X.MoveWindow(appWid, 5, 5);
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
      screen.pixel_width - 10,
      screen.pixel_height - 10,
      5,
      5,
      null,
      null,
      null,
      null,
      null
    );

    // First window has no pair, will be updated on next app open
    addFyrWind({
      windowId: appWid,
      width: screen.pixel_width - 10,
      height: screen.pixel_height - 10,
      x: 5,
      y: 5,
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
      const newWidth = (currentResizableWindow.width - 5) / 2;
      const newX = currentResizableWindow.x + newWidth + 5;
      X.ResizeWindow(
        currentResizableWindow.windowId,
        newWidth,
        currentResizableWindow.height
      );
      X.MapWindow(currentResizableWindow.windowId);

      // Resize incoming window and map window
      X.ResizeWindow(appWid, newWidth, currentResizableWindow.height);
      X.MoveWindow(appWid, newX, currentResizableWindow.y);
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
      const newHeight = (currentResizableWindow.height - 5) / 2;
      const newY = currentResizableWindow.y + newHeight + 5;
      X.ResizeWindow(
        currentResizableWindow.windowId,
        currentResizableWindow.width,
        newHeight
      );
      X.MapWindow(currentResizableWindow.windowId);

      // Resize incoming window and map window
      X.ResizeWindow(appWid, currentResizableWindow.width, newHeight);
      X.MoveWindow(appWid, currentResizableWindow.x, newY);
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

/*
  One side for windows with children will always match perfectly to 
  the children's sum w/h due to constraints so we need to find which 
  child(ren) matches the best and track them
*/
const findBestChildrenMatch = (
  parentWindow: FyrWindow
): [Array<FyrWindow>, SplitDirection] => {
  let vertChildrenWidth = 0;
  let vertChildren: Array<FyrWindow> = [];

  let horizChildrenHeight = 0;
  let horizChildren: Array<FyrWindow> = [];

  for (const win of Array.from(allOpenedFyrWindows)) {
    // First check for direct children with similar dimensions, easiest route
    if (
      win.windowId === parentWindow.horizontalChildId &&
      win.y === parentWindow.y &&
      win.height === parentWindow.height
    ) {
      return [[win], SplitDirection.Horizontal];
    }

    if (
      win.windowId === parentWindow.verticalChildId &&
      win.x === parentWindow.x &&
      win.width === parentWindow.width
    ) {
      return [[win], SplitDirection.Vertical];
    }

    // If there's a failure in finding an exact child match, find all bordering children

    // Children sharing a vertical border
    logToFile(wmLogFilePath, JSON.stringify(win), LogLevel.ERROR);
    if (
      win.y === parentWindow.y + parentWindow.height + 5 ||
      win.y === parentWindow.y + parentWindow.height
    ) {
      logToFile(wmLogFilePath, "VERTICAL CHILD BORDER", LogLevel.ERROR);
      // If within the parents width:
      if (
        win.x >= parentWindow.x &&
        win.x + win.width <= parentWindow.x + parentWindow.width + 5
      ) {
        // Add widths and track children in case this side matches, account for margin
        vertChildrenWidth += win.width;
        vertChildren = vertChildren.concat([win]);
        if (vertChildren.length >= 2) {
          vertChildrenWidth += 5;
        }
      }
    }

    //Sharing a horizontal border
    if (
      win.x === parentWindow.x + parentWindow.width + 5 ||
      win.x === parentWindow.x + parentWindow.width
    ) {
      logToFile(wmLogFilePath, "HORIZONTAL CHILD BORDER", LogLevel.ERROR);
      logToFile(
        wmLogFilePath,
        "HORIZONTAL CHILD" + JSON.stringify(win),
        LogLevel.INFO
      );
      logToFile(wmLogFilePath, (win.y + win.height).toString(), LogLevel.INFO);
      logToFile(
        wmLogFilePath,
        (parentWindow.y + parentWindow.height).toString(),
        LogLevel.INFO
      );
      if (
        win.y >= parentWindow.y &&
        win.y + win.height <= parentWindow.height + parentWindow.y + 10
      ) {
        logToFile(
          wmLogFilePath,
          "HORIZONTAL CHILD CONDITIONS MET",
          LogLevel.INFO
        );
        horizChildrenHeight += win.height;
        horizChildren = horizChildren.concat([win]);
        if (horizChildren.length >= 2) {
          horizChildrenHeight += 5;
        }
      }
    }
  }

  logToFile(wmLogFilePath, JSON.stringify(vertChildrenWidth), LogLevel.ERROR);
  // logToFile(wmLogFilePath, JSON.stringify(), LogLevel.ERROR);
  logToFile(wmLogFilePath, JSON.stringify(parentWindow), LogLevel.ERROR);

  if (vertChildrenWidth === parentWindow.width) {
    return [vertChildren, SplitDirection.Vertical];
  } else if (horizChildrenHeight === parentWindow.height) {
    return [horizChildren, SplitDirection.Horizontal];
  } else {
    logToFile(wmLogFilePath, "COULDNT RESIZE CHILDREN", LogLevel.INFO);
    return [[], null];
  }
};

// Same as children, one parenting side should match perfectly.
const findBestParentMatch = (
  childWindow: FyrWindow
): [Array<FyrWindow>, SplitDirection] => {
  let vertParentWidth = 0;
  let vertParents: Array<FyrWindow> = [];
  let horizParentHeight = 0;
  let horizParents: Array<FyrWindow> = [];

  allOpenedFyrWindows.forEach((parentWindow) => {
    // First look for direct parent exact matches
    if (parentWindow.windowId === childWindow.horizontalParentId) {
      return [[parentWindow], SplitDirection.Horizontal];
    }
    if (parentWindow.windowId === childWindow.verticalParentId) {
      return [[parentWindow], SplitDirection.Vertical];
    }

    // Find adjacent parent windows if not successful
    if (parentWindow.windowId !== childWindow.windowId) {
      if (parentWindow.y + parentWindow.height + 5 === childWindow.y) {
        // Parents sharing a vertical border
        if (
          parentWindow.x + parentWindow.width >= childWindow.x &&
          parentWindow.x + parentWindow.width <=
            childWindow.x + childWindow.width
        ) {
          vertParentWidth += parentWindow.width;
          vertParents = vertParents.concat([parentWindow]);
        }
      }

      if (parentWindow.x + parentWindow.width + 5 === childWindow.x) {
        logToFile(
          wmLogFilePath,
          "FIRST HORIZ PARENT CONDITION MET",
          LogLevel.ERROR
        );
        logToFile(
          wmLogFilePath,
          "HORIZ PARENT:" + JSON.stringify(parentWindow),
          LogLevel.ERROR
        );
        logToFile(
          wmLogFilePath,
          "HORIZ CHILD:" + JSON.stringify(childWindow),
          LogLevel.ERROR
        );
        if (
          parentWindow.y + parentWindow.height >= childWindow.y &&
          parentWindow.y + parentWindow.height <=
            childWindow.y + childWindow.height
        ) {
          logToFile(
            wmLogFilePath,
            "SECOND HORIZ PARENT CONDITION MET",
            LogLevel.ERROR
          );
          horizParentHeight += parentWindow.height;
          horizParents = horizParents.concat([parentWindow]);
        }
      }
    }
  });

  if (vertParentWidth === childWindow.width) {
    return [vertParents, SplitDirection.Vertical];
  } else if (horizParentHeight === childWindow.height) {
    return [horizParents, SplitDirection.Horizontal];
  } else {
    logToFile(wmLogFilePath, "COULDNT RESIZE PARENTS", LogLevel.INFO);
    return [[], null];
  }
};

const resizeRepositionReparentChildren = (
  parent: FyrWindow,
  children: Array<FyrWindow>,
  splitType: SplitDirection
): void => {
  let immediateVertChild: FyrWindow;
  let immediateHorzChild: FyrWindow;
  children.forEach((childWindow) => {
    // Get immediate child for reparenting
    if (parent.verticalChildId === childWindow.windowId) {
      immediateVertChild = childWindow;
    }

    if (parent.horizontalChildId === childWindow.windowId) {
      immediateHorzChild = childWindow;
    }

    if (splitType === SplitDirection.Horizontal) {
      const [width, height]: [number, number] = [
        childWindow.width + parent.width + 5,
        childWindow.height,
      ];
      const [x, y]: [number, number] = [parent.x, childWindow.y];
      deleteFyrWin(childWindow.windowId);
      addFyrWind({
        ...childWindow,
        width,
        x: parent.x,
      });
      X.ResizeWindow(childWindow.windowId, width, height);
      X.MoveWindow(childWindow.windowId, x, y);
    } else if (splitType === SplitDirection.Vertical) {
      const [width, height]: [number, number] = [
        childWindow.width,
        childWindow.height + parent.height + 5,
      ];
      const [x, y]: [number, number] = [childWindow.x, parent.y];
      deleteFyrWin(childWindow.windowId);
      addFyrWind({
        ...childWindow,
        height: childWindow.height + parent.height,
        y: parent.y,
      });
      X.ResizeWindow(childWindow.windowId, width, height);
      X.MoveWindow(childWindow.windowId, x, y);
    }
  });

  if (!immediateVertChild) {
    logToFile(
      wmLogFilePath,
      "RESIZED CHILDREN BUT NO IMMEDIATE VERTICAL CHILD FOUND",
      LogLevel.ERROR
    );
    return;
  }

  if (!immediateHorzChild) {
    logToFile(
      wmLogFilePath,
      "RESIZED CHILDREN BUT NO IMMEDIATE VERTICAL CHILD FOUND",
      LogLevel.ERROR
    );
    return;
  }

  if (immediateHorzChild.horizontalParentId === parent.windowId) {
    deleteFyrWin(immediateHorzChild.windowId);
    addFyrWind({
      ...immediateHorzChild,
      x: parent.x,
      width: immediateHorzChild.width + parent.width + 5,
      verticalParentId: parent.verticalParentId,
      horizontalParentId: parent.horizontalParentId,
    });
  } else if (immediateVertChild.verticalParentId === parent.windowId) {
    deleteFyrWin(immediateVertChild.windowId);
    addFyrWind({
      ...immediateVertChild,
      y: parent.y,
      height: immediateVertChild.height + parent.height + 5,
      verticalParentId: parent.verticalParentId,
      horizontalParentId: parent.horizontalParentId,
    });
  }

  // TODO: Should probably rename this function since it's been adapted for other uses
  const horizontalParent = findCurrentWindow(parent.horizontalParentId);
  const verticalParent = findCurrentWindow(parent.verticalParentId);

  if (horizontalParent) {
    deleteFyrWin(horizontalParent.windowId);
    addFyrWind({
      ...horizontalParent,
      horizontalChildId: immediateHorzChild.windowId,
    });
  }
  if (verticalParent) {
    deleteFyrWin(verticalParent.windowId);
    addFyrWind({
      ...verticalParent,
      verticalChildId: immediateVertChild.windowId,
    });
  }
};

const resizeRepositionRechildParents = (
  childWindow: FyrWindow,
  parents: Array<FyrWindow>,
  splitType: SplitDirection
): void => {
  let immediateHorzParent: FyrWindow;
  let immediateVertParent: FyrWindow;
  let width: number;
  let height: number;
  parents.forEach((parentWindow) => {
    if (parentWindow.horizontalChildId === childWindow.windowId) {
      immediateHorzParent = parentWindow;
    }

    if (parentWindow.verticalChildId === childWindow.windowId) {
      immediateVertParent = parentWindow;
    }
    if (splitType === SplitDirection.Horizontal) {
      width = parentWindow.width + childWindow.width + 5;
      deleteFyrWin(parentWindow.windowId);
      addFyrWind({
        ...parentWindow,
        width,
      });
      X.ResizeWindow(parentWindow.windowId, width, parentWindow.height);
    } else if (splitType === SplitDirection.Vertical) {
      height = parentWindow.height + childWindow.height + 5;
      deleteFyrWin(parentWindow.windowId);
      addFyrWind({
        ...parentWindow,
        height,
      });
      X.ResizeWindow(parentWindow.windowId, parentWindow.width, height);
    }
  });

  if (!immediateVertParent) {
    logToFile(
      wmLogFilePath,
      "COULDNT FIND IMMEDIATE VERT PARENT",
      LogLevel.ERROR
    );
    return;
  }

  if (!immediateHorzParent) {
    logToFile(
      wmLogFilePath,
      "COULDNT FIND IMMEDIATE HORZ PARENT",
      LogLevel.ERROR
    );
  }

  // Assign new grandchildren windows
  if (splitType === SplitDirection.Horizontal) {
    deleteFyrWin(immediateHorzParent.windowId);
    addFyrWind({
      ...immediateHorzParent,
      horizontalChildId: childWindow.horizontalChildId,
      width,
    });
  } else if (splitType === SplitDirection.Vertical) {
    deleteFyrWin(immediateVertParent.windowId);
    addFyrWind({
      ...immediateVertParent,
      verticalChildId: childWindow.verticalChildId,
      height,
    });
  }
};

const resizeOnDestroy = (winToDeleteId: number): void => {
  const deletedWindow = findCurrentWindow(winToDeleteId);
  // logToFile(wmLogFilePath, "DEleted wind" + JSON.stringify(de))
  deleteFyrWin(deletedWindow.windowId);

  if (deletedWindow.verticalChildId || deletedWindow.horizontalChildId) {
    const [childrenToResize, childSplitType] =
      findBestChildrenMatch(deletedWindow);
    logToFile(
      wmLogFilePath,
      JSON.stringify([...childrenToResize]),
      LogLevel.INFO
    );
    if (childrenToResize?.length > 0) {
      resizeRepositionReparentChildren(
        deletedWindow,
        childrenToResize,
        childSplitType
      );
      return;
    }
  }

  if (deletedWindow.horizontalParentId || deletedWindow.verticalParentId) {
    const [parentsToResize, parentSpltType] =
      findBestParentMatch(deletedWindow);
    if (parentsToResize?.length > 0) {
      resizeRepositionRechildParents(
        deletedWindow,
        parentsToResize,
        parentSpltType
      );
      return;
    }
  } else {
    logToFile(wmLogFilePath, "ERROR RESIZING", LogLevel.ERROR);
  }

  return;
};

const resizeAndMapFyrWindow = (fyrWin: FyrWindow) => {
  logToFile(
    wmLogFilePath,
    "RESIZE AND MAP: " + JSON.stringify(fyrWin),
    LogLevel.DEBUG
  );
  // Resize, remap
  X.ResizeWindow(fyrWin.windowId, fyrWin.width, fyrWin.height);
  X.MoveWindow(fyrWin.windowId, fyrWin.x, fyrWin.y);
  X.MapWindow(fyrWin.windowId);
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
    !parentWindow.horizontalChildId &&
    !parentWindow.verticalChildId
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
        (win) => win.windowId === parentWindow.horizontalParentId
      );
    }
    // If no grandParent, all windows are now closed
    if (!grandParentWindow) {
      logToFile(wmLogFilePath, "No window to resize", LogLevel.DEBUG);
    }

    if (parentWindow.horizontalParentId === grandParentWindow.windowId) {
      logToFile(
        wmLogFilePath,
        "RESIZING PARENT HORIZONTAL:" + JSON.stringify(grandParentWindow),
        LogLevel.DEBUG
      );
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
    } else if (parentWindow.verticalParentId === grandParentWindow.windowId) {
      logToFile(
        wmLogFilePath,
        "RESIZING PARENT VERTICAL:" + JSON.stringify(grandParentWindow),
        LogLevel.DEBUG
      );
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
      // If child top is on bottom border
      if (parentWindow.y + parentWindow.height + 5 === fyrWin.y) {
        // If bordering child is within the width of the current container
        if (
          fyrWin.x >= parentWindow.x &&
          fyrWin.width + fyrWin.x <= parentWindow.x + parentWindow.width
        ) {
          //Resize window
          const newFyrWin: FyrWindow = {
            ...fyrWin,
            height: fyrWin.height + parentWindow.height,
            y: parentWindow.y,
            horizontalParentId: parentWindow.horizontalParentId
              ? parentWindow.horizontalParentId
              : fyrWin.horizontalParentId,
            verticalParentId: parentWindow.verticalParentId
              ? parentWindow.verticalParentId
              : fyrWin.verticalParentId,
            horizontalChildId: parentWindow.horizontalChildId
              ? parentWindow.horizontalChildId
              : fyrWin.horizontalChildId,
          };
          deleteFyrWin(fyrWin.windowId);
          addFyrWind(newFyrWin);

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
      if (parentWindow.x + parentWindow.width + 5 === fyrWin.x) {
        if (
          fyrWin.y >= parentWindow.y &&
          fyrWin.height + fyrWin.y <= parentWindow.height + parentWindow.y
        ) {
          //Resize window
          const newFyrWin: FyrWindow = {
            ...fyrWin,
            width: fyrWin.width + parentWindow.width,
            x: parentWindow.x,
            horizontalParentId: parentWindow.horizontalParentId
              ? parentWindow.horizontalParentId
              : fyrWin.horizontalParentId,
            verticalParentId: parentWindow.verticalParentId
              ? parentWindow.verticalParentId
              : fyrWin.verticalParentId,
            verticalChildId: parentWindow.verticalChildId
              ? parentWindow.verticalChildId
              : fyrWin.verticalChildId,
          };
          deleteFyrWin(fyrWin.windowId);
          addFyrWind(newFyrWin);

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
  if (windowToDelete) {
    // deleteFyrWin(windowToDelete.windowId);
    resizeOnDestroy(windowToDelete.windowId);
  }
  // resizeAdjacentWindows(windowToDelete, windowToDelete.lastSplitType);
};

const findCurrentWindow = (wid: number): FyrWindow => {
  let foundWindow: FyrWindow = null;
  allOpenedFyrWindows.forEach((win) => {
    if (win.windowId === wid) {
      foundWindow = win;
    }
  });
  return foundWindow;
};

const initX11Client = async () => {
  client = await createClient(async (err, display: XDisplay) => {
    if (err) {
      logToFile(
        wmLogFilePath,
        `Error in X11 connection:${err}`,
        LogLevel.ERROR
      );
      return;
    }

    X = display.client;
    await initDesktop(display);

    X.InternAtom(false, "WM_CLASS", (err, atom) => {
      if (err) {
        console.error(err);
        return;
      }
      wmClassAtom = atom;
      X.InternAtom(false, "STRING", (err, atom) => {
        if (err) {
          console.error(err);
          return;
        }
        stringAtom = atom;
      });
    });

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

    X.on("event", (ev) => {});

    // Capture keyboard, mouse, and window events
    client.on("event", async (ev: IXEvent) => {
      logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
      const { type } = ev;
      switch (type) {
        case X11_EVENT_TYPE.KeyPress:
          if (ev.wid === launcherWid) return;
          const focusedWindow =
            ev.wid && ev.wid !== launcherWid ? findCurrentWindow(ev.wid) : null;
          currentWindowId =
            ev.wid && ev.wid !== launcherWid ? ev.wid : currentWindowId;
          currentResizableWindow =
            ev.wid !== launcherWid && focusedWindow
              ? focusedWindow
              : currentResizableWindow;
          break;
        case X11_EVENT_TYPE.KeyRelease:
          logToFile(wmLogFilePath, "KEY RELEASED", LogLevel.DEBUG);
          break;
        case X11_EVENT_TYPE.ButtonPress:
          logToFile(wmLogFilePath, "BUTTON PRESSED", LogLevel.DEBUG);
          logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
          break;
        case X11_EVENT_TYPE.ButtonRelease:
          logToFile(wmLogFilePath, "BUTTON RELEASED", LogLevel.DEBUG);
          break;
        case X11_EVENT_TYPE.MotionNotify:
          break;
        case X11_EVENT_TYPE.EnterNotify:
          logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
          break;
        case X11_EVENT_TYPE.LeaveNotify:
          break;
        case X11_EVENT_TYPE.Expose:
          break;
        case X11_EVENT_TYPE.CreateNotify:
          break;
        case X11_EVENT_TYPE.MapRequest:
          openApp(ev.wid, splitDirection, currentWindowId);
          currentWindowId = ev.wid !== launcherWid ? ev.wid : currentWindowId;
          break;
        case X11_EVENT_TYPE.DestroyNotify:
          logToFile(wmLogFilePath, JSON.stringify(ev.name), LogLevel.DEBUG);
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
          logToFile(wmLogFilePath, JSON.stringify(ev), LogLevel.DEBUG);
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

//---------------------------------------------- Electron----------------------------------------------------

const getElectronWindowId = (browserWindow: BrowserWindow): number => {
  const nativeHandle = browserWindow.getNativeWindowHandle();
  const wid = nativeHandle.readUint32LE(0);
  return wid;
};

app.whenReady().then(async () => {
  await initX11Client();
  initCompositing();
  const launcherShortcut = globalShortcut.register("Super+Space", () => {
    if (launcherWid && launcherWindow.isVisible()) {
      launcherWindow.hide();
    } else if (launcherInited) {
      launcherWindow.show();
      X.RaiseWindow(launcherWid);
    } else {
      openLauncher();
    }
  });
  if (!launcherShortcut) {
  }

  const closeAppShortcut = globalShortcut.register("Super+Q", () => {
    if (currentResizableWindow) {
      X.DestroyWindow(currentResizableWindow.windowId);
    }
  });
  if (!closeAppShortcut) {
  }

  // Exit wm
  const closeWMShortcut = globalShortcut.register("Ctrl+Shift+Q", () => {
    app.quit();
  });
  if (!closeWMShortcut) {
  }

  // Window split directions
  const horizontalSplitShortcut = globalShortcut.register("Super+H", () => {
    splitDirection = SplitDirection.Horizontal;
  });

  if (!horizontalSplitShortcut) {
  }

  try {
    const verticalSplitShortcut = globalShortcut.register("Super+V", () => {
      splitDirection = SplitDirection.Vertical;
    });

    if (!verticalSplitShortcut) {
    }
  } catch (err) {}

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) initX11Client();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
  }
});

ipcMain.on("onLaunchApp", (event, appCommand) => {
  const [command, ...args] = appCommand.split(" ");
  const child = spawn(command, args, {
    env: { ...process.env },
    shell: true,
  });
  launcherWindow.hide();

  child.on("error", (error) => {});

  child.on("exit", (code) => {
    if (code !== null) {
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
    } catch (err) {}
  }

  return apps;
});

const setWindowClass = (windowId, className) => {
  const value = Buffer.from(`${className}\0${className}\0`, "binary");

  X.ChangeProperty(0, windowId, wmClassAtom, stringAtom, 8, value);
};

const openLauncher = () => {
  const [width, height] = [screen.pixel_width, screen.pixel_height];

  const [x, y] = [0, 0];

  launcherWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    backgroundColor: "#000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  launcherWindow.webContents.loadFile("./dist/vue/app-launcher.html");

  launcherWindow.setFullScreen(true);
  launcherWindow.setFocusable(true);
  launcherWindow.setAlwaysOnTop(true);
  launcherWid = getElectronWindowId(launcherWindow);
  launcherInited = true;
  setWindowClass(launcherWid, "electronTransparent");
  X.RaiseWindow(launcherWid);
  X.MapWindow(launcherWid);
};

// TODO:
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
      }

      return isGui;
    } else {
      return false;
    }
  } catch (err) {
    throw err;
  }
};
