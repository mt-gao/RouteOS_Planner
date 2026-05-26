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

  for (let i = minPeople; i <= maxPeople; i++) {
    const item = document.createElement("div");
    item.className = "picker-item";
    item.textContent = String(i);
    item.dataset.value = String(i);
    wheel.appendChild(item);
  }

  pickerContainer.appendChild(wheel);
  pickerContainer.appendChild(highlight);

  container.appendChild(pickerContainer);
  container.appendChild(countDisplay);

  // 更新选中状态
  function updateSelection() {
    const items = wheel.querySelectorAll(".picker-item");
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });

    // 滚动到选中项 - 向上滑动时需要向上移动 wheel（负值）
    const itemHeight = 60;
    wheel.style.transform = `translateY(${-selectedIndex * itemHeight}px)`;

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
    } else {
      wheel.style.transition = "none";
    }

    updateSelection();

    setTimeout(() => {
      wheel.style.transition = "";
    }, 300);
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
    const newOffset = -selectedIndex * itemHeight + offset;

    wheel.style.transform = `translateY(${newOffset}px)`;
  }, { passive: true });

  wheel.addEventListener("touchend", () => {
    if (!isDragging) return;
    isDragging = false;

    const itemHeight = 60;
    const offset = currentY - startY;
    const newIndex = Math.round(selectedIndex - offset / itemHeight);

    // 惯性滚动
    if (Math.abs(velocity) > 0.5) {
      const momentumIndex = Math.round(selectedIndex - velocity * 10);
      scrollToIndex(momentumIndex);
    } else {
      scrollToIndex(newIndex);
    }
  }, { passive: true });

  // 鼠标滚轮支持
  wheel.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    scrollToIndex(selectedIndex + delta);
  }, { passive: false });

  // 点击选择
  wheel.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".picker-item");
    if (item) {
      const index = Array.from(wheel.children).indexOf(item);
      scrollToIndex(index);
    }
  });

  // 初始化
  updateSelection();

  return { element: container };
}
