const bubble = document.querySelector("#bubble");
const bubbleText = document.querySelector("#bubbleText");

// 气泡窗口非常“傻”：
// 它自己不决定什么时候显示什么内容，
// 只是被动等待主进程转发过来的显示 / 隐藏事件。
// 这样桌宠行为逻辑都集中在 pet.js / main.js 里，bubble.js 只管渲染。
window.littlePets.onBubbleShow((payload) => {
  // 先切到“切换中”状态，配合 CSS 做淡入和过渡动画。
  bubble.classList.add("is-changing");
  bubble.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    // 在动画中途替换文字，可以减少突然跳字带来的突兀感。
    bubbleText.textContent = payload?.message || "";
    bubble.classList.remove("is-changing");
    bubble.classList.add("is-visible");
  }, 140);
});

window.littlePets.onBubbleHide(() => {
  // 隐藏时把过渡相关 class 一起清掉，下一次显示时状态才干净。
  bubble.classList.remove("is-changing", "is-visible");
  bubble.setAttribute("aria-hidden", "true");
});
