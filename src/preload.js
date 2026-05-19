const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("littlePets", {
  showSettings: () => ipcRenderer.invoke("app:showSettings"),
  hideSettings: () => ipcRenderer.invoke("app:hideSettings"),
  quit: () => ipcRenderer.invoke("app:quit"),
  listPets: () => ipcRenderer.invoke("pets:list"),
  getSelectedPet: () => ipcRenderer.invoke("pets:getSelected"),
  setSelectedPet: (petId) => ipcRenderer.invoke("pets:setSelected", petId),
  getState: () => ipcRenderer.invoke("state:get"),
  setLaunchOnStartup: (value) => ipcRenderer.invoke("app:setLaunchOnStartup", value),
  setPetVisible: (value) => ipcRenderer.invoke("pet:setVisible", value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("pet:setAlwaysOnTop", value),
  setBubbleVisible: (value) => ipcRenderer.invoke("pet:setBubbleVisible", value),
  setPetScale: (value) => ipcRenderer.invoke("pet:setScale", value),
  movePetBy: (delta) => ipcRenderer.invoke("pet:moveBy", delta),
  setPetInteractionLock: (value) => ipcRenderer.invoke("pet:setInteractionLock", value),
  onSelectedPet: (callback) => {
    ipcRenderer.on("pet:selected", (_event, pet) => callback(pet));
  },
  onStateChanged: (callback) => {
    ipcRenderer.on("state:changed", (_event, state) => callback(state));
  }
});
