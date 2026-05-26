import { createAddressInput } from "../addressInput";
import { createTimePicker } from "../timePicker";
import type { Suggestion, TimeConstraint } from "../../types";

export function createDestinationStep(config: {
  city: string;
  initialValue: Suggestion | null;
  initialValueInput: string;
  initialTimeConstraint: TimeConstraint | null;
  onSelect: (destination: Suggestion | null) => void;
  onTimeChange: (timeConstraint: TimeConstraint | null) => void;
}) {
  const container = document.createElement("div");
  container.className = "step-content destination-step";

  const content = document.createElement("div");
  content.className = "destination-content";

  const intro = document.createElement("div");
  intro.className = "destination-intro";
  intro.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
    <h3>你们要去哪里？</h3>
    <p>输入目的地，我们将为你们规划最佳路线</p>
  `;

  const addressWrapper = document.createElement("div");
  addressWrapper.className = "destination-input-wrapper";

  // 跟踪当前选中的目的地
  let currentSelection: Suggestion | null = config.initialValue;
  let currentTimeConstraint: TimeConstraint | null = config.initialTimeConstraint;

  const addressInput = createAddressInput({
    label: "目的地",
    placeholder: "搜索目的地地址、景区、商场等",
    value: config.initialValueInput,
    selected: config.initialValue,
    city: config.city,
    onInput: (value) => {
      // 输入时不更新，只在选择时更新
    },
    onSelect: (suggestion) => {
      currentSelection = suggestion;
      config.onSelect(suggestion);
    }
  });

  addressWrapper.appendChild(addressInput);

  // 时间约束选择
  const timeWrapper = document.createElement("div");
  timeWrapper.className = "time-constraint-wrapper";

  const timeHeader = document.createElement("div");
  timeHeader.className = "time-header";

  const timeToggle = document.createElement("label");
  timeToggle.className = "time-toggle";
  timeToggle.innerHTML = `
    <input type="checkbox" id="timeToggleCheck" ${currentTimeConstraint ? "checked" : ""}>
    <span>到达时间（可选）</span>
    <p class="time-hint">勾选后设置期望到达时间，AI将为您计算每个人的出发时间</p>
  `;

  const timeContent = document.createElement("div");
  timeContent.className = "time-content";
  timeContent.style.display = currentTimeConstraint ? "block" : "none";

  // 解析初始时间
  let initialHour = 9;
  let initialMinute = 0;
  if (currentTimeConstraint?.time) {
    const [h, m] = currentTimeConstraint.time.split(":").map(Number);
    initialHour = h ?? 9;
    initialMinute = m ?? 0;
  }

  const timePicker = createTimePicker({
    initialHour,
    initialMinute,
    onSelect: (hour, minute) => {
      currentTimeConstraint = {
        kind: "arrival",
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        source: "manual"
      };
      config.onTimeChange(currentTimeConstraint);
    }
  });

  timeContent.appendChild(timePicker.element);

  // 切换时间选择显示
  const toggleCheck = timeToggle.querySelector("input")! as HTMLInputElement;
  toggleCheck.addEventListener("change", () => {
    if (toggleCheck.checked) {
      timeContent.style.display = "block";
      const { hour, minute } = timePicker.getValue();
      currentTimeConstraint = {
        kind: "arrival",
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        source: "manual"
      };
      config.onTimeChange(currentTimeConstraint);
    } else {
      timeContent.style.display = "none";
      currentTimeConstraint = null;
      config.onTimeChange(null);
    }
  });

  timeWrapper.appendChild(timeHeader);
  timeHeader.appendChild(timeToggle);
  timeWrapper.appendChild(timeContent);

  content.appendChild(intro);
  content.appendChild(addressWrapper);
  content.appendChild(timeWrapper);

  container.appendChild(content);

  function validate(): string | null {
    if (!currentSelection) {
      return "请选择目的地";
    }
    return null;
  }

  return {
    element: container,
    validate
  };
}
