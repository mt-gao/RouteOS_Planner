export function createPeopleCountStep(config: { initialValue: number; onSelect: (count: number) => void }) {
  const container = document.createElement("div");
  container.className = "step-content people-count-step";

  const pickerContainer = document.createElement("div");
  pickerContainer.className = "picker-container";

  const wheel = document.createElement("div");
  wheel.className = "picker-wheel";

  const highlight = document.createElement("div");
  highlight.className = "picker-highlight";

  const countDisplay = document.createElement("div");
  countDisplay.className = "count-display";
  countDisplay.innerHTML = `<span class="count-number">${config.initialValue}</span> <span class="count-label">人</span>`;

  // 生成2-12人的选项
  const minPeople = 2;
  const maxPeople = 12;
  let selectedIndex = config.initialValue - minPeople;
  const paddingCount = 2; // 上下各添加2个占位项

  // 添加上方的占位项
  for (let i = 0; i < paddingCount; i++) {
    const placeholder = document.createElement("div");
    placeholder.className = "picker-item picker-placeholder";
    placeholder.textContent = "";
    wheel.appendChild(placeholder);
  }

  // 添加实际可选的数字项
  for (let i = minPeople; i <= maxPeople; i++) {
    const item = document.createElement("div");
    item.className = "picker-item";
    item.textContent = String(i);
    item.dataset.value = String(i);
    wheel.appendChild(item);
  }

  // 添加下方的占位项
  for (let i = 0; i < paddingCount; i++) {
    const placeholder = document.createElement("div");
    placeholder.className = "picker-item picker-placeholder";
    placeholder.textContent = "";
    wheel.appendChild(placeholder);
  }

  pickerContainer.appendChild(wheel);
  pickerContainer.appendChild(highlight);

  container.appendChild(pickerContainer);
  container.appendChild(countDisplay);

  // 更新选中状态
  function updateSelection() {
    const items = wheel.querySelectorAll(".picker-item");
    items.forEach((item, index) => {
      const actualIndex = index - paddingCount; // 调整索引（跳过占位项）
      if (actualIndex === selectedIndex && !item.classList.contains("picker-placeholder")) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });

    // 滚动到选中项 - 顶部对齐，不需要额外计算
    const itemHeight = 60;
    const targetPosition = -(selectedIndex + paddingCount) * itemHeight;
    wheel.style.transform = `translateY(${targetPosition}px)`;

    // 更新显示
    countDisplay.querySelector(".count-number")!.textContent = String(selectedIndex + minPeople);
    config.onSelect(selectedIndex + minPeople);
  }

  // 触摸滑动支持
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let velocity = 0;
  let lastY = 0;
  let lastTime = 0;
  let animationId: number | null = null;

  function scrollToIndex(index: number, animate = true) {
    index = Math.max(0, Math.min(maxPeople - minPeople, index));
    selectedIndex = index;

    if (animate) {
      wheel.style.transition = "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
      updateSelection();
      setTimeout(() => {
        wheel.style.transition = "";
      }, 300);
    } else {
      wheel.style.transition = "none";
      updateSelection();
    }
  }

  wheel.addEventListener("touchstart", (e) => {
    isDragging = true;
    startY = e.touches[0].clientY;
    currentY = startY;
    lastY = startY;
    lastTime = Date.now();
    velocity = 0;
    wheel.style.transition = "none";

    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }, { passive: true });

  wheel.addEventListener("touchmove", (e) => {
    if (!isDragging) return;

    const y = e.touches[0].clientY;
    const deltaY = y - lastY;
    const now = Date.now();
    const deltaTime = now - lastTime;

    velocity = deltaY / Math.max(deltaTime, 1);
    lastY = y;
    lastTime = now;
    currentY = y;

    const itemHeight = 60;
    const offset = currentY - startY;
    const basePosition = -(selectedIndex + paddingCount) * itemHeight;
    const newOffset = basePosition + offset;

    wheel.style.transform = `translateY(${newOffset}px)`;
  }, { passive: true });

  wheel.addEventListener("touchend", () => {
    if (!isDragging) return;
    isDragging = false;

    const itemHeight = 60;
    const offset = currentY - startY;
    const rawIndex = Math.round(selectedIndex - offset / itemHeight);

    // 惯性滚动
    if (Math.abs(velocity) > 0.5) {
      const momentumIndex = Math.round(selectedIndex - velocity * 10);
      scrollToIndex(momentumIndex);
    } else {
      scrollToIndex(rawIndex);
    }
  }, { passive: true });

  // 鼠标滚轮支持
  wheel.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    scrollToIndex(selectedIndex + delta);
  }, { passive: false });

  // 点击选择（忽略占位项）
  wheel.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".picker-item");
    if (item && !item.classList.contains("picker-placeholder")) {
      const index = Array.from(wheel.children).indexOf(item) - paddingCount;
      scrollToIndex(index);
    }
  });

  // 初始化 - 顶部对齐，直接设置位置
  wheel.style.transition = "none";
  updateSelection();

  return { element: container };
}
