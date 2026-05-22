import type { Suggestion } from "../types";

type AddressInputOptions = {
  label: string;
  placeholder: string;
  value: string;
  selected: Suggestion | null;
  city: string;
  onInput: (value: string) => void;
  onSelect: (suggestion: Suggestion) => void;
};

function formatSuggestion(suggestion: Suggestion) {
  return suggestion.address ? `${suggestion.name} · ${suggestion.address}` : suggestion.name;
}

async function fetchSuggestions(keyword: string, city: string) {
  const params = new URLSearchParams({ keyword, city });
  const response = await fetch(`/api/suggest?${params.toString()}`);
  const data = (await response.json()) as Suggestion[] | { error?: string };
  if (!response.ok) {
    throw new Error("error" in data ? data.error || "地址搜索失败" : "地址搜索失败");
  }
  return data as Suggestion[];
}

export function createAddressInput(options: AddressInputOptions) {
  const root = document.createElement("div");
  root.className = "address-field";

  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = options.label;
  root.append(label);

  const input = document.createElement("input");
  input.className = "text-input";
  input.placeholder = options.placeholder;
  input.value = options.value;
  input.autocomplete = "off";
  root.append(input);

  const selected = document.createElement("div");
  selected.className = options.selected ? "selected-address" : "selected-address empty";
  selected.textContent = options.selected ? formatSuggestion(options.selected) : "待确认坐标";
  root.append(selected);

  const menu = document.createElement("div");
  menu.className = "suggestion-menu";
  root.append(menu);

  let timer = 0;
  let latestRequest = 0;

  function clearMenu() {
    menu.innerHTML = "";
    menu.classList.remove("open");
  }

  function renderMenu(items: Suggestion[]) {
    menu.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "suggestion-empty";
      empty.textContent = "没有候选";
      menu.append(empty);
      menu.classList.add("open");
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.innerHTML = `<span>${item.name}</span><small>${item.address || ""}</small>`;
      button.addEventListener("click", () => {
        input.value = item.name;
        selected.className = "selected-address";
        selected.textContent = formatSuggestion(item);
        clearMenu();
        options.onSelect(item);
      });
      menu.append(button);
    }
    menu.classList.add("open");
  }

  input.addEventListener("input", () => {
    const value = input.value.trim();
    selected.className = "selected-address empty";
    selected.textContent = "待确认坐标";
    options.onInput(value);
    window.clearTimeout(timer);
    if (value.length < 2) {
      clearMenu();
      return;
    }
    timer = window.setTimeout(async () => {
      const requestId = Date.now();
      latestRequest = requestId;
      menu.innerHTML = `<div class="suggestion-empty">搜索中</div>`;
      menu.classList.add("open");
      try {
        const suggestions = await fetchSuggestions(value, options.city);
        if (latestRequest === requestId) {
          renderMenu(suggestions);
        }
      } catch (error) {
        if (latestRequest === requestId) {
          menu.innerHTML = `<div class="suggestion-empty">${error instanceof Error ? error.message : "地址搜索失败"}</div>`;
          menu.classList.add("open");
        }
      }
    }, 280);
  });

  input.addEventListener("blur", () => {
    window.setTimeout(clearMenu, 160);
  });

  return root;
}
