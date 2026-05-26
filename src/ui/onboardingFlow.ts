import { loadState, saveState, createPerson, createMeetingPoint } from "../store";
import { createCityStep } from "./steps/cityStep";
import { createPeopleCountStep } from "./steps/peopleCountStep";
import { createPeopleDetailStep } from "./steps/peopleDetailStep";
import { createMeetingPointsStep } from "./steps/meetingPointsStep";
import { createDestinationStep } from "./steps/destinationStep";
import type { AppState } from "../types";

type Step = "city" | "peopleCount" | "peopleDetail" | "meetingPoints" | "destination" | "complete";
type StepConfig = { id: Step; title: string; subtitle: string };

const STEPS: StepConfig[] = [
  { id: "city", title: "出发城市", subtitle: "选择你们所在的城市" },
  { id: "peopleCount", title: "出行人数", subtitle: "一共有多少人参与这次出行" },
  { id: "peopleDetail", title: "人员信息", subtitle: "为每个人填写信息" },
  { id: "meetingPoints", title: "集合地点", subtitle: "是否需要提前集合" },
  { id: "destination", title: "目的地", subtitle: "你们要去哪里" },
  { id: "complete", title: "完成", subtitle: "信息已填写完整" }
];

export function createOnboardingFlow() {
  let state = loadState();
  let currentStepIndex = 0;
  let isAnimating = false;

  // 创建主容器
  const container = document.createElement("div");
  container.className = "onboarding-flow";

  // 头部进度条
  const header = document.createElement("header");
  header.className = "onboarding-header";
  header.innerHTML = `
    <div class="onboarding-progress">
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="step-indicator">
        <span class="current-step">1</span>
        <span class="total-steps">/ ${STEPS.length - 1}</span>
      </div>
    </div>
  `;

  // 导航栏（返回/下一步按钮）
  const nav = document.createElement("nav");
  nav.className = "onboarding-nav";

  const backButton = document.createElement("button");
  backButton.className = "nav-button back-button";
  backButton.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    <span>上一步</span>
  `;
  backButton.disabled = true;

  const nextButton = document.createElement("button");
  nextButton.className = "nav-button next-button primary";
  nextButton.innerHTML = `
    <span>下一步</span>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  `;

  nav.appendChild(backButton);
  nav.appendChild(nextButton);

  // 内容区域
  const content = document.createElement("main");
  content.className = "onboarding-content";

  // 步骤标题
  const stepTitle = document.createElement("div");
  stepTitle.className = "step-title";

  // 步骤容器
  const stepsContainer = document.createElement("div");
  stepsContainer.className = "steps-container";

  container.appendChild(header);
  container.appendChild(stepTitle);
  container.appendChild(content);
  container.appendChild(nav);

  // 创建所有步骤
  const steps = new Map<Step, HTMLElement>();
  const stepElements: { id: Step; element: HTMLElement; validate?: () => string | null }[] = [];

  // 城市步骤
  const cityStep = createCityStep({
    initialValue: state.city,
    onSelect: (city) => {
      state.city = city;
      saveState(state);
    }
  });
  steps.set("city", cityStep.element);
  stepElements.push({ id: "city", element: cityStep.element });

  // 人数步骤
  const peopleCountStep = createPeopleCountStep({
    initialValue: state.people.length,
    onSelect: (count) => {
      // 调整人数
      const currentCount = state.people.length;
      if (count > currentCount) {
        for (let i = 0; i < count - currentCount; i++) {
          state.people.push(createPerson());
        }
      } else if (count < currentCount) {
        state.people = state.people.slice(0, count);
      }
      saveState(state);
    }
  });
  steps.set("peopleCount", peopleCountStep.element);
  stepElements.push({ id: "peopleCount", element: peopleCountStep.element });

  // 人员详情步骤
  const peopleDetailStep = createPeopleDetailStep({
    people: state.people,
    city: state.city,
    onChange: (people) => {
      state.people = people;
      saveState(state);
    }
  });
  steps.set("peopleDetail", peopleDetailStep.element);
  stepElements.push({ id: "peopleDetail", element: peopleDetailStep.element, validate: () => peopleDetailStep.validate() });

  // 集合点步骤
  const meetingPointsStep = createMeetingPointsStep({
    meetingPoints: state.meetingPoints,
    people: state.people,
    city: state.city,
    onChange: (meetingPoints) => {
      state.meetingPoints = meetingPoints;
      saveState(state);
    }
  });
  steps.set("meetingPoints", meetingPointsStep.element);
  stepElements.push({ id: "meetingPoints", element: meetingPointsStep.element });

  // 目的地步骤
  const destinationStep = createDestinationStep({
    city: state.city,
    initialValue: state.destination,
    initialValueInput: state.destinationInput,
    initialTimeConstraint: state.timeConstraint,
    onSelect: (destination) => {
      state.destination = destination;
      state.destinationInput = destination?.name || "";
      saveState(state);
    },
    onTimeChange: (timeConstraint) => {
      state.timeConstraint = timeConstraint;
      saveState(state);
    }
  });
  steps.set("destination", destinationStep.element);
  stepElements.push({ id: "destination", element: destinationStep.element, validate: () => destinationStep.validate() });

  // 添加所有步骤到容器
  stepElements.forEach(({ element }) => {
    stepsContainer.appendChild(element);
  });
  content.appendChild(stepsContainer);

  // 更新UI函数
  function updateUI() {
    const currentStep = STEPS[currentStepIndex];

    // 更新标题
    stepTitle.innerHTML = `
      <h2 class="step-heading">${currentStep.title}</h2>
      <p class="step-subheading">${currentStep.subtitle}</p>
    `;

    // 更新进度条
    const progressPercent = (currentStepIndex / (STEPS.length - 2)) * 100;
    header.querySelector(".progress-fill")?.setAttribute("style", `width: ${progressPercent}%`);
    header.querySelector(".current-step")!.textContent = String(currentStepIndex + 1);

    // 更新按钮状态
    backButton.disabled = currentStepIndex === 0;
    nextButton.innerHTML = currentStepIndex === STEPS.length - 2
      ? `<span>完成</span><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`
      : `<span>下一步</span><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

    // 显示当前步骤
    stepElements.forEach(({ id, element }) => {
      if (id === currentStep.id) {
        element.classList.add("active");
        element.classList.remove("prev", "next");
        // 切换到人员详情步骤时，更新人数
        if (id === "peopleDetail") {
          peopleDetailStep.updatePeople(state.people);
        }
        // 切换到集合点步骤时，更新人数
        if (id === "meetingPoints") {
          meetingPointsStep.updatePeople(state.people);
        }
      } else if (stepElements.findIndex(s => s.id === id) < currentStepIndex) {
        element.classList.add("prev");
        element.classList.remove("active", "next");
      } else {
        element.classList.add("next");
        element.classList.remove("active", "prev");
      }
    });
  }

  // 验证当前步骤
  function validateCurrentStep(): boolean {
    const currentStepConfig = STEPS[currentStepIndex];
    const stepData = stepElements.find(s => s.id === currentStepConfig.id);
    if (stepData?.validate) {
      const error = stepData.validate();
      if (error) {
        showToast(error);
        return false;
      }
    }
    return true;
  }

  // 显示提示
  function showToast(message: string) {
    const existing = container.querySelector(".toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 导航事件
  backButton.addEventListener("click", () => {
    if (currentStepIndex > 0 && !isAnimating) {
      isAnimating = true;
      currentStepIndex--;
      updateUI();
      setTimeout(() => { isAnimating = false; }, 300);
    }
  });

  nextButton.addEventListener("click", () => {
    if (!validateCurrentStep() || isAnimating) return;

    isAnimating = true;
    if (currentStepIndex < STEPS.length - 2) {
      currentStepIndex++;
      updateUI();
      setTimeout(() => { isAnimating = false; }, 300);
    } else {
      // 完成
      completeOnboarding();
    }
  });

  // 滑动手势支持
  let touchStartX = 0;
  let touchStartY = 0;

  container.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener("touchend", (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;

    // 只处理水平滑动，且滑动距离足够
    if (Math.abs(diffX) > 50 && Math.abs(diffY) < 50) {
      if (diffX > 0 && currentStepIndex < STEPS.length - 2) {
        // 左滑，下一步
        nextButton.click();
      } else if (diffX < 0 && currentStepIndex > 0) {
        // 右滑，上一步
        backButton.click();
      }
    }
  }, { passive: true });

  function completeOnboarding() {
    container.classList.add("complete");
    saveState(state);

    // 触发完成事件
    container.dispatchEvent(new CustomEvent("onboarding-complete", {
      detail: { state },
      bubbles: true
    }));
  }

  // 初始化
  updateUI();

  return {
    element: container,
    getState: () => state,
    complete: () => completeOnboarding()
  };
}
