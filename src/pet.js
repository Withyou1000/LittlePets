const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;

const animations = {
  idle: {
    row: 0,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [900, 320, 320, 420, 420, 980]
  },
  "running-right": {
    row: 1,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [170, 170, 170, 170, 170, 170, 170, 280]
  },
  "running-left": {
    row: 2,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [170, 170, 170, 170, 170, 170, 170, 280]
  },
  waving: {
    row: 3,
    frames: [0, 1, 2, 3],
    durations: [240, 240, 240, 420]
  },
  jumping: {
    row: 4,
    frames: [0, 1, 2, 3, 4],
    durations: [280, 240, 220, 240, 380]
  },
  failed: {
    row: 5,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [220, 220, 220, 220, 220, 220, 220, 340]
  },
  waiting: {
    row: 6,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [220, 220, 220, 220, 220, 360]
  },
  running: {
    row: 7,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [220, 220, 220, 220, 220, 340]
  },
  review: {
    row: 8,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [260, 260, 260, 260, 260, 380]
  }
};

const hoverAnimations = ["waving", "jumping", "failed", "waiting", "running", "review"];
const encouragements = [
  "今天先慢慢来，也算是在认真生活。",
  "不用一下子变得很厉害，能开始就已经很好了。",
  "你已经撑过很多难的时候，这一次也可以一点点走过去。",
  "我在这里陪你，把眼前这一小步做好就够了。",
  "别急着责怪自己，先给自己一点呼吸的空间。",
  "喝口水吧，照顾自己不是偷懒。",
  "先做 10 分钟就好，专注不需要一口气用完。"
];

const bubble = document.querySelector("#bubble");
const bubbleText = document.querySelector("#bubbleText");
const petButton = document.querySelector("#petButton");
const petSprite = document.querySelector("#petSprite");

let currentAnimation = "idle";
let frameIndex = 0;
let animationTimer = null;
let messageTimer = null;
let hideBubbleTimer = null;
let lastMessage = "";
let dragState = null;
let isFinishing = false;
let bubbleEnabled = true;
let pendingMove = null;
let moveFrameId = null;

function hideBubble() {
  window.clearTimeout(hideBubbleTimer);
  bubble.classList.remove("is-changing", "is-visible");
  bubble.setAttribute("aria-hidden", "true");
}

function applyState(state) {
  const scale = Math.min(1.4, Math.max(0.35, Number(state?.petScale) || 1));
  document.documentElement.style.setProperty("--pet-scale", String(scale));

  const nextBubbleEnabled = state?.bubbleVisible !== false;

  if (bubbleEnabled !== nextBubbleEnabled) {
    bubbleEnabled = nextBubbleEnabled;

    if (!bubbleEnabled) {
      hideBubble();
    } else {
      restartMessageTimer();
      showMessage(pickMessage(), 6500);
    }
  }
}

function renderFrame(animationName, index) {
  const animation = animations[animationName];

  if (!animation) {
    return;
  }

  const frame = animation.frames[index];
  petSprite.style.backgroundPosition = `-${frame * CELL_WIDTH}px -${animation.row * CELL_HEIGHT}px`;
}

function playAnimation(animationName, options = {}) {
  const animation = animations[animationName];

  if (!animation) {
    return;
  }

  window.clearTimeout(animationTimer);
  currentAnimation = animationName;
  frameIndex = 0;
  let loopsDone = 0;
  const repeat = Number.isFinite(options.repeat) ? options.repeat : Infinity;
  const returnTo = options.returnTo || "idle";
  renderFrame(currentAnimation, frameIndex);

  const step = () => {
    const current = animations[currentAnimation];
    const duration = current.durations[frameIndex] ?? 220;

    animationTimer = window.setTimeout(() => {
      frameIndex += 1;

      if (frameIndex >= current.frames.length) {
        loopsDone += 1;

        if (loopsDone >= repeat) {
          playAnimation(returnTo);
          return;
        }

        frameIndex = 0;
      }

      renderFrame(currentAnimation, frameIndex);
      step();
    }, duration);
  };

  step();
}

function pickMessage() {
  let next = encouragements[Math.floor(Math.random() * encouragements.length)];

  while (encouragements.length > 1 && next === lastMessage) {
    next = encouragements[Math.floor(Math.random() * encouragements.length)];
  }

  lastMessage = next;
  return next;
}

function showMessage(message = pickMessage(), duration = 9000) {
  if (!bubbleEnabled) {
    return;
  }

  window.clearTimeout(hideBubbleTimer);
  bubble.classList.add("is-changing");
  bubble.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    bubbleText.textContent = message;
    bubble.classList.remove("is-changing");
    bubble.classList.add("is-visible");
  }, 140);

  hideBubbleTimer = window.setTimeout(() => {
    hideBubble();
  }, duration);
}

function restartMessageTimer() {
  window.clearInterval(messageTimer);
  messageTimer = window.setInterval(() => {
    if (!bubbleEnabled) {
      return;
    }

    showMessage();
    playAnimation("waiting", { repeat: 1, returnTo: "idle" });
  }, 45000);
}

async function applyPet(pet) {
  if (!pet) {
    showMessage("没有找到可用宠物，去设置里检查一下资源路径吧。", 12000);
    return;
  }

  petSprite.style.backgroundImage = `url("${pet.spritesheetUrl}")`;
  playAnimation("idle");
}

function interactWithPet() {
  showMessage(pickMessage(), 8000);
}

function pickHoverAnimation() {
  return hoverAnimations[Math.floor(Math.random() * hoverAnimations.length)];
}

function flushPendingMove() {
  moveFrameId = null;

  if (!pendingMove) {
    return;
  }

  const { x, y } = pendingMove;
  pendingMove = null;

  if (x !== 0 || y !== 0) {
    window.littlePets.movePetBy({ x, y });
  }
}

function queueMove(dx, dy) {
  if (!pendingMove) {
    pendingMove = { x: 0, y: 0 };
  }

  pendingMove.x += dx;
  pendingMove.y += dy;

  if (moveFrameId === null) {
    moveFrameId = window.requestAnimationFrame(flushPendingMove);
  }
}

function finishDrag({ treatAsClick = false } = {}) {
  if (!dragState || isFinishing) {
    return;
  }

  isFinishing = true;
  if (moveFrameId !== null) {
    window.cancelAnimationFrame(moveFrameId);
    flushPendingMove();
  }
  const { pointerId, total } = dragState;
  dragState = null;

  try {
    petButton.releasePointerCapture(pointerId);
  } catch (e) {
  }

  window.littlePets.setPetInteractionLock(false);
  isFinishing = false;

  if (treatAsClick || total < 6) {
    interactWithPet();
    return;
  }

  playAnimation("idle");
}

petButton.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.littlePets.showSettings();
});

petButton.addEventListener("pointerenter", () => {
  if (dragState || currentAnimation !== "idle") {
    return;
  }

  playAnimation(pickHoverAnimation(), { repeat: 3, returnTo: "idle" });
});

petButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  dragState = {
    pointerId: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    total: 0,
    direction: null
  };
  petButton.setPointerCapture(event.pointerId);
  window.littlePets.setPetInteractionLock(true);
});

petButton.addEventListener("pointermove", (event) => {
  if (!dragState) {
    return;
  }

  const dx = event.screenX - dragState.x;
  const dy = event.screenY - dragState.y;

  if (dx === 0 && dy === 0) {
    return;
  }

  dragState.x = event.screenX;
  dragState.y = event.screenY;
  dragState.total += Math.abs(dx) + Math.abs(dy);

  const nextDirection = dx > 0 ? "running-right" : "running-left";

  if (dragState.direction !== nextDirection) {
    dragState.direction = nextDirection;
    playAnimation(nextDirection);
  }

  queueMove(dx, dy);
});

petButton.addEventListener("pointerup", () => {
  finishDrag();
});

petButton.addEventListener("pointercancel", () => {
  finishDrag();
});

petButton.addEventListener("lostpointercapture", () => {
  finishDrag();
});

window.littlePets.onSelectedPet((pet) => {
  applyPet(pet);
});

window.littlePets.onStateChanged((state) => {
  applyState(state);
});

window.littlePets.getState().then(applyState);
window.littlePets.getSelectedPet().then(applyPet);
showMessage(pickMessage(), 6500);
restartMessageTimer();
