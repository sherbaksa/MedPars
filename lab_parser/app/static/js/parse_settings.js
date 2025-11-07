// Управление настройками парсинга (анализы с множественными показателями)

const modal = document.getElementById("definition-modal");
const form = document.getElementById("definition-form");
const addBtn = document.getElementById("add-definition-btn");
const cancelBtn = document.getElementById("cancel-btn");
const addIndicatorBtn = document.getElementById("add-indicator-btn");
const indicatorsContainer = document.getElementById("indicators-container");

const VALUE_TYPE_LABELS = {
  1: "Обнаружено/Не обнаружено",
  2: "Числовое значение",
  3: "Иное значение"
};

let indicatorCounter = 0;

async function loadDefinitions() {
  const res = await fetch("/api/test-definitions");
  const data = await res.json();

  const tbody = document.querySelector("#definitions-table tbody");
  tbody.innerHTML = "";

  if (!data.definitions || data.definitions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">Анализы не настроены. Добавьте первый анализ.</td></tr>';
    return;
  }

  data.definitions.forEach(definition => {
    const tr = document.createElement("tr");
    const indicatorsCount = definition.indicators ? definition.indicators.length : 0;
    const exampleShort = definition.full_example_text.length > 80
      ? definition.full_example_text.substring(0, 77) + "..."
      : definition.full_example_text;

    tr.innerHTML = `
      <td><strong>${definition.short_description}</strong></td>
      <td><small><code>${exampleShort}</code></small></td>
      <td style="text-align: center;">${indicatorsCount}</td>
      <td>
        <button class="edit-btn" data-id="${definition.id}">Изменить</button>
        <button class="delete-btn secondary" data-id="${definition.id}">Удалить</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Обработчики для кнопок редактирования
  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => editDefinition(parseInt(btn.dataset.id)));
  });

  // Обработчики для кнопок удаления
  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteDefinition(parseInt(btn.dataset.id)));
  });
}

function createIndicatorBlock(indicator = null) {
  indicatorCounter++;
  const blockId = `indicator-${indicatorCounter}`;

  const block = document.createElement("div");
  block.className = "indicator-block";
  block.dataset.blockId = blockId;

  // Сохраняем ID показателя для обновления
  if (indicator && indicator.id) {
    block.dataset.indicatorId = indicator.id;
  }

  const indicatorNumber = indicatorsContainer.children.length + 1;

  block.innerHTML = `
    <h5>
      <span>Показатель ${indicatorNumber}</span>
      <button type="button" class="remove-indicator-btn" data-block-id="${blockId}">✕ Удалить</button>
    </h5>

    <div class="form-group">
      <label>Паттерн показателя:</label>
      <textarea class="indicator-pattern" rows="2" required
                placeholder="Например: Антитела к Treponema pallidum - {value};"></textarea>
      <small>Часть строки с этим показателем. Включите разделитель ";" если это не последний показатель</small>
    </div>

    <div class="indicator-row">
      <div class="form-group">
        <label>Изменяемая часть:</label>
        <input type="text" class="variable-part" required
               placeholder="Например: {value}">
        <small>Часть паттерна, которая меняется</small>
      </div>

      <div class="form-group">
        <label>Тип значения:</label>
        <select class="value-type" required>
          <option value="">Выберите тип</option>
          <option value="1">Обнаружено / Не обнаружено</option>
          <option value="2">Числовое значение</option>
          <option value="3">Иное значение</option>
        </select>
      </div>
    </div>

    <div class="indicator-checkboxes">
      <label>
        <input type="checkbox" class="is-key-indicator">
        Ключевой показатель (отображается в сводке)
      </label>
      <label>
        <input type="checkbox" class="is-required" checked>
        Обязательный показатель
      </label>
    </div>
  `;

  // Если передан существующий показатель, заполняем поля
  if (indicator) {
    block.querySelector(".indicator-pattern").value = indicator.indicator_pattern || "";
    block.querySelector(".variable-part").value = indicator.variable_part || "";
    block.querySelector(".value-type").value = indicator.value_type || "";
    block.querySelector(".is-key-indicator").checked = indicator.is_key_indicator || false;
    block.querySelector(".is-required").checked = indicator.is_required !== false;
  }

  // Обработчик удаления блока
  block.querySelector(".remove-indicator-btn").addEventListener("click", (e) => {
    if (indicatorsContainer.children.length === 1) {
      alert("Нельзя удалить единственный показатель. Анализ должен иметь хотя бы один показатель.");
      return;
    }
    block.remove();
    updateIndicatorNumbers();
  });

  return block;
}

function updateIndicatorNumbers() {
  const blocks = indicatorsContainer.querySelectorAll(".indicator-block");
  blocks.forEach((block, index) => {
    block.querySelector("h5 span").textContent = `Показатель ${index + 1}`;
  });
}

function openModal(title = "Добавить анализ") {
  document.getElementById("modal-title").textContent = title;

  // Очищаем контейнер показателей
  indicatorsContainer.innerHTML = "";

  // Добавляем один пустой показатель по умолчанию
  indicatorsContainer.appendChild(createIndicatorBlock());

  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
  form.reset();
  document.getElementById("definition-id").value = "";
  indicatorsContainer.innerHTML = "";
}

async function editDefinition(id) {
  const res = await fetch(`/api/test-definitions/${id}`);
  const definition = await res.json();

  if (definition.error) {
    alert("Ошибка загрузки анализа");
    return;
  }

  // Открываем модалку СНАЧАЛА (без очистки контейнера показателей)
  document.getElementById("modal-title").textContent = "Изменить анализ";
  modal.style.display = "flex";

  // Заполняем основные поля
  document.getElementById("definition-id").value = definition.id;
  document.getElementById("full-example-text").value = definition.full_example_text;
  document.getElementById("short-description").value = definition.short_description;

  // Очищаем контейнер показателей
  indicatorsContainer.innerHTML = "";

  // Добавляем блоки для каждого показателя
  if (definition.indicators && definition.indicators.length > 0) {
    definition.indicators.forEach(indicator => {
      indicatorsContainer.appendChild(createIndicatorBlock(indicator));
    });
  } else {
    // Если показателей нет (не должно быть), добавляем один пустой
    indicatorsContainer.appendChild(createIndicatorBlock());
  }
}

async function deleteDefinition(id) {
  if (!confirm("Удалить этот анализ со всеми показателями?")) return;

  const res = await fetch(`/api/test-definitions/${id}`, { method: "DELETE" });
  const data = await res.json();

  if (data.success) {
    loadDefinitions();
  } else {
    alert("Ошибка удаления: " + (data.error || "неизвестная ошибка"));
  }
}

addBtn.addEventListener("click", () => {
  openModal("Добавить анализ");
});

addIndicatorBtn.addEventListener("click", () => {
  indicatorsContainer.appendChild(createIndicatorBlock());
});

cancelBtn.addEventListener("click", closeModal);

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const definitionId = document.getElementById("definition-id").value;
  const fullExampleText = document.getElementById("full-example-text").value.trim();
  const shortDescription = document.getElementById("short-description").value.trim();

  // Валидация основных полей
  if (!fullExampleText || !shortDescription) {
    alert("Заполните все обязательные поля анализа");
    return;
  }

  // Собираем показатели
  const indicators = [];
  const indicatorBlocks = indicatorsContainer.querySelectorAll(".indicator-block");

  if (indicatorBlocks.length === 0) {
    alert("Добавьте хотя бы один показатель");
    return;
  }

  for (let i = 0; i < indicatorBlocks.length; i++) {
    const block = indicatorBlocks[i];
    const indicatorPattern = block.querySelector(".indicator-pattern").value.trim();
    const variablePart = block.querySelector(".variable-part").value.trim();
    const valueType = parseInt(block.querySelector(".value-type").value);
    const isKeyIndicator = block.querySelector(".is-key-indicator").checked;
    const isRequired = block.querySelector(".is-required").checked;

    if (!indicatorPattern || !variablePart || !valueType) {
      alert(`Показатель ${i + 1}: заполните все обязательные поля`);
      return;
    }

    if (!indicatorPattern.includes(variablePart)) {
      alert(`Показатель ${i + 1}: изменяемая часть должна присутствовать в паттерне`);
      return;
    }

    indicators.push({
      indicator_pattern: indicatorPattern,
      variable_part: variablePart,
      value_type: valueType,
      is_key_indicator: isKeyIndicator,
      is_required: isRequired,
      display_order: i
    });
  }

  const payload = {
    full_example_text: fullExampleText,
    short_description: shortDescription,
    indicators: indicators
  };

  let res;
  if (definitionId) {
    // Обновление существующего анализа
    res = await fetch(`/api/test-definitions/${definitionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    // Создание нового анализа
    res = await fetch("/api/test-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  const data = await res.json();

  if (data.success) {
    closeModal();
    loadDefinitions();
  } else {
    alert("Ошибка: " + (data.error || "неизвестная ошибка"));
  }
});

// Загрузка анализов при открытии страницы
document.addEventListener("DOMContentLoaded", loadDefinitions);