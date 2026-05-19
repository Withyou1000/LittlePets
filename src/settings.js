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
    selectedDescription.textContent = "请检查项目内的 pets 目录。";
    return;
  }

  selectedName.textContent = pet.displayName;
  selectedDescription.textContent = pet.description || "这个宠物还没有描述。";
  previewSprite.style.backgroundImage = `url("${pet.spritesheetUrl}")`;
  previewSprite.style.backgroundPosition = "0 0";
}

function renderState() {
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
      selectedPet = await window.littlePets.setSelectedPet(pet.id);
      renderPreview(selectedPet);
      renderPets();
    });

    petList.appendChild(button);
  });
}

async function boot() {
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
  const scale = Number(scaleRange.value) / 100;
  scaleValue.textContent = `${scaleRange.value}%`;
  state.petScale = await window.littlePets.setPetScale(scale);
  renderState();
});

hideWindowButton.addEventListener("click", () => {
  window.littlePets.hideSettings();
});

window.littlePets.onSelectedPet((pet) => {
  selectedPet = pet;
  renderPreview(selectedPet);
  renderPets();
});

window.littlePets.onStateChanged((nextState) => {
  state = { ...state, ...nextState };
  renderState();
});

boot();
