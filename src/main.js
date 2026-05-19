const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_PET_ID = "baiheyan";
const DEV_ROOT_DIR = path.join(__dirname, "..");
const APP_ROOT_DIR = app.isPackaged ? process.resourcesPath : DEV_ROOT_DIR;
const DEV_PACKAGED_EXE_PATH = path.join(DEV_ROOT_DIR, "release", "win-unpacked", "LittlePets.exe");
const LOCAL_APP_DIR = app.isPackaged
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "LittlePets")
  : path.join(DEV_ROOT_DIR, ".littlepets");
const PET_WINDOW_SIZE = { width: 560, height: 640 };
const PET_HITBOX = {
  top: 170,
  left: 104,
  width: 192,
  height: 208
};

app.setPath("userData", path.join(LOCAL_APP_DIR, "userData"));
app.setPath("sessionData", path.join(LOCAL_APP_DIR, "sessionData"));

let petWindow;
let settingsWindow;
let tray;
let pointerWatchTimer = null;
let pendingStateWriteTimer = null;
let petInteractionLocked = false;
let petWindowIgnoringMouse = true;
let appState = {
  selectedPetId: DEFAULT_PET_ID,
  petVisible: true,
  alwaysOnTop: true,
  launchOnStartup: false,
  bubbleVisible: true,
  petScale: 1,
  petWindowPosition: null
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPetsDir() {
  return path.join(APP_ROOT_DIR, "pets");
}

function getStatePath() {
  return path.join(LOCAL_APP_DIR, "state.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readState() {
  try {
    appState = {
      ...appState,
      ...readJson(getStatePath())
    };
  } catch {
    writeState();
  }
}

function writeState() {
  fs.mkdirSync(path.dirname(getStatePath()), { recursive: true });
  fs.writeFileSync(getStatePath(), JSON.stringify(appState, null, 2), "utf8");
}

function scheduleStateWrite() {
  clearTimeout(pendingStateWriteTimer);
  pendingStateWriteTimer = setTimeout(() => {
    pendingStateWriteTimer = null;
    writeState();
  }, 120);
}

function emitStateChanged() {
  petWindow?.webContents.send("state:changed", appState);
  settingsWindow?.webContents.send("state:changed", appState);
}

function getStartupRegistration() {
  if (app.isPackaged) {
    return {
      path: process.execPath,
      args: []
    };
  }

  if (process.platform === "win32" && fs.existsSync(DEV_PACKAGED_EXE_PATH)) {
    return {
      path: DEV_PACKAGED_EXE_PATH,
      args: []
    };
  }

  return {
    path: process.execPath,
    args: [DEV_ROOT_DIR]
  };
}

function syncLaunchOnStartupState() {
  const startupRegistration = getStartupRegistration();
  const settings = app.getLoginItemSettings(startupRegistration);

  appState.launchOnStartup = settings.openAtLogin;
}

function getOpenAtLoginSettings(value) {
  const startupRegistration = getStartupRegistration();
  return {
    openAtLogin: Boolean(value),
    path: startupRegistration.path,
    args: startupRegistration.args
  };
}

function setLaunchOnStartup(value) {
  app.setLoginItemSettings(getOpenAtLoginSettings(value));
  syncLaunchOnStartupState();
  writeState();
  emitStateChanged();
  return appState.launchOnStartup;
}

function setBubbleVisible(value) {
  appState.bubbleVisible = Boolean(value);
  writeState();
  emitStateChanged();
  return appState.bubbleVisible;
}

function loadPets() {
  const petsDir = getPetsDir();

  if (!fs.existsSync(petsDir)) {
    return [];
  }

  return fs
    .readdirSync(petsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const petDir = path.join(petsDir, entry.name);
      const petJsonPath = path.join(petDir, "pet.json");

      if (!fs.existsSync(petJsonPath)) {
        return null;
      }

      try {
        const meta = readJson(petJsonPath);
        const spritesheetPath = path.join(petDir, meta.spritesheetPath || "spritesheet.webp");

        if (!fs.existsSync(spritesheetPath)) {
          return null;
        }

        return {
          id: meta.id || entry.name,
          displayName: meta.displayName || meta.id || entry.name,
          description: meta.description || "",
          petDir,
          spritesheetPath,
          spritesheetUrl: pathToFileURL(spritesheetPath).toString()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getSelectedPet() {
  const pets = loadPets();
  return (
    pets.find((pet) => pet.id === appState.selectedPetId) ||
    pets.find((pet) => pet.id === DEFAULT_PET_ID) ||
    pets[0] ||
    null
  );
}

function createTrayIcon() {
  const iconPath = path.join(APP_ROOT_DIR, "assets", "tray-icon.png");
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function getPetHitboxBounds() {
  if (!petWindow) {
    return null;
  }

  const [windowX, windowY] = petWindow.getPosition();
  const scale = clamp(Number(appState.petScale) || 1, 0.35, 1.4);
  const width = PET_HITBOX.width * scale;
  const height = PET_HITBOX.height * scale;
  const left = windowX + PET_HITBOX.left;
  const top = windowY + PET_HITBOX.top;

  return {
    left,
    top,
    right: left + width,
    bottom: top + height
  };
}

function setPetWindowMouseIgnore(ignore) {
  if (!petWindow || petWindowIgnoringMouse === ignore) {
    return;
  }

  petWindowIgnoringMouse = ignore;
  petWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
}

function refreshPetPointerMode() {
  if (!petWindow || petWindow.isDestroyed() || !appState.petVisible) {
    return;
  }

  if (petInteractionLocked) {
    setPetWindowMouseIgnore(false);
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const bounds = getPetHitboxBounds();

  if (!bounds) {
    return;
  }

  const isInsideHitbox =
    cursor.x >= bounds.left &&
    cursor.x <= bounds.right &&
    cursor.y >= bounds.top &&
    cursor.y <= bounds.bottom;

  setPetWindowMouseIgnore(!isInsideHitbox);
}

function startPetPointerWatch() {
  clearInterval(pointerWatchTimer);
  pointerWatchTimer = setInterval(refreshPetPointerMode, 50);
}

function stopPetPointerWatch() {
  clearInterval(pointerWatchTimer);
  pointerWatchTimer = null;
}

function showSettingsWindow() {
  if (!settingsWindow) {
    createSettingsWindow();
  }

  settingsWindow.show();
  settingsWindow.focus();
}

function setPetVisible(value) {
  appState.petVisible = Boolean(value);
  writeState();

  if (appState.petVisible) {
    if (!petWindow) {
      createPetWindow();
    } else {
      petWindow.showInactive();
      refreshPetPointerMode();
    }
  } else {
    petWindow?.hide();
  }

  refreshTray();
  emitStateChanged();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "打开 LittlePets",
      click: showSettingsWindow
    },
    {
      label: appState.petVisible ? "隐藏桌宠" : "显示桌宠",
      click: () => setPetVisible(!appState.petVisible)
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function refreshTray() {
  if (!tray) {
    return;
  }

  const selectedPet = getSelectedPet();
  tray.setToolTip(`LittlePets${selectedPet ? ` - ${selectedPet.displayName}` : ""}`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.on("click", showSettingsWindow);
  refreshTray();
}

function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const savedPosition = appState.petWindowPosition;
  const rawX = Number.isFinite(savedPosition?.x)
    ? savedPosition.x
    : workArea.x + workArea.width - PET_WINDOW_SIZE.width - 24;
  const rawY = Number.isFinite(savedPosition?.y)
    ? savedPosition.y
    : workArea.y + workArea.height - PET_WINDOW_SIZE.height - 24;
  const x = clamp(rawX, workArea.x, workArea.x + workArea.width - PET_WINDOW_SIZE.width);
  const y = clamp(rawY, workArea.y, workArea.y + workArea.height - PET_WINDOW_SIZE.height);

  petWindow = new BrowserWindow({
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: appState.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(path.join(__dirname, "pet.html"));
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.once("ready-to-show", () => {
    setPetWindowMouseIgnore(true);
    if (appState.petVisible) {
      petWindow.showInactive();
    }
    const [initX, initY] = petWindow.getPosition();
    appState.petWindowPosition = { x: initX, y: initY };
    refreshPetPointerMode();
  });
  petWindow.on("closed", () => {
    petWindow = null;
    petInteractionLocked = false;
    petWindowIgnoringMouse = true;
  });
  petWindow.on("moved", () => {
    if (!petWindow) {
      return;
    }

    const [nextX, nextY] = petWindow.getPosition();
    appState.petWindowPosition = { x: nextX, y: nextY };
    scheduleStateWrite();
    refreshPetPointerMode();
  });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 720,
    minHeight: 600,
    title: "LittlePets",
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function broadcastSelectedPet() {
  const selectedPet = getSelectedPet();
  petWindow?.webContents.send("pet:selected", selectedPet);
  settingsWindow?.webContents.send("pet:selected", selectedPet);
  refreshTray();
}

app.whenReady().then(() => {
  app.setAppUserModelId("LittlePets");
  Menu.setApplicationMenu(null);
  readState();
  syncLaunchOnStartupState();
  writeState();
  createTray();
  createPetWindow();
  createSettingsWindow();
  startPetPointerWatch();

  if (app.isPackaged && !app.getLoginItemSettings().wasOpenedAtLogin) {
    showSettingsWindow();
  }

  app.on("activate", showSettingsWindow);
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopPetPointerWatch();
});

app.on("window-all-closed", () => {
});

ipcMain.handle("app:showSettings", () => {
  showSettingsWindow();
});

ipcMain.handle("app:hideSettings", () => {
  settingsWindow?.hide();
});

ipcMain.handle("app:quit", () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle("app:setLaunchOnStartup", (_event, value) => {
  return setLaunchOnStartup(value);
});

ipcMain.handle("pets:list", () => loadPets());

ipcMain.handle("pets:getSelected", () => getSelectedPet());

ipcMain.handle("pets:setSelected", (_event, petId) => {
  const exists = loadPets().some((pet) => pet.id === petId);

  if (!exists) {
    return getSelectedPet();
  }

  appState.selectedPetId = petId;
  writeState();
  broadcastSelectedPet();
  return getSelectedPet();
});

ipcMain.handle("state:get", () => appState);

ipcMain.handle("pet:setVisible", (_event, value) => {
  setPetVisible(value);
  return appState.petVisible;
});

ipcMain.handle("pet:setAlwaysOnTop", (_event, value) => {
  appState.alwaysOnTop = Boolean(value);
  petWindow?.setAlwaysOnTop(appState.alwaysOnTop, "floating");
  writeState();
  refreshTray();
  emitStateChanged();
  return appState.alwaysOnTop;
});

ipcMain.handle("pet:setBubbleVisible", (_event, value) => {
  return setBubbleVisible(value);
});

ipcMain.handle("pet:setScale", (_event, value) => {
  const nextScale = Math.min(1.4, Math.max(0.35, Number(value) || 1));
  appState.petScale = nextScale;
  writeState();
  emitStateChanged();
  refreshPetPointerMode();
  return appState.petScale;
});

ipcMain.handle("pet:moveBy", (_event, delta) => {
  if (!petWindow) {
    return null;
  }

  const [x, y] = petWindow.getPosition();
  const nextX = x + Math.round(Number(delta?.x) || 0);
  const nextY = y + Math.round(Number(delta?.y) || 0);
  petWindow.setPosition(nextX, nextY, false);
  appState.petWindowPosition = { x: nextX, y: nextY };
  return appState.petWindowPosition;
});

ipcMain.handle("pet:setInteractionLock", (_event, value) => {
  petInteractionLocked = Boolean(value);
  if (!petInteractionLocked) {
    setPetWindowMouseIgnore(false);
  }
  return petInteractionLocked;
});
