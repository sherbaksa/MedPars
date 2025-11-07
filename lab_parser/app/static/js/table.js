// Таблица записей - управление данными и фильтрами

const urlParams = new URLSearchParams(window.location.search);
const initialBatch = urlParams.get("batch") || "";

const state = {
  page: 1,
  per_page: 10,
  q: "",
  gender: "",
  department: "",
  batch: initialBatch
};

function getParams() {
  const p = new URLSearchParams();
  p.set("page", state.page);
  p.set("per_page", state.per_page);
  if (state.q) p.set("q", state.q);
  if (state.gender) p.set("gender", state.gender);
  if (state.department) p.set("department", state.department);
  if (state.batch) p.set("batch", state.batch);
  return p;
}

async function loadData() {
  const res = await fetch(`/api/records?${getParams().toString()}`);
  const data = await res.json();

  const meta = document.getElementById("meta");

  if (data.error) {
    meta.textContent = `Ошибка: ${data.error}`;
    document.querySelector("#records tbody").innerHTML = "";
    return;
  }

  // Если нет файлов
  if (data.message) {
    meta.innerHTML = `${data.message} <a href="/upload">Загрузить файл</a>`;
    document.querySelector("#records tbody").innerHTML = "";
    document.getElementById("pageinfo-top").textContent = "0";
    document.getElementById("pageinfo-bottom").textContent = "0";
    return;
  }

  // Обновляем batch в state, если API вернул его (это последний файл)
  if (data.batch && !state.batch) {
    state.batch = data.batch;
  }

  // facets → заполнить фильтры один раз (если пусто)
  const gSel = document.getElementById("gender");
  const dSel = document.getElementById("department");
  if (gSel.options.length === 1) {
    (data.facets.genders || []).forEach(g => {
      const o = document.createElement("option");
      o.value = g;
      o.textContent = g;
      gSel.appendChild(o);
    });
  }
  if (dSel.options.length === 1) {
    (data.facets.departments || []).forEach(d => {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      dSel.appendChild(o);
    });
  }

  // мета - показываем имя файла
  const batchInfo = state.batch ? ` (файл: ${state.batch})` : '';
  meta.textContent = `Найдено: ${data.total}. Страница ${data.page}.${batchInfo}`;

  // Получаем test_columns (это теперь анализы, не отдельные показатели)
  const testColumns = data.test_columns || [];
  const rulesMap = data.rules_map || {};

  // Обновляем заголовки таблицы с динамическими колонками анализов
  const headerRow = document.getElementById("table-header");

  // Очищаем старые динамические колонки (если были)
  const existingDynamicCols = headerRow.querySelectorAll('.dynamic-test-col');
  existingDynamicCols.forEach(col => col.remove());

  // Добавляем новые колонки перед последней колонкой "Результат (полный)"
  const lastTh = headerRow.lastElementChild;
  testColumns.forEach(testName => {
    const th = document.createElement("th");
    th.textContent = testName;
    th.className = "dynamic-test-col";
    headerRow.insertBefore(th, lastTh);
  });

  // Проверяем, есть ли хотя бы одна запись с непустым filtered text
  let hasUnparsedResults = false;
  data.items.forEach(item => {
    const rawText = item.results?.raw_text ?? "";
    const tests = item.results?.tests || [];
    let filteredText = rawText;

    tests.forEach(test => {
      const ruleId = test.rule_id;
      const rule = rulesMap[ruleId];
      if (rule && rule.test_pattern) {
        const pattern = rule.test_pattern.replace(rule.variable_part, test.raw_value);
        filteredText = filteredText.replace(pattern, '');
      }
    });

    filteredText = filteredText.replace(/\s+/g, ' ').trim();
    if (filteredText.length > 0) {
      hasUnparsedResults = true;
    }
  });

  // Скрываем/показываем колонку "Результат (полный)" в зависимости от наличия непарсенных данных
  if (hasUnparsedResults) {
    lastTh.style.display = '';
  } else {
    lastTh.style.display = 'none';
  }

  // таблица
  const tbody = document.querySelector("#records tbody");
  tbody.innerHTML = "";
  data.items.forEach(item => {
    const tr = document.createElement("tr");
    const p = item.patient;
    const fio = [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(" ");

    // Формируем ссылку на детали с параметром batch, если он есть
    const detailUrl = state.batch
      ? `/api/record/${item.id}?batch=${encodeURIComponent(state.batch)}`
      : `/api/record/${item.id}`;

    // Обработка результатов
    const rawText = item.results?.raw_text ?? "";
    const tests = item.results?.tests || [];

    // Группируем показатели по test_definition_id (анализам)
    const testsByDefinition = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id; // fallback на rule_id
      if (!testsByDefinition[defId]) {
        testsByDefinition[defId] = [];
      }
      testsByDefinition[defId].push(test);
    });

    // Создаем маппинг: название анализа -> значения показателей
    const testValues = {};
    testColumns.forEach(testName => {
      testValues[testName] = [];
    });

    // Заполняем значения
    for (const defId in testsByDefinition) {
      const indicators = testsByDefinition[defId];
      // Берем short_name из первого показателя (они все относятся к одному анализу)
      const testName = indicators[0].name.split('-')[0]; // Убираем суффикс -1, -2

      // Собираем значения всех показателей этого анализа
      const values = indicators.map(ind => ind.value).filter(Boolean);

      if (testValues[testName] !== undefined) {
        testValues[testName] = values;
      }
    }

    // Удаляем распарсенные части из сырого текста
    let filteredText = rawText;

    // Группируем показатели по анализам для удаления
    const parsedDefinitions = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!parsedDefinitions[defId]) {
        parsedDefinitions[defId] = [];
      }
      parsedDefinitions[defId].push(test);
    });

    // Для каждого анализа удаляем все найденные показатели
    for (const defId in parsedDefinitions) {
      const indicators = parsedDefinitions[defId];

      // Удаляем каждый показатель
      indicators.forEach(test => {
        const ruleId = test.rule_id;
        const rule = rulesMap[ruleId];
        if (rule && rule.test_pattern) {
          const exactPattern = rule.test_pattern.replace(rule.variable_part, test.raw_value);
          filteredText = filteredText.replace(exactPattern, '');
        }
      });
    }

    // Очищаем пустые заголовки анализов (текст до двоеточия без показателей после)
    // Паттерн: "Определение ... в крови: " (двоеточие с пробелами, но без текста после до начала нового анализа)
    filteredText = filteredText.replace(
      /(?:Определение|Исследование|Выявление|Анализ)[^:]+:\s*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi,
      ''
    );

    // Очищаем лишние пробелы и знаки препинания
    filteredText = filteredText
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/^[,;\s]+/g, '')
      .replace(/[,;\s]+$/g, '')
      .trim();

    // Проверяем, нужно ли сокращать
    const needsTruncate = filteredText.length > 140;

    let resultCell = "";
    const showResultColumn = filteredText.length > 0;

    if (showResultColumn) {
      if (needsTruncate) {
        const shortText = filteredText.substring(0, 137);
        resultCell = `
          <span class="result-short">${shortText}<a href="#" class="expand-link" title="Показать полностью">...</a></span>
          <span class="result-full" style="display:none;">${filteredText} <a href="#" class="collapse-link" title="Свернуть">↑</a></span>
        `;
      } else {
        resultCell = filteredText;
      }
    } else {
      resultCell = '';
    }

    // Формируем ячейки для динамических колонок (анализов)
    let testColumnsCells = "";
    testColumns.forEach(testName => {
      const values = testValues[testName] || [];
      // Объединяем значения через <br>
      const cellContent = values.length > 0 ? values.join('<br>') : '';
      testColumnsCells += `<td>${cellContent}</td>`;
    });

    // Определяем стиль для последней ячейки (результат полный)
    const resultCellStyle = hasUnparsedResults ? '' : 'style="display:none;"';

    tr.innerHTML = `
      <td>${item.row_id ?? item.id}</td>
      <td><a href="${detailUrl}" target="_blank">${fio}</a></td>
      <td>${p.gender ?? ""}</td>
      <td>${p.age_years ?? ""}</td>
      <td>${p.birth_date ?? ""}</td>
      <td>${item.sample_id ?? ""}</td>
      <td>${item.department ?? ""}</td>
      ${testColumnsCells}
      <td class="result-cell" ${resultCellStyle}>${resultCell}</td>
    `;
    tbody.appendChild(tr);
  });

  // Добавляем обработчики для раскрытия/свертывания результатов
  tbody.querySelectorAll('.expand-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const cell = e.target.closest('.result-cell');
      cell.querySelector('.result-short').style.display = 'none';
      cell.querySelector('.result-full').style.display = 'inline';
    });
  });

  tbody.querySelectorAll('.collapse-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const cell = e.target.closest('.result-cell');
      cell.querySelector('.result-short').style.display = 'inline';
      cell.querySelector('.result-full').style.display = 'none';
    });
  });

  // пагинация
  const start = (data.page - 1) * data.per_page + 1;
  const end = Math.min(data.page * data.per_page, data.total);
  const totalPages = Math.ceil(data.total / data.per_page);

  // Обновляем оба блока с информацией о записях
  const pageInfoText = data.total ? `${start}–${end} из ${data.total}` : "0";
  document.getElementById("pageinfo-top").textContent = pageInfoText;
  document.getElementById("pageinfo-bottom").textContent = pageInfoText;

  // Обновляем состояние кнопок "Назад" и "Вперёд"
  const disablePrev = data.page <= 1;
  const disableNext = end >= data.total;

  document.getElementById("prev-top").disabled = disablePrev;
  document.getElementById("prev-bottom").disabled = disablePrev;
  document.getElementById("next-top").disabled = disableNext;
  document.getElementById("next-bottom").disabled = disableNext;

  // Генерируем номера страниц для обоих блоков
  renderPageNumbers("top", data.page, totalPages);
  renderPageNumbers("bottom", data.page, totalPages);
}

function renderPageNumbers(position, currentPage, totalPages) {
  const container = document.getElementById(`page-numbers-${position}`);
  container.innerHTML = "";

  if (totalPages <= 1) return;

  // Определяем диапазон страниц для отображения
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);

  // Корректируем диапазон, чтобы всегда показывать 5 страниц (если возможно)
  if (endPage - startPage < 4) {
    if (startPage === 1) {
      endPage = Math.min(totalPages, startPage + 4);
    } else if (endPage === totalPages) {
      startPage = Math.max(1, endPage - 4);
    }
  }

  // Первая страница и "..."
  if (startPage > 1) {
    addPageButton(container, 1, currentPage);
    if (startPage > 2) {
      addEllipsis(container);
    }
  }

  // Номера страниц
  for (let i = startPage; i <= endPage; i++) {
    addPageButton(container, i, currentPage);
  }

  // "..." и последняя страница
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      addEllipsis(container);
    }
    addPageButton(container, totalPages, currentPage);
  }
}

function addPageButton(container, pageNum, currentPage) {
  const btn = document.createElement("button");
  btn.textContent = pageNum;
  btn.className = pageNum === currentPage ? "page-btn active" : "page-btn";
  btn.disabled = pageNum === currentPage;
  btn.addEventListener("click", () => {
    state.page = pageNum;
    loadData();
  });
  container.appendChild(btn);
}

function addEllipsis(container) {
  const span = document.createElement("span");
  span.textContent = "...";
  span.className = "page-ellipsis";
  container.appendChild(span);
}

function initTable() {
  // Проверяем, что все необходимые элементы существуют
  const requiredElements = [
    'per-page-top', 'per-page-bottom',
    'prev-top', 'prev-bottom',
    'next-top', 'next-bottom',
    'apply', 'reset', 'q', 'gender', 'department'
  ];

  for (const id of requiredElements) {
    if (!document.getElementById(id)) {
      console.error(`Element with id "${id}" not found. Retrying...`);
      setTimeout(initTable, 100);
      return;
    }
  }

  // Получаем ссылки на элементы
  const perPageTop = document.getElementById("per-page-top");
  const perPageBottom = document.getElementById("per-page-bottom");

  // Устанавливаем начальное значение в селекте
  perPageTop.value = state.per_page;
  perPageBottom.value = state.per_page;

  // Обработчик изменения количества записей на странице (верхний)
  perPageTop.addEventListener("change", (e) => {
    state.per_page = parseInt(e.target.value);
    state.page = 1;
    perPageBottom.value = state.per_page;
    loadData();
  });

  // Обработчик изменения количества записей на странице (нижний)
  perPageBottom.addEventListener("change", (e) => {
    state.per_page = parseInt(e.target.value);
    state.page = 1;
    perPageTop.value = state.per_page;
    loadData();
  });

  document.getElementById("apply").addEventListener("click", () => {
    state.q = document.getElementById("q").value.trim();
    state.gender = document.getElementById("gender").value;
    state.department = document.getElementById("department").value;
    state.page = 1;
    loadData();
  });

  document.getElementById("reset").addEventListener("click", () => {
    document.getElementById("q").value = "";
    document.getElementById("gender").value = "";
    document.getElementById("department").value = "";
    state.q = state.gender = state.department = "";
    state.page = 1;
    loadData();
  });

  // Кнопки "Назад" (верхняя и нижняя)
  document.getElementById("prev-top").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      loadData();
    }
  });
  document.getElementById("prev-bottom").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      loadData();
    }
  });

  // Кнопки "Вперёд" (верхняя и нижняя)
  document.getElementById("next-top").addEventListener("click", () => {
    state.page++;
    loadData();
  });
  document.getElementById("next-bottom").addEventListener("click", () => {
    state.page++;
    loadData();
  });

  // первичная загрузка
  loadData();
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initTable);