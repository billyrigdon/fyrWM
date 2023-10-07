import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { spawn } from "child_process";
import { createClient, eventMask, createWindow } from "x11";
import ini from "ini";
import fs from "fs";

let X;
let desktopWindow: BrowserWindow;
let controlSpacePressed = false;
// Used to track BrowserWindow containers
const browserWindowIds = new Set();
const openedWinows: Set<number> = new Set();
// Add to set to check if browserWindow in event listener
const addBrowserWindowId = (windowId: number) => {
  browserWindowIds.add(windowId);
};

const wrapX11App = (wid: number) => {};

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

  openedWinows.add(autocompleteWid);

  const x11ContainerId = X.AllocID();
  openedWinows.add(x11ContainerId);

  // // Desktop should be root in almost every situation
  X.CreateWindow(x11ContainerId, desktopWid, 55, 60, 120, 80, 0, 0, 0, 0, {
    eventMask: eventMask,
    backgroundPixel: 10,
  });

  // // Reparent Electron container into x11 window container
  X.MapWindow(x11ContainerId);
  X.ReparentWindow(autocompleteWid, x11ContainerId, 0, 0);
  X.MapWindow(autocompleteWid);
  console.log(autoCompleteWindow);
  // X.SetInputFocus(autocompleteWid, XFocusRevertTo.PointerRoot)
  // autoCompleteWindow.webContents.openDevTools();
};

// Initilize desktop and X11 client
const initDesktop = async () => {
  desktopWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    x: 0,
    y: 0,
    frame: false,
    alwaysOnTop: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  desktopWindow.loadURL("https://billyrigdon.dev");
  desktopWindow.maximize();
  desktopWindow.setFullScreen(true);
  desktopWindow.setFocusable(false);
  desktopWindow.setAlwaysOnTop(false);
  const desktopWid = getElectronWindowId(desktopWindow);
  initX11Client(desktopWid);
};

const initX11Client = (desktopWid: number) => {
  createClient(async (err, display) => {
    X = display.client;
    const root = display.screen[0].root;

    X.ChangeWindowAttributes(
      root,
      { eventMask: X.eventMask.SubstructureNotify },
      (err) => {
        if (err) {
          console.error("Failed to set event mask:", err);
          return;
        }

        X.on("error", (err) => {
          console.error(`X11 Error: ${err}`);
        });

        X.on("event", (ev) => {});
      }
    );
    X.MapWindow(desktopWid);

    // Open test app
    // openApp(desktopWid, 800, 600);

    X.on("error", (err) => {
      console.error(`X11 Error: ${err}`);
    });

    let focusedWindowId;

    X.on("event", (ev) => {
      if (ev.name === "KeyPress") {
        if (focusedWindowId) {
          // Forward the key press event to the currently focused window
          X.SendEvent(false, focusedWindowId, true, X.eventMask.KeyPress, ev);
        }
      } else if (ev.name === "FocusIn") {
        // Update focusedWindowId when a window gains focus
        focusedWindowId = ev.wid;
      } else if (ev.name === "FocusOut") {
        // Reset focusedWindowId when a window loses focus
        focusedWindowId = null;
      }

      if (ev.name === "CreateNotify") {
        if (!openedWinows.has(ev.wid)) {
          openedWinows.add(ev.wid);
          if (controlSpacePressed) {
            controlSpacePressed = false;
            // openAutoComplete()
          } else {
            openApp(ev.wid, desktopWid, 300, 400);
          }
        } else {
          console.log("No thanks, I already got one.");
        }
      }
    });
  });
};

// Create X11 container window with desktop as parent
// Create React component and reparent inside X11 container
const openApp = (
  appWid: number,
  parentId: number,
  width: number,
  height: number
) => {
  const electronWindow = new BrowserWindow({
    width: width,
    height: 50,
    x: 0,
    y: 0,
    frame: false,
    alwaysOnTop: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
    },
  });
  electronWindow.loadFile("./dist/vue/moon.jpg");
  const electronWid = getElectronWindowId(electronWindow);
  openedWinows.add(electronWid);

  const x11ContainerId = X.AllocID();
  openedWinows.add(x11ContainerId);

  // Desktop should be root in almost every situation
  X.CreateWindow(
    x11ContainerId,
    parentId,
    55,
    60,
    width,
    height - 50, // For titlebar
    0,
    0,
    0,
    0,
    { eventMask: eventMask, backgroundPixel: 10 }
  );

  // Reparent Electron container into x11 window container
  X.MapWindow(x11ContainerId);
  X.ReparentWindow(electronWid, x11ContainerId, 0, 0);
  X.MapWindow(electronWid);

  X.ReparentWindow(appWid, electronWid, 0, 50);
  console.log("reparented");
  X.MapWindow(appWid);
};

app.whenReady().then(() => {
  initDesktop();
  const autocompleteShortcut = globalShortcut.register("Control+Space", () => {
    console.log("Control+Space is pressed");
    controlSpacePressed = true;
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
    if (BrowserWindow.getAllWindows().length === 0) {
      initDesktop();
    }
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

// Listen for an "onLaunchApp" IPC event
ipcMain.on("onLaunchApp", (event, appCommand) => {
  const [command, ...args] = appCommand.split(' ');

  const child = spawn(command, args, {
    env: { ...process.env },
    shell: true
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
    // "~/.local/share/applications",
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
              exec: desktopEntry.Exec
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
