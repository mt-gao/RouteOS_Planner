import { createAddressInput } from "../addressInput";
import type { PersonState } from "../../types";

export function createPeopleDetailStep(config: {
  people: PersonState[];
  city: string;
  onChange: (people: PersonState[]) => void;
}) {
  const container = document.createElement("div");
  container.className = "step-content people-detail-step";

  const header = document.createElement("div");
  header.className = "people-detail-header";
  header.innerHTML = `
    <div class="people-detail-tabs"></div>
  `;

  const content = document.createElement("div");
  content.className = "people-detail-content";

  // 添加 header 和 content 到容器
  container.appendChild(header);
  container.appendChild(content);

  let currentIndex = 0;

  function renderTabs() {
    const tabsContainer = header.querySelector(".people-detail-tabs")!;
    tabsContainer.innerHTML = "";

    config.people.forEach((person, index) => {
      const tab = document.createElement("button");
      tab.className = `person-tab ${index === currentIndex ? "active" : ""}`;
      tab.innerHTML = `
        <span class="tab-number">${index + 1}</span>
        <span class="tab-name">${person.name || "未填写"}</span>
      `;

      tab.addEventListener("click", () => {
        currentIndex = index;
        renderTabs();
        renderForm();
      });

      tabsContainer.appendChild(tab);
    });
  }

  function renderForm() {
    content.innerHTML = "";

    const person = config.people[currentIndex];
    if (!person) return;

    const form = document.createElement("div");
    form.className = "person-form";

    // 姓名输入
    const nameGroup = createFormField({
      label: "昵称",
      placeholder: "输入Ta的昵称",
      value: person.name,
      onChange: (value) => {
        person.name = value;
        config.onChange([...config.people]);
        renderTabs();
      }
    });

    // 是否开车
    const carGroup = document.createElement("div");
    carGroup.className = "form-field";
    carGroup.innerHTML = `
      <label class="field-label">是否开车</label>
      <div class="car-toggle">
        <button class="car-option ${!person.hasCar ? "active" : ""}" data-car="false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          乘客
        </button>
        <button class="car-option ${person.hasCar ? "active" : ""}" data-car="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
            <circle cx="7" cy="17" r="2"/>
            <path d="M9 17h6"/>
            <circle cx="17" cy="17" r="2"/>
          </svg>
          司机
        </button>
      </div>
    `;

    carGroup.querySelectorAll(".car-option").forEach(btn => {
      btn.addEventListener("click", () => {
        const hasCar = btn.dataset.car === "true";
        person.hasCar = hasCar;
        carGroup.querySelectorAll(".car-option").forEach(b => b.classList.toggle("active", b.dataset.car === String(hasCar)));
        config.onChange([...config.people]);
      });
    });

    // 出发地
    const addressGroup = document.createElement("div");
    addressGroup.className = "form-field";

    const addressInput = createAddressInput({
      label: "出发地",
      placeholder: "搜索出发地点",
      value: person.addressInput,
      selected: person.selectedAddress,
      city: config.city,
      onInput: (value) => {
        person.addressInput = value;
        config.onChange([...config.people]);
      },
      onSelect: (suggestion) => {
        person.addressInput = suggestion.name;
        person.selectedAddress = suggestion;
        config.onChange([...config.people]);
      }
    });

    addressGroup.appendChild(addressInput);

    // 备注
    const noteGroup = createFormField({
      label: "备注（可选）",
      placeholder: "有什么需要特别说明的",
      value: person.note,
      onChange: (value) => {
        person.note = value;
        config.onChange([...config.people]);
      }
    });

    form.appendChild(nameGroup);
    form.appendChild(carGroup);
    form.appendChild(addressGroup);
    form.appendChild(noteGroup);

    // 上一个/下一个按钮
    if (config.people.length > 1) {
      const nav = document.createElement("div");
      nav.className = "person-form-nav";

      const prevBtn = document.createElement("button");
      prevBtn.className = "nav-link-button";
      prevBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        上一个人
      `;
      prevBtn.disabled = currentIndex === 0;
      prevBtn.addEventListener("click", () => {
        if (currentIndex > 0) {
          currentIndex--;
          renderTabs();
          renderForm();
        }
      });

      const nextBtn = document.createElement("button");
      nextBtn.className = "nav-link-button primary";
      nextBtn.innerHTML = `
        下一个人
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      `;
      nextBtn.disabled = currentIndex === config.people.length - 1;
      nextBtn.addEventListener("click", () => {
        if (currentIndex < config.people.length - 1) {
          currentIndex++;
          renderTabs();
          renderForm();
        }
      });

      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      form.appendChild(nav);
    }

    content.appendChild(form);
  }

  function createFormField(options: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  }) {
    const group = document.createElement("div");
    group.className = "form-field";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = options.label;

    const input = document.createElement("input");
    input.className = "text-input";
    input.type = "text";
    input.placeholder = options.placeholder;
    input.value = options.value;

    input.addEventListener("input", () => {
      options.onChange(input.value);
    });

    group.appendChild(label);
    group.appendChild(input);

    return group;
  }

  function validate(): string | null {
    const incompletePeople = config.people.filter(p => !p.name?.trim() || !p.selectedAddress);
    if (incompletePeople.length > 0) {
      const names = incompletePeople.map(p => p.name || "未命名").join("、");
      return `请为 ${names} 填写昵称和出发地`;
    }
    return null;
  }

  // 初始化渲染
  renderTabs();
  renderForm();

  return {
    element: container,
    validate
  };
}
