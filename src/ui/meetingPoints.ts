import { createAddressInput } from "./addressInput";
import type { MeetingPointState, PersonState, Suggestion } from "../types";

type MeetingPointOptions = {
  meetingPoints: MeetingPointState[];
  people: PersonState[];
  drivers: PersonState[];
  city: string;
  onCreate: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<MeetingPointState>) => void;
  onAddressSelect: (id: string, suggestion: Suggestion) => void;
  onDropPerson: (meetingId: string, personId: string) => void;
  onRemoveMember: (meetingId: string, personId: string) => void;
};

export function renderMeetingPoints(host: HTMLElement, options: MeetingPointOptions) {
  host.innerHTML = "";
  const namedDrivers = options.drivers.filter((driver) => driver.name.trim());

  const header = document.createElement("div");
  header.className = "section-title-row";
  header.innerHTML = `<div><span>Rally</span><h2>集合点</h2></div><small>下拉添加或拖入乘客</small>`;
  host.append(header);

  const create = document.createElement("button");
  create.type = "button";
  create.className = "secondary-button full-width";
  create.textContent = "+ 创建集合点";
  create.addEventListener("click", options.onCreate);
  host.append(create);

  if (!options.meetingPoints.length) {
    const empty = document.createElement("div");
    empty.className = "inline-note meeting-empty";
    empty.textContent = "创建后可拖入乘客，集合点会替代这些人的单独接人点。";
    host.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "meeting-list";
  host.append(list);

  for (const meeting of options.meetingPoints) {
    const card = document.createElement("article");
    card.className = meeting.selectedAddress && meeting.memberIds.length ? "meeting-card ready" : "meeting-card";
    card.dataset.meetingId = meeting.id;
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      card.classList.add("drag-over");
      event.dataTransfer!.dropEffect = "move";
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const personId = event.dataTransfer?.getData("text/person-id") || event.dataTransfer?.getData("text/plain");
      if (personId) options.onDropPerson(meeting.id, personId);
    });

    const top = document.createElement("div");
    top.className = "meeting-top";
    const badge = document.createElement("span");
    badge.className = "meeting-badge";
    badge.textContent = `${meeting.memberIds.length} 人`;
    const nameInput = document.createElement("input");
    nameInput.className = "text-input";
    nameInput.value = meeting.name;
    nameInput.placeholder = "集合点名称";
    nameInput.addEventListener("input", () => options.onPatch(meeting.id, { name: nameInput.value.trim() || "集合点" }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = "删除集合点";
    remove.textContent = "×";
    remove.addEventListener("click", () => options.onRemove(meeting.id));
    top.append(badge, nameInput, remove);
    card.append(top);

    card.append(
      createAddressInput({
        label: "集合地址",
        placeholder: "输入集合位置，如商场/停车场/地铁站",
        value: meeting.addressInput,
        selected: meeting.selectedAddress,
        city: options.city,
        onInput: (value) => options.onPatch(meeting.id, { addressInput: value, selectedAddress: null }),
        onSelect: (suggestion) => options.onAddressSelect(meeting.id, suggestion)
      })
    );

    const assignment = document.createElement("label");
    assignment.className = "field-label compact";
    assignment.textContent = "由谁接集合点";
    const select = document.createElement("select");
    select.className = "text-input";
    select.value = meeting.assignedDriverId;
    select.innerHTML = `<option value=""></option>${namedDrivers
      .map((driver) => `<option value="${driver.id}">${driver.name}</option>`)
      .join("")}`;
    select.addEventListener("change", () => options.onPatch(meeting.id, { assignedDriverId: select.value }));
    assignment.append(select);
    card.append(assignment);

    const dropZone = document.createElement("div");
    dropZone.className = "member-drop-zone";
    if (!meeting.memberIds.length) {
      dropZone.innerHTML = `<span>等待成员</span><strong>把要先集合的人加入这里</strong>`;
    } else {
      for (const memberId of meeting.memberIds) {
        const person = options.people.find((candidate) => candidate.id === memberId);
        if (!person) continue;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "member-chip";
        chip.title = "移出集合点";
        chip.textContent = `${person.name || "未命名"} ×`;
        chip.addEventListener("click", () => options.onRemoveMember(meeting.id, memberId));
        dropZone.append(chip);
      }
    }
    card.append(dropZone);

    const memberPicker = document.createElement("label");
    memberPicker.className = "field-label compact";
    memberPicker.textContent = "添加成员";
    const memberSelect = document.createElement("select");
    memberSelect.className = "text-input";
    const availablePeople = options.people.filter((person) => !person.hasCar && !meeting.memberIds.includes(person.id));
    memberSelect.innerHTML = `<option value="">选择要加入集合点的人</option>${availablePeople
      .map((person) => `<option value="${person.id}">${person.name || "未命名"} · ${person.addressInput || person.selectedAddress?.name || "未填地址"}</option>`)
      .join("")}`;
    memberSelect.disabled = availablePeople.length === 0;
    memberSelect.addEventListener("change", () => {
      if (!memberSelect.value) return;
      options.onDropPerson(meeting.id, memberSelect.value);
      memberSelect.value = "";
    });
    memberPicker.append(memberSelect);
    card.append(memberPicker);

    list.append(card);
  }
}
