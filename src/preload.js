const { contextBridge, ipcRenderer } = require("electron");

// preload 是 Electron 里很重要的一层“安全中间层”。
// 页面脚本（pet.js / settings.js / bubble.js）不能直接访问 Node.js 和 Electron API，
// 所以我们把“允许页面调用的能力”统一挂到 window.littlePets 上。
// 这样做有两个好处：
// 1. 更安全：页面拿不到完整的系统权限。
// 2. 更清晰：渲染层只通过这一组固定接口和主进程通信。
contextBridge.exposeInMainWorld("littlePets", {
  // 应用窗口相关
  showSettings: () => ipcRenderer.invoke("app:showSettings"),
  hideSettings: () => ipcRenderer.invoke("app:hideSettings"),
  quit: () => ipcRenderer.invoke("app:quit"),

  // 宠物资源相关
  listPets: () => ipcRenderer.invoke("pets:list"),
  getSelectedPet: () => ipcRenderer.invoke("pets:getSelected"),
  setSelectedPet: (petId) => ipcRenderer.invoke("pets:setSelected", petId),

  // 全局状态读取
  getState: () => ipcRenderer.invoke("state:get"),

  // 设置项修改
  setLaunchOnStartup: (value) => ipcRenderer.invoke("app:setLaunchOnStartup", value),
  setPetVisible: (value) => ipcRenderer.invoke("pet:setVisible", value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("pet:setAlwaysOnTop", value),
  setBubbleVisible: (value) => ipcRenderer.invoke("pet:setBubbleVisible", value),
  setPetScale: (value) => ipcRenderer.invoke("pet:setScale", value),

  // 拖拽宠物时，渲染层只负责“发起 / 刷新 / 结束拖拽”，
  // 真正的位置计算放在主进程里做，跨屏时会更稳定。
  startPetDrag: (point) => ipcRenderer.invoke("pet:startDrag", point),
  updatePetDrag: (point) => ipcRenderer.invoke("pet:updateDrag", point),
  endPetDrag: () => ipcRenderer.invoke("pet:endDrag"),

  // 这个接口保留给“按增量移动”场景使用，
  // 目前主要拖拽已经走 start / update / end 这套逻辑。
  movePetBy: (delta) => ipcRenderer.invoke("pet:moveBy", delta),
  setPetInteractionLock: (value) => ipcRenderer.invoke("pet:setInteractionLock", value),

  // 对话气泡控制
  showBubble: (payload) => ipcRenderer.invoke("bubble:show", payload),
  hideBubble: () => ipcRenderer.invoke("bubble:hide"),

  // 下面是事件订阅接口。
  // 主进程状态变化后会主动推送，页面收到后刷新界面。
  onSelectedPet: (callback) => {
    ipcRenderer.on("pet:selected", (_event, pet) => callback(pet));
  },
  onStateChanged: (callback) => {
    ipcRenderer.on("state:changed", (_event, state) => callback(state));
  },
  onDragDirection: (callback) => {
    ipcRenderer.on("pet:dragDirection", (_event, payload) => callback(payload));
  },
  onDragStop: (callback) => {
    ipcRenderer.on("pet:dragStop", () => callback());
  },
  onBubbleShow: (callback) => {
    ipcRenderer.on("bubble:show", (_event, payload) => callback(payload));
  },
  onBubbleHide: (callback) => {
    ipcRenderer.on("bubble:hide", () => callback());
  }
});
