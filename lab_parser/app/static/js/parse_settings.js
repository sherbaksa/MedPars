// Управление настройками парсинга

const modal = document.getElementById("rule-modal");
const form = document.getElementById("rule-form");
const addBtn = document.getElementById("add-rule-btn");
const cancelBtn = document.getElementById("cancel-btn");

const VALUE_TYPE_LABELS = {
  1: "Обнаружено/Не обнаружено",
  2: "Числовое значение",
  3: "Иное значение"
};

async function loadRules() {
  const res = await fetch("/api/parse-rules");
  const data = await res.json();

  const tbody = document.querySelector("#rules-table tbody");
  tbody.innerHTML = "";

  if (!data.rules || data.rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">Правила не настроены. Добавьте первое правило.</td></tr>';
    return;
  }

  data.rules.forEach(rule => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${rule.short_name}</strong></td>
      <td><code>${rule.test_pattern}</code></td>
      <td>${VALUE_TYPE_LABELS[rule.value_type] || "Неизвестно"}</td>
      <td>
        <button class="edit-btn" data-id="${rule.id}">Изменить</button>
        <button class="delete-btn secondary" data-id="${rule.id}">Удалить</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Обработчики для кнопок редактирования
  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => editRule(parseInt(btn.dataset.id)));
  });

  // Обработчики для кнопок удаления
  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteRule(parseInt(btn.dataset.id)));
  });
}

function openModal(title = "Добавить правило") {
  document.getElementById("modal-title").textContent = title;
  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
  form.reset();
  document.getElementById("rule-id").value = "";
}

async function editRule(id) {
  const res = await fetch(`/api/parse-rules/${id}`);
  const rule = await res.json();

  if (rule.error) {
    alert("Ошибка загрузки правила");
    return;
  }

  document.getElementById("rule-id").value = rule.id;
  document.getElementById("test-pattern").value = rule.test_pattern;
  document.getElementById("variable-part").value = rule.variable_part;
  document.getElementById("value-type").value = rule.value_type;
  document.getElementById("short-name").value = rule.short_name;

  openModal("Изменить правило");
}

async function deleteRule(id) {
  if (!confirm("Удалить это правило?")) return;

  const res = await fetch(`/api/parse-rules/${id}`, { method: "DELETE" });
  const data = await res.json();

  if (data.success) {
    loadRules();
  } else {
    alert("Ошибка удаления: " + (data.error || "неизвестная ошибка"));
  }
}

addBtn.addEventListener("click", () => {
  openModal("Добавить правило");
});

cancelBtn.addEventListener("click", closeModal);

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const ruleId = document.getElementById("rule-id").value;
  const testPattern = document.getElementById("test-pattern").value.trim();
  const variablePart = document.getElementById("variable-part").value.trim();
  const valueType = parseInt(document.getElementById("value-type").value);
  const shortName = document.getElementById("short-name").value.trim();

  // Валидация на клиенте
  if (!testPattern || !variablePart || !shortName) {
    alert("Заполните все обязательные поля");
    return;
  }

  if (!testPattern.includes(variablePart)) {
    alert("Изменяемая часть должна присутствовать в полной строке результата");
    return;
  }

  const payload = {
    test_pattern: testPattern,
    variable_part: variablePart,
    value_type: valueType,
    short_name: shortName
  };

  let res;
  if (ruleId) {
    // Обновление существующего правила
    res = await fetch(`/api/parse-rules/${ruleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    // Создание нового правила
    res = await fetch("/api/parse-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  const data = await res.json();

  if (data.success) {
    closeModal();
    loadRules();
  } else {
    alert("Ошибка: " + (data.error || "неизвестная ошибка"));
  }
});

// Загрузка правил при открытии страницы
document.addEventListener("DOMContentLoaded", loadRules);