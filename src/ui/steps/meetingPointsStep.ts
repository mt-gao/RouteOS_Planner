import { createMeetingPoint } from "../../store";
import { createAddressInput } from "../addressInput";
import type { MeetingPointState, PersonState } from "../../types";

export function createMeetingPointsStep(config: {
  meetingPoints: MeetingPointState[];
  people: PersonState[];
  city: string;
  onChange: (meetingPoints: MeetingPointState[]) => void;
}) {
  const container = document.createElement("div");
  container.className = "step-content meeting-points-step";

  // 顶部说明
  const intro = document.createElement("div");
  intro.className = "meeting-intro";
  intro.innerHTML = `
    <p>集合点可以让部分人提前集合，再由司机统一接走</p>
    <p class="intro-note">可选，跳过则直接按个人地点接人</p>
  `;

  const content = document.createElement("div");
  content.className = "meeting-content";

  // 空状态
  const emptyState = document.createElement("div");
  emptyState.className = "meeting-empty";
  emptyState.innerHTML = `
    <div class="empty-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/>
        <path d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
      </svg>
    </div>
    <p class="empty-text">还没有添加集合点</p>
    <button class="add-meeting-button">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      添加集合点
    </button>
  `;

  // 集合点列表
  const list = document.createElement("div");
  list.className = "meeting-list";

  function renderEmptyState() {
    content.innerHTML = "";
    if (config.meetingPoints.length === 0) {
      content.appendChild(emptyState);

      const addBtn = emptyState.querySelector(".add-meeting-button")!;
      addBtn.addEventListener("click", () => {
        addMeetingPoint();
      });
    } else {
      content.appendChild(list);
      renderList();
    }
  }

  function renderList() {
    list.innerHTML = "";

    config.meetingPoints.forEach((meeting, index) => {
      const card = createMeetingCard(meeting, index);
      list.appendChild(card);
    });

    // 添加按钮
    const addBtn = document.createElement("button");
    addBtn.className = "add-meeting-card";
    addBtn.innerHTML = `
      <div class="add-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <span>添加集合点</span>
    `;

    addBtn.addEventListener("click", () => {
      addMeetingPoint();
    });

    list.appendChild(addBtn);
  }

  function createMeetingCard(meeting: MeetingPointState, index: number) {
    const card = document.createElement("div");
    card.className = "meeting-card";

    const header = document.createElement("div");
    header.className = "meeting-card-header";

    const title = document.createElement("input");
    title.className = "meeting-title-input";
    title.type = "text";
    title.value = meeting.name;
    title.placeholder = "集合点名称";
    title.addEventListener("input", () => {
      meeting.name = title.value;
      config.onChange([...config.meetingPoints]);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-button";
    deleteBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    `;
    deleteBtn.addEventListener("click", () => {
      config.meetingPoints.splice(index, 1);
      config.onChange([...config.meetingPoints]);
      renderEmptyState();
    });

    header.appendChild(title);
    header.appendChild(deleteBtn);

    const body = document.createElement("div");
    body.className = "meeting-card-body";

    // 地址输入
    const addressWrapper = document.createElement("div");
    const addressInput = createAddressInput({
      label: "集合地点",
      placeholder: "搜索集合地点",
      value: meeting.addressInput,
      selected: meeting.selectedAddress,
      city: config.city,
      onInput: (value) => {
        meeting.addressInput = value;
        config.onChange([...config.meetingPoints]);
      },
      onSelect: (suggestion) => {
        meeting.addressInput = suggestion.name;
        meeting.selectedAddress = suggestion;
        config.onChange([...config.meetingPoints]);
      }
    });
    addressWrapper.appendChild(addressInput);

    // 成员选择
    const membersWrapper = document.createElement("div");
    membersWrapper.className = "members-section";

    const membersLabel = document.createElement("label");
    membersLabel.className = "field-label";
    membersLabel.textContent = "集合成员";

    const membersGrid = document.createElement("div");
    membersGrid.className = "members-grid";

    const passengers = config.people.filter(p => !p.hasCar);
    passengers.forEach(person => {
      const chip = document.createElement("button");
      chip.className = `member-chip ${meeting.memberIds.includes(person.id) ? "selected" : ""}`;
      chip.textContent = person.name || "未命名";

      chip.addEventListener("click", () => {
        const idx = meeting.memberIds.indexOf(person.id);
        if (idx > -1) {
          meeting.memberIds.splice(idx, 1);
        } else {
          meeting.memberIds.push(person.id);
        }
        chip.classList.toggle("selected");
        config.onChange([...config.meetingPoints]);
      });

      membersGrid.appendChild(chip);
    });

    membersWrapper.appendChild(membersLabel);
    membersWrapper.appendChild(membersGrid);

    body.appendChild(addressWrapper);
    body.appendChild(membersWrapper);

    card.appendChild(header);
    card.appendChild(body);

    return card;
  }

  function addMeetingPoint() {
    const newMeeting = createMeetingPoint({
      name: `集合点 ${config.meetingPoints.length + 1}`
    });
    config.meetingPoints.push(newMeeting);
    config.onChange([...config.meetingPoints]);
    renderEmptyState();
  }

  container.appendChild(intro);
  container.appendChild(content);

  // 初始化
  renderEmptyState();

  return { element: container };
}
