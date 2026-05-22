import { createAddressInput } from "./addressInput";
import type { PersonState, Suggestion } from "../types";

type PersonListOptions = {
  people: PersonState[];
  city: string;
  drivers: PersonState[];
  groupedPersonIds: Set<string>;
  onChange: () => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPersonPatch: (id: string, patch: Partial<PersonState>) => void;
  onAddressSelect: (id: string, suggestion: Suggestion) => void;
};

export function renderPersonList(host: HTMLElement, options: PersonListOptions) {
  host.innerHTML = "";
  const namedDrivers = options.drivers.filter((driver) => driver.name.trim());

  const list = document.createElement("div");
  list.className = "person-list";

  for (const [index, person] of options.people.entries()) {
    const row = document.createElement("article");
    const isGrouped = options.groupedPersonIds.has(person.id);
    const isReady = Boolean(person.name && person.selectedAddress);
    row.className = [
      "person-card",
      person.hasCar ? "driver-card" : "passenger-card",
      isGrouped ? "grouped" : "",
      isReady ? "ready" : ""
    ].filter(Boolean).join(" ");
    row.draggable = !person.hasCar;
    row.dataset.personId = person.id;
    row.addEventListener("dragstart", (event) => {
      if (person.hasCar) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData("text/person-id", person.id);
      event.dataTransfer?.setData("text/plain", person.id);
      event.dataTransfer!.effectAllowed = "move";
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = person.name || "未命名人员";
      document.body.append(ghost);
      event.dataTransfer?.setDragImage(ghost, 18, 18);
      window.setTimeout(() => ghost.remove(), 0);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
    });

    const top = document.createElement("div");
    top.className = "person-card-top";
    const identityRow = document.createElement("div");
    identityRow.className = "person-identity-row";
    const metaRow = document.createElement("div");
    metaRow.className = "person-meta-row";

    const indexBadge = document.createElement("div");
    indexBadge.className = "person-index";
    indexBadge.textContent = String(index + 1).padStart(2, "0");

    const nameLabel = document.createElement("label");
    nameLabel.className = "field-label compact";
    nameLabel.textContent = person.hasCar ? "司机姓名" : "乘客姓名";
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.value = person.name;
    nameInput.placeholder = "姓名";
    nameInput.addEventListener("input", () => {
      options.onPersonPatch(person.id, { name: nameInput.value.trim() });
    });
    nameLabel.append(nameInput);

    const carLabel = document.createElement("label");
    carLabel.className = "switch-line";
    const carInput = document.createElement("input");
    carInput.type = "checkbox";
    carInput.checked = person.hasCar;
    carInput.addEventListener("change", () => {
      options.onPersonPatch(person.id, { hasCar: carInput.checked });
      options.onChange();
    });
    carLabel.append(carInput, document.createTextNode("开车"));

    const stateLabel = document.createElement("span");
    stateLabel.className = "person-state";
    stateLabel.textContent = person.hasCar ? "司机" : isGrouped ? "已集合" : person.selectedAddress ? "待接" : "待定位";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = "移除人员";
    remove.textContent = "×";
    remove.disabled = options.people.length <= 1;
    remove.addEventListener("click", () => options.onRemove(person.id));

    identityRow.append(indexBadge, nameLabel);
    metaRow.append(carLabel, stateLabel, remove);
    top.append(identityRow, metaRow);
    row.append(top);

    const address = createAddressInput({
      label: "出发地址",
      placeholder: "输入地址或 POI",
      value: person.addressInput,
      selected: person.selectedAddress,
      city: options.city,
      onInput: (value) => options.onPersonPatch(person.id, { addressInput: value, selectedAddress: null }),
      onSelect: (suggestion) => options.onAddressSelect(person.id, suggestion)
    });
    row.append(address);

    const assignment = document.createElement("label");
    assignment.className = "field-label compact";
    assignment.textContent = person.hasCar ? "司机本人" : "由谁接";
    const select = document.createElement("select");
    select.className = "text-input";
    select.disabled = person.hasCar || options.groupedPersonIds.has(person.id);
    select.value = person.assignedDriverId;
    select.innerHTML = `<option value=""></option>${namedDrivers
      .map((driver) => `<option value="${driver.id}">${driver.name}</option>`)
      .join("")}`;
    select.addEventListener("change", () => options.onPersonPatch(person.id, { assignedDriverId: select.value }));
    assignment.append(select);
    row.append(assignment);

    const note = document.createElement("input");
    note.className = "text-input subtle";
    note.placeholder = "备注";
    note.value = person.note;
    note.addEventListener("input", () => options.onPersonPatch(person.id, { note: note.value.trim() }));
    row.append(note);

    if (options.groupedPersonIds.has(person.id)) {
      const groupedNote = document.createElement("div");
      groupedNote.className = "inline-note";
      groupedNote.textContent = "已放入集合点，司机路线中不再作为单独接人点";
      row.append(groupedNote);
    }

    list.append(row);
  }

  host.append(list);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "secondary-button";
  add.textContent = "+ 添加人员";
  add.disabled = options.people.length >= 8;
  add.addEventListener("click", options.onAdd);
  host.append(add);
}
