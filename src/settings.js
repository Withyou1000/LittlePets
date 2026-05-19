// settings.js 负责“设置窗口”的页面交互。
// 它不直接接触文件系统，也不直接调用 Electron API。
// 页面只通过 preload.js 暴露出来的安全桥接接口和主进程通信。

const petList = document.querySelector("#petList");
const petCount = document.querySelector("#petCount");
const selectedName = document.querySelector("#selectedName");
const selectedDescription = document.querySelector("#selectedDescription");
const previewSprite = document.querySelector("#previewSprite");
const togglePetButton = document.querySelector("#togglePetButton");
const hideWindowButton = document.querySelector("#hideWindowButton");
const visibilityButton = document.querySelector("#visibilityButton");
const topButton = document.querySelector("#topButton");
const startupToggle = document.querySelector("#startupToggle");
const bubbleToggle = document.querySelector("#bubbleToggle");
const scaleRange = document.querySelector("#scaleRange");
const scaleValue = document.querySelector("#scaleValue");

let pets = [];
let selectedPet = null;

// 这是设置页里缓存的一份状态副本，方便当前页面渲染。
// 真正的权威状态仍然保存在主进程里。
let state = {
  petVisible: true,
  alwaysOnTop: true,
  launchOnStartup: false,
  bubbleVisible: true,
  petScale: 1
};

function renderPreview(pet) {
  if (!pet) {
    previewSprite.style.backgroundImage = "";
    selectedName.textContent = "没有可用宠物";
    selectedDescription.textContent = "请检查项目里的 pets 文件夹。";
    return;
  }

  selectedName.textContent = pet.displayName;
  selectedDescription.textContent = pet.description || "这只宠物暂时还没有描述。";

  // 精灵图里包含很多动画帧。
  // 设置页预览只显示左上角的第一帧。
  previewSprite.style.backgroundImage = `url("${pet.spritesheetUrl}")`;
  previewSprite.style.backgroundPosition = "0 0";
}

function renderState() {
  // 把当前状态同步到所有按钮、开关和文本上。
  togglePetButton.textContent = state.petVisible ? "隐藏桌宠" : "显示桌宠";
  visibilityButton.textContent = state.petVisible ? "隐藏" : "显示";
  topButton.textContent = state.alwaysOnTop ? "已置顶" : "未置顶";
  topButton.classList.toggle("primary", state.alwaysOnTop);
  startupToggle.checked = Boolean(state.launchOnStartup);
  bubbleToggle.checked = state.bubbleVisible !== false;

  const scalePercent = Math.round((Number(state.petScale) || 1) * 100);
  scaleRange.value = String(scalePercent);
  scaleValue.textContent = `${scalePercent}%`;
}

function renderPets() {
  // 这个列表数据量很小，所以直接整块重绘最直观，
  // 比维护复杂的局部更新逻辑更适合初学者阅读。
  petList.innerHTML = "";
  petCount.textContent = `${pets.length} 只`;

  pets.forEach((pet) => {
    const button = document.createElement("button");
    button.className = "pet-card";
    button.type = "button";
    button.classList.toggle("is-selected", selectedPet?.id === pet.id);
    button.innerHTML = `
      <span class="card-sprite" style="background-image: url('${pet.spritesheetUrl}')"></span>
      <span class="card-copy">
        <strong>${pet.displayName}</strong>
        <small>${pet.id}</small>
      </span>
    `;

    button.addEventListener("click", async () => {
      // 真正的切换动作在主进程里完成，
      // 这里等待主进程返回新结果后再重绘页面。
      selectedPet = await window.littlePets.setSelectedPet(pet.id);
      renderPreview(selectedPet);
      renderPets();
    });

    petList.appendChild(button);
  });
}

async function boot() {
  // 页面启动时并行读取初始数据，避免一个一个等待。
  const [loadedPets, loadedPet, loadedState] = await Promise.all([
    window.littlePets.listPets(),
    window.littlePets.getSelectedPet(),
    window.littlePets.getState()
  ]);

  pets = loadedPets;
  selectedPet = loadedPet;
  state = { ...state, ...loadedState };

  renderPreview(selectedPet);
  renderPets();
  renderState();
}

togglePetButton.addEventListener("click", async () => {
  state.petVisible = await window.littlePets.setPetVisible(!state.petVisible);
  renderState();
});

visibilityButton.addEventListener("click", async () => {
  state.petVisible = await window.littlePets.setPetVisible(!state.petVisible);
  renderState();
});

topButton.addEventListener("click", async () => {
  state.alwaysOnTop = await window.littlePets.setAlwaysOnTop(!state.alwaysOnTop);
  renderState();
});

startupToggle.addEventListener("change", async () => {
  state.launchOnStartup = await window.littlePets.setLaunchOnStartup(startupToggle.checked);
  renderState();
});

bubbleToggle.addEventListener("change", async () => {
  state.bubbleVisible = await window.littlePets.setBubbleVisible(bubbleToggle.checked);
  renderState();
});

scaleRange.addEventListener("input", async () => {
  // 滑杆显示的是百分比，程序内部保存的是缩放倍数。
  const scale = Number(scaleRange.value) / 100;
  scaleValue.textContent = `${scaleRange.value}%`;
  state.petScale = await window.littlePets.setPetScale(scale);
  renderState();
});

hideWindowButton.addEventListener("click", () => {
  window.littlePets.hideSettings();
});

window.littlePets.onSelectedPet((pet) => {
  // 如果别的窗口改了当前宠物，设置页也要同步更新。
  selectedPet = pet;
  renderPreview(selectedPet);
  renderPets();
});

window.littlePets.onStateChanged((nextState) => {
  // 只把主进程发来的变化字段合并进来，其他字段保持原值。
  state = { ...state, ...nextState };
  renderState();
});

boot();
