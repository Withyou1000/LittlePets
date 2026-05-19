const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// main.js 可以理解成整个 Electron 应用的“大脑”。
// 它负责原生窗口、系统托盘、状态持久化、IPC 通信这些系统层能力。
// pet.js / bubble.js / settings.js 只要遇到需要操作系统配合的事情，
// 最终都会请求 main.js 来完成。

const DEFAULT_PET_ID = "baiheyan";
const DEV_ROOT_DIR = path.join(__dirname, "..");
const APP_ROOT_DIR = app.isPackaged ? process.resourcesPath : DEV_ROOT_DIR;
const DEV_PACKAGED_EXE_PATH = path.join(DEV_ROOT_DIR, "release", "win-unpacked", "LittlePets.exe");
const LOCAL_APP_DIR = app.isPackaged
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "LittlePets")
  : path.join(DEV_ROOT_DIR, ".littlepets");
const PET_PADDING = 2;
const BUBBLE_WINDOW_SIZE = { width: 360, height: 180 };
const PET_HITBOX = {
  top: PET_PADDING,
  left: PET_PADDING,
  width: 192,
  height: 208
};

app.setPath("userData", path.join(LOCAL_APP_DIR, "userData"));
app.setPath("sessionData", path.join(LOCAL_APP_DIR, "sessionData"));

let petWindow;
let bubbleWindow;
let settingsWindow;
let tray;
let pointerWatchTimer = null;
let pendingStateWriteTimer = null;
let petInteractionLocked = false;
let petWindowIgnoringMouse = true;
let activePetDrag = null;
let cachedActiveDisplay = null;
let petDragAnimationStopTimer = null;
let lastPetWindowMovePosition = null;

// appState 是整个应用共享的一份总状态。
// 某个设置变化后，通常会经历这几步：
// 1. 先改 appState
// 2. 按需写入本地文件
// 3. 广播给各个渲染窗口同步刷新
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

function getPetScale() {
  return clamp(Number(appState.petScale) || 1, 0.35, 1.4);
}

function getPetWindowSize() {
  // 用户可以在设置里调整桌宠缩放，
  // 所以透明窗口本身也要跟着精灵图碰撞区域一起放大或缩小。
  const scale = getPetScale();
  return {
    width: Math.round(PET_HITBOX.width * scale + PET_PADDING * 2),
    height: Math.round(PET_HITBOX.height * scale + PET_PADDING * 2)
  };
}

function isPointInsideRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function getDisplayForPoint(point = screen.getCursorScreenPoint()) {
  if (cachedActiveDisplay && isPointInsideRect(point, cachedActiveDisplay.bounds)) {
    return cachedActiveDisplay;
  }

  cachedActiveDisplay = screen.getDisplayNearestPoint(point);
  return cachedActiveDisplay;
}

function getPrimaryWorkAreaFallback() {
  return screen.getPrimaryDisplay().workArea;
}

function getDisplayForSavedPosition(position) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    return null;
  }

  const point = { x: position.x, y: position.y };
  return screen.getAllDisplays().find((display) => isPointInsideRect(point, display.bounds)) || null;
}

function getDisplayForWindowBounds(bounds) {
  if (!Number.isFinite(bounds?.x) || !Number.isFinite(bounds?.y)) {
    return null;
  }

  return screen.getDisplayMatching(bounds);
}

function clampPositionToDisplay(position, windowSize, display) {
  const workArea = display?.workArea || getPrimaryWorkAreaFallback();
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + Math.max(0, workArea.width - windowSize.width);
  const maxY = workArea.y + Math.max(0, workArea.height - windowSize.height);

  return {
    x: clamp(Math.round(position.x), minX, maxX),
    y: clamp(Math.round(position.y), minY, maxY)
  };
}

function getClampedPetWindowPosition(position, options = {}) {
  const windowSize = options.windowSize || getPetWindowSize();
  const displayPoint = options.displayPoint || position;
  const display = options.display || getDisplayForPoint(displayPoint);

  return clampPositionToDisplay(position, windowSize, display);
}

function getDefaultPetWindowPosition(windowSize = getPetWindowSize()) {
  const workArea = getPrimaryWorkAreaFallback();
  return {
    x: workArea.x + workArea.width - windowSize.width - 24,
    y: workArea.y + workArea.height - windowSize.height - 24
  };
}

function toPhysicalPoint(point) {
  return screen.dipToScreenPoint({
    x: Math.round(point.x),
    y: Math.round(point.y)
  });
}

function toDipPoint(point) {
  return screen.screenToDipPoint({
    x: Math.round(point.x),
    y: Math.round(point.y)
  });
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
  // 把用户选择持久化到本地文件里，
  // 比如当前宠物、缩放比例、上次窗口位置等。
  fs.mkdirSync(path.dirname(getStatePath()), { recursive: true });
  fs.writeFileSync(getStatePath(), JSON.stringify(appState, null, 2), "utf8");
}

function scheduleStateWrite() {
  // 拖动桌宠时会在很短时间内触发很多次 moved 事件。
  // 这里做一个轻微延迟，避免每移动一点就立刻写磁盘。
  clearTimeout(pendingStateWriteTimer);
  pendingStateWriteTimer = setTimeout(() => {
    pendingStateWriteTimer = null;
    writeState();
  }, 120);
}

function emitStateChanged() {
  // 把最新状态推送给所有关心它的窗口。
  petWindow?.webContents.send("state:changed", appState);
  settingsWindow?.webContents.send("state:changed", appState);
}

function emitPetDragDirection(direction) {
  petWindow?.webContents.send("pet:dragDirection", { direction });
}

function emitPetDragStop() {
  petWindow?.webContents.send("pet:dragStop");
}

function syncBubbleWindowBounds() {
  // 气泡不是画在桌宠窗口里的，而是一个单独的透明窗口。
  // 所以桌宠一移动，气泡窗口也要重新定位。
  if (!petWindow || petWindow.isDestroyed() || !bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }

  const [petX, petY] = petWindow.getPosition();
  const petSize = getPetWindowSize();
  const bubbleX = Math.round(petX + petSize.width / 2 - BUBBLE_WINDOW_SIZE.width / 2);
  const bubbleY = Math.round(petY - BUBBLE_WINDOW_SIZE.height - 8);

  bubbleWindow.setBounds({
    x: bubbleX,
    y: bubbleY,
    width: BUBBLE_WINDOW_SIZE.width,
    height: BUBBLE_WINDOW_SIZE.height
  }, false);
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
  if (!appState.bubbleVisible) {
    bubbleWindow?.webContents.send("bubble:hide");
    bubbleWindow?.hide();
  }
  emitStateChanged();
  return appState.bubbleVisible;
}

function loadPets() {
  // 运行时扫描 pets 目录，动态发现有哪些宠物可用。
  // 每个宠物文件夹至少需要：
  // 1. pet.json
  // 2. 一张精灵图
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
  // 兜底顺序如下：
  // 1. 用户上次保存的宠物
  // 2. 默认宠物 id
  // 3. 磁盘上扫描到的第一只宠物
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
  // 整个透明窗口除了精灵图本体，还有一圈透明留白。
  // 鼠标命中判断时，我们只关心桌宠真正的可交互区域。
  if (!petWindow) {
    return null;
  }

  const [windowX, windowY] = petWindow.getPosition();
  const scale = getPetScale();
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
  // 透明窗口很容易“挡住”鼠标事件。
  // 这里定时轮询鼠标位置，只有当鼠标真的在桌宠区域上时，
  // 才让这个窗口接管鼠标事件。
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
      createPetWindows();
    } else {
      const [x, y] = petWindow.getPosition();
      const clampedPosition = getClampedPetWindowPosition(
        { x, y },
        {
          display: getDisplayForSavedPosition({ x, y }) || getDisplayForPoint({ x, y })
        }
      );
      petWindow.setPosition(clampedPosition.x, clampedPosition.y, false);
      appState.petWindowPosition = clampedPosition;
      petWindow.showInactive();
      if (appState.bubbleVisible) {
        bubbleWindow?.showInactive();
      }
      syncBubbleWindowBounds();
      refreshPetPointerMode();
    }
  } else {
    petWindow?.hide();
    bubbleWindow?.hide();
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

function createPetWindows() {
  // 创建两个核心窗口：
  // 1. 桌宠窗口
  // 2. 气泡窗口
  // 它们都没有边框、背景透明，并且默认浮在普通窗口上面。
  const petSize = getPetWindowSize();
  const savedPosition = appState.petWindowPosition;
  const initialPosition = Number.isFinite(savedPosition?.x) && Number.isFinite(savedPosition?.y)
    ? getClampedPetWindowPosition(
        savedPosition,
        {
          windowSize: petSize,
          display: getDisplayForSavedPosition(savedPosition) || screen.getPrimaryDisplay()
        }
      )
    : getClampedPetWindowPosition(getDefaultPetWindowPosition(petSize), {
        windowSize: petSize,
        display: screen.getPrimaryDisplay()
      });

  petWindow = new BrowserWindow({
    width: petSize.width,
    height: petSize.height,
    x: initialPosition.x,
    y: initialPosition.y,
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
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_SIZE.width,
    height: BUBBLE_WINDOW_SIZE.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: appState.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  bubbleWindow.loadFile(path.join(__dirname, "bubble.html"));
  bubbleWindow.setIgnoreMouseEvents(true, { forward: true });
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.once("ready-to-show", () => {
    // Electron 真正把窗口准备好之后，再记录一次初始位置更稳妥。
    setPetWindowMouseIgnore(true);
    if (appState.petVisible) {
      petWindow.showInactive();
      if (appState.bubbleVisible) {
        bubbleWindow?.showInactive();
      }
    }
    const [initX, initY] = petWindow.getPosition();
    const clampedPosition = getClampedPetWindowPosition(
      { x: initX, y: initY },
      {
        windowSize: getPetWindowSize(),
        display: getDisplayForSavedPosition({ x: initX, y: initY }) || screen.getPrimaryDisplay()
      }
    );
    petWindow.setPosition(clampedPosition.x, clampedPosition.y, false);
    appState.petWindowPosition = clampedPosition;
    lastPetWindowMovePosition = clampedPosition;
    syncBubbleWindowBounds();
    refreshPetPointerMode();
  });
  petWindow.on("closed", () => {
    petWindow = null;
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.close();
    }
    bubbleWindow = null;
    petInteractionLocked = false;
    petWindowIgnoringMouse = true;
    clearTimeout(petDragAnimationStopTimer);
    petDragAnimationStopTimer = null;
    lastPetWindowMovePosition = null;
  });
  petWindow.on("move", () => {
    // 实时保存最新位置，保证下次启动时还在用户上次放的位置。
    if (!petWindow) {
      return;
    }

    const [nextX, nextY] = petWindow.getPosition();
    appState.petWindowPosition = { x: nextX, y: nextY };
    if (lastPetWindowMovePosition) {
      const deltaX = nextX - lastPetWindowMovePosition.x;

      if (deltaX !== 0) {
        emitPetDragDirection(deltaX > 0 ? "right" : "left");
        clearTimeout(petDragAnimationStopTimer);
        petDragAnimationStopTimer = setTimeout(() => {
          emitPetDragStop();
        }, 120);
      }
    }
    lastPetWindowMovePosition = { x: nextX, y: nextY };
    scheduleStateWrite();
    syncBubbleWindowBounds();
    refreshPetPointerMode();
  });
}

function createSettingsWindow() {
  // 设置窗口是一个普通的应用窗口，
  // 用来管理桌宠显示、置顶、开机启动、切换宠物等设置。
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
  // 当前宠物变化后，桌宠窗口和设置窗口都要同步刷新。
  const selectedPet = getSelectedPet();
  petWindow?.webContents.send("pet:selected", selectedPet);
  settingsWindow?.webContents.send("pet:selected", selectedPet);
  refreshTray();
}

app.whenReady().then(() => {
  // 应用启动主流程：
  // 1. 读取本地保存状态
  // 2. 和系统里的开机启动状态对齐
  // 3. 创建托盘和窗口
  // 4. 开启鼠标位置轮询
  app.setAppUserModelId("LittlePets");
  Menu.setApplicationMenu(null);
  readState();
  syncLaunchOnStartupState();
  writeState();
  createTray();
  createPetWindows();
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
  // 只有当这只宠物真实存在时，才允许保存这个 id。
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
  bubbleWindow?.setAlwaysOnTop(appState.alwaysOnTop, "floating");
  writeState();
  refreshTray();
  emitStateChanged();
  return appState.alwaysOnTop;
});

ipcMain.handle("pet:setBubbleVisible", (_event, value) => {
  return setBubbleVisible(value);
});

ipcMain.handle("pet:setScale", (_event, value) => {
  // 缩放变化后，不只是 CSS 变，
  // 原生透明窗口本身的大小也必须同步调整。
  const nextScale = Math.min(1.4, Math.max(0.35, Number(value) || 1));
  appState.petScale = nextScale;
  writeState();
  if (petWindow && !petWindow.isDestroyed()) {
    const [x, y] = petWindow.getPosition();
    const petSize = getPetWindowSize();
    const clampedPosition = getClampedPetWindowPosition(
      { x, y },
      {
        windowSize: petSize,
        display: getDisplayForSavedPosition({ x, y }) || getDisplayForPoint({ x, y })
      }
    );
    petWindow.setBounds(
      {
        x: clampedPosition.x,
        y: clampedPosition.y,
        width: petSize.width,
        height: petSize.height
      },
      false
    );
    appState.petWindowPosition = clampedPosition;
    syncBubbleWindowBounds();
  }
  emitStateChanged();
  refreshPetPointerMode();
  return appState.petScale;
});

ipcMain.handle("bubble:show", (_event, payload) => {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !appState.bubbleVisible) {
    return false;
  }

  syncBubbleWindowBounds();
  if (appState.petVisible) {
    bubbleWindow.showInactive();
  }
  bubbleWindow.webContents.send("bubble:show", payload);
  return true;
});

ipcMain.handle("bubble:hide", () => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return false;
  }

  bubbleWindow.webContents.send("bubble:hide");
  bubbleWindow.hide();
  return true;
});

ipcMain.handle("pet:moveBy", (_event, delta) => {
  // 这是较早的“按增量移动”接口。
  // 下面新的拖拽流程在混合 DPI、多屏场景下更稳定。
  if (!petWindow) {
    return null;
  }

  const [x, y] = petWindow.getPosition();
  const clampedPosition = getClampedPetWindowPosition(
    {
      x: x + Math.round(Number(delta?.x) || 0),
      y: y + Math.round(Number(delta?.y) || 0)
    },
    {
      displayPoint: screen.getCursorScreenPoint()
    }
  );
  petWindow.setPosition(clampedPosition.x, clampedPosition.y, false);
  appState.petWindowPosition = clampedPosition;
  syncBubbleWindowBounds();
  return appState.petWindowPosition;
});

ipcMain.handle("pet:startDrag", (_event, point) => {
  // 拖拽开始时，先记录一次：
  // 1. 鼠标起点
  // 2. 窗口起点
  // 后续移动都基于这两个锚点重新计算。
  if (!petWindow || petWindow.isDestroyed()) {
    return null;
  }

  const [windowX, windowY] = petWindow.getPosition();
  const cursorDipPoint = screen.getCursorScreenPoint();
  const startPoint = toPhysicalPoint(cursorDipPoint);
  const windowPhysicalPoint = toPhysicalPoint({ x: windowX, y: windowY });
  activePetDrag = {
    cursorX: startPoint.x,
    cursorY: startPoint.y,
    windowX,
    windowY,
    windowPhysicalX: windowPhysicalPoint.x,
    windowPhysicalY: windowPhysicalPoint.y,
    windowSize: getPetWindowSize()
  };
  return activePetDrag;
});

ipcMain.handle("pet:updateDrag", (_event, point) => {
  // 这里不再累加渲染层传来的很多个小 dx / dy，
  // 而是在主进程直接读取当前鼠标位置，再反推出窗口的新位置。
  // 这样跨屏时不容易出现误差越积越大的问题。
  if (!petWindow || petWindow.isDestroyed() || !activePetDrag) {
    return null;
  }

  const currentPoint = toPhysicalPoint(screen.getCursorScreenPoint());
  const nextPhysicalPoint = {
    x: Math.round(activePetDrag.windowPhysicalX + (currentPoint.x - activePetDrag.cursorX)),
    y: Math.round(activePetDrag.windowPhysicalY + (currentPoint.y - activePetDrag.cursorY))
  };
  const nextPosition = toDipPoint(nextPhysicalPoint);
  petWindow.setPosition(nextPosition.x, nextPosition.y, false);
  appState.petWindowPosition = nextPosition;
  syncBubbleWindowBounds();
  return appState.petWindowPosition;
});

ipcMain.handle("pet:endDrag", () => {
  // 鼠标松开或丢失捕获时，清理本次拖拽记录。
  if (petWindow && !petWindow.isDestroyed()) {
    const [x, y] = petWindow.getPosition();
    const petSize = getPetWindowSize();
    const finalPosition = getClampedPetWindowPosition(
      { x, y },
      {
        windowSize: petSize,
        display: getDisplayForWindowBounds({
          x,
          y,
          width: petSize.width,
          height: petSize.height
        }) || getDisplayForSavedPosition({ x, y }) || screen.getPrimaryDisplay()
      }
    );
    petWindow.setPosition(finalPosition.x, finalPosition.y, false);
    appState.petWindowPosition = finalPosition;
    syncBubbleWindowBounds();
  }
  activePetDrag = null;
  cachedActiveDisplay = null;
  return true;
});

ipcMain.handle("pet:setInteractionLock", (_event, value) => {
  petInteractionLocked = Boolean(value);
  if (!petInteractionLocked) {
    setPetWindowMouseIgnore(false);
  }
  return petInteractionLocked;
});
