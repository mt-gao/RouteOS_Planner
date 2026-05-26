export function createTimePicker(config: {
  initialHour?: number;
  initialMinute?: number;
  onSelect: (hour: number, minute: number) => void;
}) {
  const container = document.createElement("div");
  container.className = "time-picker-container";

  const hour = config.initialHour ?? 9;
  const minute = config.initialMinute ?? 0;

  const wrapper = document.createElement("div");
  wrapper.className = "time-picker-wrapper";

  // 小时滚轮
  const hourColumn = document.createElement("div");
  hourColumn.className = "time-picker-column";

  const hourWheel = document.createElement("div");
  hourWheel.className = "time-picker-wheel";

  const hourHighlight = document.createElement("div");
  hourHighlight.className = "time-picker-highlight";

  for (let i = 0; i <= 23; i++) {
    const item = document.createElement("div");
    item.className = "time-picker-item";
    item.textContent = String(i).padStart(2, "0");
    item.dataset.value = String(i);
    hourWheel.appendChild(item);
  }

  hourColumn.appendChild(hourWheel);
  hourColumn.appendChild(hourHighlight);

  // 分钟滚轮
  const minuteColumn = document.createElement("div");
  minuteColumn.className = "time-picker-column";

  const minuteWheel = document.createElement("div");
  minuteWheel.className = "time-picker-wheel";

  const minuteHighlight = document.createElement("div");
  minuteHighlight.className = "time-picker-highlight";

  for (let i = 0; i <= 59; i++) {
    const item = document.createElement("div");
    item.className = "time-picker-item";
    item.textContent = String(i).padStart(2, "0");
    item.dataset.value = String(i);
    minuteWheel.appendChild(item);
  }

  minuteColumn.appendChild(minuteWheel);
  minuteColumn.appendChild(minuteHighlight);

  // 分隔符
  const separator = document.createElement("div");
  separator.className = "time-picker-separator";
  separator.textContent = ":";

  wrapper.appendChild(hourColumn);
  wrapper.appendChild(separator);
  wrapper.appendChild(minuteColumn);

  // 时间显示
  const timeDisplay = document.createElement("div");
  timeDisplay.className = "time-picker-display";
  timeDisplay.innerHTML = `
    <span class="time-display-value">${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}</span>
    <span class="time-display-label">到达时间</span>
  `;

  container.appendChild(wrapper);
  container.appendChild(timeDisplay);

  // 状态
  let selectedHour = hour;
  let selectedMinute = minute;
  const itemHeight = 50;

  // 初始化滚轮位置
  function initWheel(wheel: HTMLElement, selectedIndex: number) {
    const offset = -selectedIndex * itemHeight;
    wheel.style.transform = `translateY(${offset}px)`;

    const items = wheel.querySelectorAll(".time-picker-item");
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });
  }

  // 滚动到指定索引
  function scrollToIndex(wheel: HTMLElement, index: number, total: number) {
    index = Math.max(0, Math.min(total - 1, index));
    const offset = -index * itemHeight;
    wheel.style.transition = "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
    wheel.style.transform = `translateY(${offset}px)`;

    const items = wheel.querySelectorAll(".time-picker-item");
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });

    setTimeout(() => {
      wheel.style.transition = "";
    }, 300);
  }

  // 绑定触摸事件
  function bindWheelEvents(wheel: HTMLElement, total: number, isHour: boolean) {
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    let velocity = 0;
    let lastY = 0;
    let lastTime = 0;

    const getCurrentIndex = () => isHour ? selectedHour : selectedMinute;

    wheel.addEventListener("touchstart", (e) => {
      isDragging = true;
      startY = e.touches[0].clientY;
      currentY = startY;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
      wheel.style.transition = "";
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

      const currentIndex = getCurrentIndex();
      const offset = -currentIndex * itemHeight + (currentY - startY);
      wheel.style.transform = `translateY(${offset}px)`;
    }, { passive: true });

    wheel.addEventListener("touchend", () => {
      if (!isDragging) return;
      isDragging = false;

      const currentIndex = getCurrentIndex();
      const offset = currentY - startY;
      let newIndex = Math.round(currentIndex - offset / itemHeight);

      // 惯性滚动
      if (Math.abs(velocity) > 0.5) {
        newIndex = Math.round(currentIndex - velocity * 10);
      }

      newIndex = Math.max(0, Math.min(total - 1, newIndex));

      if (isHour) {
        selectedHour = newIndex;
      } else {
        selectedMinute = newIndex;
      }

      scrollToIndex(wheel, newIndex, total);
      updateDisplay();
      config.onSelect(selectedHour, selectedMinute);
    }, { passive: true });

    // 鼠标滚轮支持
    wheel.addEventListener("wheel", (e) => {
      e.preventDefault();
      const currentIndex = getCurrentIndex();
      const delta = e.deltaY > 0 ? 1 : -1;
      const newIndex = Math.max(0, Math.min(total - 1, currentIndex + delta));

      if (isHour) {
        selectedHour = newIndex;
      } else {
        selectedMinute = newIndex;
      }

      scrollToIndex(wheel, newIndex, total);
      updateDisplay();
      config.onSelect(selectedHour, selectedMinute);
    }, { passive: false });

    // 点击选择
    wheel.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".time-picker-item");
      if (item) {
        const index = Array.from(wheel.children).indexOf(item);
        if (index >= 0) {
          if (isHour) {
            selectedHour = index;
          } else {
            selectedMinute = index;
          }

          scrollToIndex(wheel, index, total);
          updateDisplay();
          config.onSelect(selectedHour, selectedMinute);
        }
      }
    });
  }

  function updateDisplay() {
    const displayValue = timeDisplay.querySelector(".time-display-value")!;
    displayValue.textContent = `${String(selectedHour).padStart(2, "0")}:${String(selectedMinute).padStart(2, "0")}`;
  }

  // 初始化
  initWheel(hourWheel, selectedHour);
  initWheel(minuteWheel, selectedMinute);

  // 绑定事件
  bindWheelEvents(hourWheel, 24, true);
  bindWheelEvents(minuteWheel, 60, false);

  // 初始回调
  config.onSelect(selectedHour, selectedMinute);

  return {
    element: container,
    getValue: () => ({ hour: selectedHour, minute: selectedMinute }),
    setValue: (hour: number, minute: number) => {
      selectedHour = hour;
      selectedMinute = minute;
      initWheel(hourWheel, selectedHour);
      initWheel(minuteWheel, selectedMinute);
      updateDisplay();
    }
  };
}
