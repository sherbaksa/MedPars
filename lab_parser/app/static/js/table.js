// Таблица записей - управление данными и фильтрами

const urlParams = new URLSearchParams(window.location.search);
const initialBatch = urlParams.get("batch") || "";

const state = {
  page: 1,
  per_page: 10,
  q: "",
  gender: "",
  department: "",
  batch: initialBatch,
  showAll: false  // Флаг для отображения всех записей
};

// Настройки колонок (порядок и видимость)
let columnSettings = {
  order: [],  // Порядок колонок по их ID
  hidden: []  // Скрытые колонки
};

// Загрузка настроек колонок из localStorage
function loadColumnSettings() {
  try {
    const saved = localStorage.getItem('tableColumnSettings');
    if (saved) {
      columnSettings = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Ошибка загрузки настроек колонок:', e);
  }
}

// Сохранение настроек колонок в localStorage
function saveColumnSettings() {
  try {
    localStorage.setItem('tableColumnSettings', JSON.stringify(columnSettings));
  } catch (e) {
    console.error('Ошибка сохранения настроек колонок:', e);
  }
}

// Получение всех колонок (статических и динамических)
function getAllColumns() {
  const headerRow = document.getElementById("table-header");
  const columns = [];

  headerRow.querySelectorAll('th').forEach(th => {
    const columnId = th.getAttribute('data-column-id');
    const columnName = th.textContent.trim();
    if (columnId) {
      columns.push({ id: columnId, name: columnName });
    }
  });

  return columns;
}

// Применение настроек колонок к таблице
function applyColumnSettings() {
  const headerRow = document.getElementById("table-header");
  const allColumns = getAllColumns();

  // Если нет сохраненного порядка - используем текущий
  if (columnSettings.order.length === 0) {
    columnSettings.order = allColumns.map(col => col.id);
  }

  // Обновляем порядок колонок
  const newOrder = [];

  // Сначала добавляем колонки в сохраненном порядке
  columnSettings.order.forEach(colId => {
    const th = headerRow.querySelector(`th[data-column-id="${colId}"]`);
    if (th) {
      newOrder.push(th);
    }
  });

  // Добавляем новые колонки, которых не было в настройках
  allColumns.forEach(col => {
    if (!columnSettings.order.includes(col.id)) {
      const th = headerRow.querySelector(`th[data-column-id="${col.id}"]`);
      if (th) {
        newOrder.push(th);
        columnSettings.order.push(col.id);
      }
    }
  });

  // Перестраиваем заголовок
  headerRow.innerHTML = '';
  newOrder.forEach(th => headerRow.appendChild(th));

  // Применяем скрытие колонок
  allColumns.forEach((col, index) => {
    const isHidden = columnSettings.hidden.includes(col.id);
    const th = headerRow.querySelector(`th[data-column-id="${col.id}"]`);

    if (th) {
      if (isHidden) {
        th.classList.add('hidden-column');
      } else {
        th.classList.remove('hidden-column');
      }
    }

    // Применяем к ячейкам в tbody
    const tbody = document.querySelector("#records tbody");
    tbody.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      // Находим индекс колонки в текущем порядке
      const colIndex = Array.from(headerRow.querySelectorAll('th')).findIndex(
        th => th.getAttribute('data-column-id') === col.id
      );

      if (colIndex >= 0 && cells[colIndex]) {
        if (isHidden) {
          cells[colIndex].classList.add('hidden-column');
        } else {
          cells[colIndex].classList.remove('hidden-column');
        }
      }
    });
  });

  saveColumnSettings();
}

// Открытие модального окна настроек колонок
function openColumnSettings() {
  const modal = document.getElementById('column-settings-modal');
  const columnsList = document.getElementById('columns-list');
  const allColumns = getAllColumns();

  // Очищаем список
  columnsList.innerHTML = '';

  // Создаем отсортированный список колонок
  const orderedColumns = [];

  // Сначала в порядке из настроек
  columnSettings.order.forEach(colId => {
    const col = allColumns.find(c => c.id === colId);
    if (col) orderedColumns.push(col);
  });

  // Добавляем новые колонки
  allColumns.forEach(col => {
    if (!orderedColumns.find(c => c.id === col.id)) {
      orderedColumns.push(col);
    }
  });

  // Создаем элементы для каждой колонки
  orderedColumns.forEach((col, index) => {
    const isHidden = columnSettings.hidden.includes(col.id);

    const item = document.createElement('div');
    item.className = 'column-item' + (isHidden ? ' disabled' : '');
    item.setAttribute('data-column-id', col.id);
    item.setAttribute('draggable', 'true');

    item.innerHTML = `
      <span class="drag-handle">⋮⋮</span>
      <input type="checkbox" id="col-${col.id}" ${isHidden ? '' : 'checked'}>
      <label for="col-${col.id}">${col.name}</label>
    `;

    // Обработчик изменения чекбокса
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Показываем колонку
        columnSettings.hidden = columnSettings.hidden.filter(id => id !== col.id);
        item.classList.remove('disabled');
      } else {
        // Скрываем колонку
        if (!columnSettings.hidden.includes(col.id)) {
          columnSettings.hidden.push(col.id);
        }
        item.classList.add('disabled');
      }
      applyColumnSettings();
    });

    // Drag and Drop обработчики
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragleave', handleDragLeave);

    columnsList.appendChild(item);
  });

  modal.style.display = 'flex';
}

// Закрытие модального окна
function closeColumnSettings() {
  const modal = document.getElementById('column-settings-modal');
  modal.style.display = 'none';
}

// Сброс настроек колонок
function resetColumnSettings() {
  if (confirm('Вы уверены, что хотите сбросить настройки колонок?')) {
    columnSettings = { order: [], hidden: [] };
    saveColumnSettings();

    // Перезагружаем таблицу
    loadData();
    closeColumnSettings();
  }
}

// Drag and Drop обработчики
let draggedElement = null;

function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');

  // Убираем класс drag-over со всех элементов
  document.querySelectorAll('.column-item').forEach(item => {
    item.classList.remove('drag-over');
  });

  // Обновляем порядок в настройках
  const columnsList = document.getElementById('columns-list');
  const newOrder = [];
  columnsList.querySelectorAll('.column-item').forEach(item => {
    newOrder.push(item.getAttribute('data-column-id'));
  });
  columnSettings.order = newOrder;

  applyColumnSettings();
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }

  e.dataTransfer.dropEffect = 'move';

  if (this !== draggedElement) {
    this.classList.add('drag-over');
  }

  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedElement !== this) {
    const columnsList = document.getElementById('columns-list');
    const allItems = Array.from(columnsList.querySelectorAll('.column-item'));
    const draggedIndex = allItems.indexOf(draggedElement);
    const targetIndex = allItems.indexOf(this);

    if (draggedIndex < targetIndex) {
      this.parentNode.insertBefore(draggedElement, this.nextSibling);
    } else {
      this.parentNode.insertBefore(draggedElement, this);
    }
  }

  this.classList.remove('drag-over');

  return false;
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function getParams() {
  const p = new URLSearchParams();
  p.set("page", state.page);
  // Если выбрано "Все", устанавливаем большое значение per_page
  p.set("per_page", state.showAll ? 10000 : state.per_page);
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

  if (data.message) {
    meta.innerHTML = `${data.message} <a href="/upload">Загрузить файл</a>`;
    document.querySelector("#records tbody").innerHTML = "";
    document.getElementById("pageinfo-top").textContent = "0";
    return;
  }

  if (data.batch && !state.batch) {
    state.batch = data.batch;
  }

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

  const batchInfo = state.batch ? ` (файл: ${state.batch})` : '';
  meta.textContent = `Найдено: ${data.total}. Страница ${data.page}.${batchInfo}`;

  const testColumns = data.test_columns || [];
  const rulesMap = data.rules_map || {};

  const headerRow = document.getElementById("table-header");

  // Очищаем старые динамические колонки
  const existingDynamicCols = headerRow.querySelectorAll('.dynamic-test-col');
  existingDynamicCols.forEach(col => col.remove());

  // Добавляем новые колонки перед последней колонкой "Результат (полный)"
  const lastTh = headerRow.querySelector('th[data-column-id="full_result"]');
  testColumns.forEach(testName => {
    const th = document.createElement("th");
    th.textContent = testName;
    th.className = "dynamic-test-col";
    th.setAttribute('data-column-id', `test_${testName}`);
    headerRow.insertBefore(th, lastTh);
  });

  // Проверяем, есть ли хотя бы одна запись с непустым filtered text
  let hasUnparsedResults = false;
  data.items.forEach(item => {
    const rawText = item.results?.raw_text ?? "";
    const tests = item.results?.tests || [];
    let filteredText = rawText;

    const parsedDefinitions = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!parsedDefinitions[defId]) {
        parsedDefinitions[defId] = [];
      }
      parsedDefinitions[defId].push(test);
    });

    for (const defId in parsedDefinitions) {
      const indicators = parsedDefinitions[defId];
      indicators.forEach(test => {
        const ruleId = test.rule_id;
        const rule = rulesMap[ruleId];
        if (rule && rule.test_pattern) {
          const pattern = rule.test_pattern.replace(rule.variable_part, test.raw_value);
          filteredText = filteredText.replace(pattern + ';', '');
          filteredText = filteredText.replace(pattern, '');
        }
      });
    }

    filteredText = filteredText.replace(/:\s*[;,\s]*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, ': ');
    filteredText = filteredText.replace(
      /(?:Определение|Исследование|Выявление|Анализ)[^:]+:\s*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi,
      ''
    );
    filteredText = filteredText
      .replace(/\s+/g, ' ')
      .replace(/[;,\s]+$/g, '')
      .replace(/^[;,\s]+/g, '')
      .trim();

    if (filteredText.length > 0) {
      hasUnparsedResults = true;
    }
  });

  // Скрываем/показываем колонку "Результат (полный)"
  if (hasUnparsedResults) {
    lastTh.style.display = '';
  } else {
    lastTh.style.display = 'none';
  }

  // Применяем настройки колонок
  applyColumnSettings();

  // Заполняем таблицу
  const tbody = document.querySelector("#records tbody");
  tbody.innerHTML = "";
  data.items.forEach(item => {
    const tr = document.createElement("tr");
    const p = item.patient;
    const fio = [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(" ");

    const detailUrl = state.batch
      ? `/api/record/${item.id}?batch=${encodeURIComponent(state.batch)}`
      : `/api/record/${item.id}`;

    const rawText = item.results?.raw_text ?? "";
    const tests = item.results?.tests || [];

    const testsByDefinition = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!testsByDefinition[defId]) {
        testsByDefinition[defId] = [];
      }
      testsByDefinition[defId].push(test);
    });

    const testValues = {};
    testColumns.forEach(testName => {
      testValues[testName] = [];
    });

    for (const defId in testsByDefinition) {
      const indicators = testsByDefinition[defId];
      const testName = indicators[0].name.split('-')[0];
      const values = indicators.map(ind => ind.value).filter(Boolean);

      if (testValues[testName] !== undefined) {
        testValues[testName] = values;
      }
    }

    let filteredText = rawText;

    const parsedDefinitions = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!parsedDefinitions[defId]) {
        parsedDefinitions[defId] = [];
      }
      parsedDefinitions[defId].push(test);
    });

    for (const defId in parsedDefinitions) {
      const indicators = parsedDefinitions[defId];
      indicators.forEach(test => {
        const ruleId = test.rule_id;
        const rule = rulesMap[ruleId];
        if (rule && rule.test_pattern) {
          const exactPattern = rule.test_pattern.replace(rule.variable_part, test.raw_value);
          filteredText = filteredText.replace(exactPattern + ';', '');
          filteredText = filteredText.replace(exactPattern, '');
        }
      });
    }

    filteredText = filteredText.replace(/:\s*[;,\s]*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, ': ');
    filteredText = filteredText.replace(
      /(?:Определение|Исследование|Выявление|Анализ)[^:]+:\s*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi,
      ''
    );
    filteredText = filteredText
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/^[,;\s]+/g, '')
      .replace(/[,;\s]+$/g, '')
      .trim();

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

    let testColumnsCells = "";
    testColumns.forEach(testName => {
      const values = testValues[testName] || [];
      const cellContent = values.length > 0 ? values.join('<br>') : '';
      testColumnsCells += `<td data-column-id="test_${testName}">${cellContent}</td>`;
    });

    const resultCellStyle = hasUnparsedResults ? '' : 'style="display:none;"';

    tr.innerHTML = `
      <td data-column-id="row_number">${item.row_id ?? item.id}</td>
      <td data-column-id="fio"><a href="${detailUrl}" target="_blank">${fio}</a></td>
      <td data-column-id="gender">${p.gender ?? ""}</td>
      <td data-column-id="age">${p.age_years ?? ""}</td>
      <td data-column-id="birth_date">${p.birth_date ?? ""}</td>
      <td data-column-id="sample_id">${item.sample_id ?? ""}</td>
      <td data-column-id="department">${item.department ?? ""}</td>
      ${testColumnsCells}
      <td class="result-cell" data-column-id="full_result" ${resultCellStyle}>${resultCell}</td>
    `;
    tbody.appendChild(tr);
  });

  // Применяем настройки колонок к ячейкам
  applyColumnSettings();

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

  // Пагинация
  const start = (data.page - 1) * data.per_page + 1;
  const end = Math.min(data.page * data.per_page, data.total);
  const totalPages = Math.ceil(data.total / data.per_page);

  // Обновляем информацию о записях
  let pageInfoText;
  if (state.showAll) {
    pageInfoText = data.total ? `Все ${data.total}` : "0";
  } else {
    pageInfoText = data.total ? `${start}–${end} из ${data.total}` : "0";
  }
  document.getElementById("pageinfo-top").textContent = pageInfoText;

  const disablePrev = data.page <= 1;
  const disableNext = end >= data.total;

  document.getElementById("prev-top").disabled = disablePrev || state.showAll;
  document.getElementById("next-top").disabled = disableNext || state.showAll;

  // Скрываем пагинацию если выбрано "Все"
  if (state.showAll) {
    document.getElementById("page-numbers-top").style.display = 'none';
  } else {
    document.getElementById("page-numbers-top").style.display = 'flex';
    renderPageNumbers("top", data.page, totalPages);
  }
}

function renderPageNumbers(position, currentPage, totalPages) {
  const container = document.getElementById(`page-numbers-${position}`);
  container.innerHTML = "";

  if (totalPages <= 1) return;

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);

  if (endPage - startPage < 4) {
    if (startPage === 1) {
      endPage = Math.min(totalPages, startPage + 4);
    } else if (endPage === totalPages) {
      startPage = Math.max(1, endPage - 4);
    }
  }

  if (startPage > 1) {
    addPageButton(container, 1, currentPage);
    if (startPage > 2) {
      addEllipsis(container);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    addPageButton(container, i, currentPage);
  }

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
  const requiredElements = [
    'per-page-top',
    'prev-top',
    'next-top',
    'apply', 'reset', 'q', 'gender', 'department'
  ];

  for (const id of requiredElements) {
    if (!document.getElementById(id)) {
      console.error(`Element with id "${id}" not found. Retrying...`);
      setTimeout(initTable, 100);
      return;
    }
  }

  // Загружаем настройки колонок
  loadColumnSettings();

  const perPageTop = document.getElementById("per-page-top");

  perPageTop.value = state.showAll ? 'all' : state.per_page;

  perPageTop.addEventListener("change", (e) => {
    const value = e.target.value;

    if (value === 'all') {
      state.showAll = true;
      state.page = 1;  // Сбрасываем на первую страницу
    } else {
      state.showAll = false;
      state.per_page = parseInt(value);
      state.page = 1;
    }

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

  // Кнопки пагинации
  document.getElementById("prev-top").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      loadData();
    }
  });

  document.getElementById("next-top").addEventListener("click", () => {
    state.page++;
    loadData();
  });

  // Управление колонками
  document.getElementById("column-settings-btn").addEventListener("click", openColumnSettings);
  document.getElementById("close-modal-btn").addEventListener("click", closeColumnSettings);
  document.getElementById("reset-columns-btn").addEventListener("click", resetColumnSettings);

  // Закрытие модального окна по клику вне его
  document.getElementById("column-settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "column-settings-modal") {
      closeColumnSettings();
    }
  });

  // Первичная загрузка
  loadData();
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initTable);