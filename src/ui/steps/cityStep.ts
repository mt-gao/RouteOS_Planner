const POPULAR_CITIES = [
  "深圳", "北京", "上海", "广州", "杭州", "成都", "重庆", "武汉", "西安"
];

export function createCityStep(config: { initialValue: string; onSelect: (city: string) => void }) {
  const container = document.createElement("div");
  container.className = "step-content city-step";

  // 常用城市网格
  const grid = document.createElement("div");
  grid.className = "city-grid";

  let selectedCity = config.initialValue;

  // 更新选中状态函数
  function updateSelection(city: string) {
    selectedCity = city;
    // 清除所有城市按钮的选中态
    grid.querySelectorAll(".city-option").forEach(b => b.classList.remove("selected"));
    // 如果是常用城市且输入框为空，添加选中态
    if (POPULAR_CITIES.includes(city) && input.value.trim() === "") {
      const cityButton = Array.from(grid.querySelectorAll(".city-option")).find(
        btn => btn.textContent === city
      );
      if (cityButton) {
        cityButton.classList.add("selected");
      }
    }
    config.onSelect(city);
  }

  // 创建城市按钮
  POPULAR_CITIES.forEach(city => {
    const button = document.createElement("button");
    button.className = "city-option";
    button.textContent = city;

    button.addEventListener("click", () => {
      input.value = "";
      updateSelection(city);
    });

    grid.appendChild(button);
  });

  // 输入区域
  const inputWrapper = document.createElement("div");
  inputWrapper.className = "city-input-wrapper";

  const inputGroup = document.createElement("div");
  inputGroup.className = "city-input-group";
  inputGroup.innerHTML = `
    <label class="field-label">其他城市</label>
  `;

  const inputContainer = document.createElement("div");
  inputContainer.className = "city-input-container";

  const input = document.createElement("input");
  input.className = "city-input";
  input.type = "text";
  input.placeholder = "输入城市名称";

  const clearButton = document.createElement("button");
  clearButton.className = "city-input-clear";
  clearButton.type = "button";
  clearButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  `;

  inputContainer.appendChild(input);
  inputContainer.appendChild(clearButton);
  inputGroup.appendChild(inputContainer);
  inputWrapper.appendChild(inputGroup);

  // 输入事件：优先输入框为准
  input.addEventListener("input", () => {
    const value = input.value.trim();
    // 清除所有城市按钮激活态
    grid.querySelectorAll(".city-option").forEach(b => b.classList.remove("selected"));

    if (value) {
      config.onSelect(value);
    } else {
      // 输入框清空时，默认选择深圳
      config.onSelect("深圳");
    }
  });

  // 清空按钮事件
  clearButton.addEventListener("click", () => {
    input.value = "";
    input.focus();
    // 清空后默认选择深圳，但不填充输入框
    config.onSelect("深圳");
  });

  // 初始化
  const initialCity = config.initialValue || "深圳";
  // 如果是常用城市，输入框为空；否则显示城市名
  input.value = POPULAR_CITIES.includes(initialCity) ? "" : initialCity;
  updateSelection(initialCity);

  container.appendChild(grid);
  container.appendChild(inputWrapper);

  return { element: container };
}
