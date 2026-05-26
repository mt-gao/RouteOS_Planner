const CITIES = [
  "深圳", "北京", "上海", "广州", "杭州", "成都",
  "重庆", "武汉", "西安", "南京", "天津", "苏州",
  "长沙", "郑州", "东莞", "青岛", "沈阳", "宁波",
  "佛山", "合肥"
];

export function createCityStep(config: { initialValue: string; onSelect: (city: string) => void }) {
  const container = document.createElement("div");
  container.className = "step-content city-step";

  const grid = document.createElement("div");
  grid.className = "city-grid";

  CITIES.forEach(city => {
    const button = document.createElement("button");
    button.className = "city-option";
    button.textContent = city;
    if (city === config.initialValue) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      grid.querySelectorAll(".city-option").forEach(b => b.classList.remove("selected"));
      button.classList.add("selected");
      config.onSelect(city);
    });

    grid.appendChild(button);
  });

  container.appendChild(grid);

  return { element: container };
}
