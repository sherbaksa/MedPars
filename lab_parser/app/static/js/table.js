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
  showAll: false,
  testFilters: {}  // НОВОЕ: Фильтры по анализам { "COVID-19": ["Обнаружено"], ... }
};

// Глобальные данные
let allRecords = [];  // Все записи (до пагинации)
let testKeyIndicators = {};  // Информация о ключевых показателях

// Настройки колонок (порядок и видимость)
let columnSettings = {
  order: [],
  hidden: []
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

  if (columnSettings.order.length === 0) {
    columnSettings.order = allColumns.map(col => col.id);
  }

  const newOrder = [];

  columnSettings.order.forEach(colId => {
    const th = headerRow.querySelector(`th[data-column-id="${colId}"]`);
    if (th) {
      newOrder.push(th);
    }
  });

  allColumns.forEach(col => {
    if (!columnSettings.order.includes(col.id)) {
      const th = headerRow.querySelector(`th[data-column-id="${col.id}"]`);
      if (th) {
        newOrder.push(th);
        columnSettings.order.push(col.id);
      }
    }
  });

  headerRow.innerHTML = '';
  newOrder.forEach(th => headerRow.appendChild(th));

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

    const tbody = document.querySelector("#records tbody");
    tbody.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
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

// НОВОЕ: Открытие фильтра для колонки анализа
function openTestFilter(testName, event) {
  event.stopPropagation();

  // Закрываем все открытые фильтры
  document.querySelectorAll('.test-filter-menu').forEach(menu => menu.remove());

  const indicator = testKeyIndicators[testName];
  if (!indicator) return;

  // Создаём меню фильтра
  const menu = document.createElement('div');
  menu.className = 'test-filter-menu';

  // Заголовок
  const header = document.createElement('div');
  header.className = 'filter-menu-header';
  header.innerHTML = `
    <strong>Фильтр: ${testName}</strong><br>
    <small>Показатель: ${indicator.indicator_name}</small>
  `;
  menu.appendChild(header);

  // Список значений с чекбоксами
  const valuesList = document.createElement('div');
  valuesList.className = 'filter-values-list';

  const currentFilters = state.testFilters[testName] || [];

  indicator.possible_values.forEach(value => {
    const label = document.createElement('label');
    label.className = 'filter-value-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.checked = currentFilters.includes(value);

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (!state.testFilters[testName]) {
          state.testFilters[testName] = [];
        }
        if (!state.testFilters[testName].includes(value)) {
          state.testFilters[testName].push(value);
        }
      } else {
        if (state.testFilters[testName]) {
          state.testFilters[testName] = state.testFilters[testName].filter(v => v !== value);
          if (state.testFilters[testName].length === 0) {
            delete state.testFilters[testName];
          }
        }
      }
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + value));
    valuesList.appendChild(label);
  });

  menu.appendChild(valuesList);

  // Кнопки действий
  const actions = document.createElement('div');
  actions.className = 'filter-menu-actions';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Все';
  selectAllBtn.className = 'filter-btn-small';
  selectAllBtn.addEventListener('click', () => {
    valuesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Сбросить';
  clearBtn.className = 'filter-btn-small';
  clearBtn.addEventListener('click', () => {
    valuesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    });
  });

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Применить';
  applyBtn.className = 'filter-btn-primary';
  applyBtn.addEventListener('click', () => {
    menu.remove();
    applyFilters();
  });

  actions.appendChild(selectAllBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(applyBtn);
  menu.appendChild(actions);

  // Позиционируем меню под иконкой
  const icon = event.currentTarget;
  const rect = icon.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 5) + 'px';
  menu.style.left = rect.left + 'px';

  document.body.appendChild(menu);

  // Закрытие при клике вне меню
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== icon) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

// НОВОЕ: Применение фильтров
function applyFilters() {
  state.page = 1;  // Сбрасываем на первую страницу
  renderTable();
  updateActiveFiltersPanel();
}

// НОВОЕ: Обновление панели активных фильтров
function updateActiveFiltersPanel() {
  let panel = document.getElementById('active-filters-panel');

  const hasFilters = Object.keys(state.testFilters).length > 0;

  if (!hasFilters) {
    if (panel) panel.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'active-filters-panel';
    panel.className = 'active-filters-panel';

    const metaDiv = document.getElementById('meta');
    metaDiv.parentNode.insertBefore(panel, metaDiv.nextSibling);
  }

  panel.innerHTML = '<strong>Активные фильтры анализов:</strong> ';

  const filterTags = document.createElement('div');
  filterTags.className = 'filter-tags';

  Object.keys(state.testFilters).forEach(testName => {
    const values = state.testFilters[testName];
    if (values && values.length > 0) {
      const tag = document.createElement('span');
      tag.className = 'filter-tag';
      tag.innerHTML = `
        ${testName}: ${values.join(', ')}
        <span class="filter-tag-close" data-test="${testName}">×</span>
      `;

      tag.querySelector('.filter-tag-close').addEventListener('click', () => {
        delete state.testFilters[testName];
        applyFilters();
      });

      filterTags.appendChild(tag);
    }
  });

  const clearAllBtn = document.createElement('button');
  clearAllBtn.textContent = 'Очистить все';
  clearAllBtn.className = 'filter-clear-all';
  clearAllBtn.addEventListener('click', () => {
    state.testFilters = {};
    applyFilters();
  });

  panel.appendChild(filterTags);
  panel.appendChild(clearAllBtn);
}

// НОВОЕ: Фильтрация записей по анализам
function filterRecordsByTests(records) {
  if (Object.keys(state.testFilters).length === 0) {
    return records;
  }

  return records.filter(item => {
    // Режим ИЛИ: запись подходит если соответствует ХОТЯ БЫ ОДНОМУ фильтру
    for (const testName in state.testFilters) {
      const filterValues = state.testFilters[testName];
      if (!filterValues || filterValues.length === 0) continue;

      // Ищем ключевой показатель этого анализа в записи
      const tests = item.results?.tests || [];
      const indicator = testKeyIndicators[testName];
      if (!indicator) continue;

      for (const test of tests) {
        // Проверяем что это нужный анализ и ключевой показатель
        if (test.test_definition_id === indicator.test_definition_id &&
            test.rule_id === indicator.rule_id &&
            test.is_key_indicator) {
          // Проверяем значение
          const rawValue = test.raw_value;
          if (filterValues.includes(rawValue)) {
            return true;  // Найдено совпадение - показываем запись
          }
        }
      }
    }

    return false;  // Не найдено совпадений ни по одному фильтру
  });
}

// Открытие модального окна настроек колонок
function openColumnSettings() {
  const modal = document.getElementById('column-settings-modal');
  const columnsList = document.getElementById('columns-list');
  const allColumns = getAllColumns();

  columnsList.innerHTML = '';

  const orderedColumns = [];

  columnSettings.order.forEach(colId => {
    const col = allColumns.find(c => c.id === colId);
    if (col) orderedColumns.push(col);
  });

  allColumns.forEach(col => {
    if (!orderedColumns.find(c => c.id === col.id)) {
      orderedColumns.push(col);
    }
  });

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

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        columnSettings.hidden = columnSettings.hidden.filter(id => id !== col.id);
        item.classList.remove('disabled');
      } else {
        if (!columnSettings.hidden.includes(col.id)) {
          columnSettings.hidden.push(col.id);
        }
        item.classList.add('disabled');
      }
      applyColumnSettings();
    });

    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragleave', handleDragLeave);

    columnsList.appendChild(item);
  });

  modal.style.display = 'flex';
}

function closeColumnSettings() {
  const modal = document.getElementById('column-settings-modal');
  modal.style.display = 'none';
}

function resetColumnSettings() {
  if (confirm('Вы уверены, что хотите сбросить настройки колонок?')) {
    columnSettings = { order: [], hidden: [] };
    saveColumnSettings();
    loadData();
    closeColumnSettings();
  }
}

let draggedElement = null;

function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');

  document.querySelectorAll('.column-item').forEach(item => {
    item.classList.remove('drag-over');
  });

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

function syncColumnWidths() {
  const headerTable = document.querySelector('.table-header-wrapper table');
  const bodyTable = document.querySelector('.table-body-wrapper table');

  if (!headerTable || !bodyTable) return;

  const headerCells = headerTable.querySelectorAll('thead th');
  const bodyRows = bodyTable.querySelectorAll('tbody tr');

  if (bodyRows.length === 0) return;

  const bodyCells = bodyRows[0].querySelectorAll('td');

  headerCells.forEach(cell => {
    cell.style.width = '';
    cell.style.minWidth = '';
    cell.style.maxWidth = '';
  });

  bodyCells.forEach(cell => {
    cell.style.width = '';
    cell.style.minWidth = '';
    cell.style.maxWidth = '';
  });

  requestAnimationFrame(() => {
    const widths = [];
    bodyCells.forEach(cell => {
      widths.push(cell.offsetWidth);
    });

    headerCells.forEach((cell, index) => {
      if (widths[index]) {
        const width = widths[index] + 'px';
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
      }
    });

    bodyCells.forEach((cell, index) => {
      if (widths[index]) {
        const width = widths[index] + 'px';
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
      }
    });

    const bodyTableWidth = bodyTable.offsetWidth;
    headerTable.style.width = bodyTableWidth + 'px';
  });
}

function getParams() {
  const p = new URLSearchParams();
  p.set("page", 1);
  p.set("per_page", 999999);
  if (state.q) p.set("q", state.q);
  if (state.gender) p.set("gender", state.gender);
  if (state.department) p.set("department", state.department);
  if (state.batch) p.set("batch", state.batch);
  return p;
}

async function loadData() {
  const params = getParams();
  const res = await fetch(`/api/records?${params.toString()}`);
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

  // НОВОЕ: Сохраняем информацию о ключевых показателях
  testKeyIndicators = data.test_key_indicators || {};

  // Сохраняем rulesMap глобально для использования в renderTable
  window.rulesMapGlobal = data.rules_map || {};

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

  const testColumns = data.test_columns || [];
  const rulesMap = data.rules_map || {};

  const headerRow = document.getElementById("table-header");

  const existingDynamicCols = headerRow.querySelectorAll('.dynamic-test-col');
  existingDynamicCols.forEach(col => col.remove());

  const lastTh = headerRow.querySelector('th[data-column-id="full_result"]');
  testColumns.forEach(testName => {
    const th = document.createElement("th");
    th.className = "dynamic-test-col";
    th.setAttribute('data-column-id', `test_${testName}`);

    // НОВОЕ: Добавляем иконку фильтра если есть ключевой показатель
    if (testKeyIndicators[testName]) {
      const filterIcon = document.createElement('span');
      filterIcon.className = 'filter-icon';
      filterIcon.textContent = '▼';
      filterIcon.title = 'Фильтр';

      // Проверяем активен ли фильтр
      if (state.testFilters[testName] && state.testFilters[testName].length > 0) {
        filterIcon.classList.add('filter-active');
      }

      filterIcon.addEventListener('click', (e) => openTestFilter(testName, e));

      th.innerHTML = `${testName} `;
      th.appendChild(filterIcon);
    } else {
      th.textContent = testName;
    }

    headerRow.insertBefore(th, lastTh);
  });

  // Сохраняем все записи
  allRecords = data.items;

  // Рендерим таблицу
  renderTable();

  // Обновляем панель активных фильтров
  updateActiveFiltersPanel();

  let hasUnparsedResults = false;
  allRecords.forEach(item => {
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

  if (hasUnparsedResults) {
    lastTh.style.display = '';
  } else {
    lastTh.style.display = 'none';
  }

  applyColumnSettings();

  const headerWrapper = document.querySelector('.table-header-wrapper');
  const bodyWrapper = document.querySelector('.table-body-wrapper');

  if (headerWrapper && bodyWrapper) {
    bodyWrapper.addEventListener('scroll', () => {
      headerWrapper.scrollLeft = bodyWrapper.scrollLeft;
    });
  }

  syncColumnWidths();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncColumnWidths();
    }, 100);
  });

  const batchInfo = state.batch ? ` (файл: ${state.batch})` : '';
  meta.textContent = `Найдено: ${allRecords.length}. ${batchInfo}`;
}

// НОВОЕ: Рендеринг таблицы с учётом фильтров и пагинации
function renderTable() {
  // Применяем фильтры по анализам
  let filtered = filterRecordsByTests(allRecords);

  const total = filtered.length;
  const start = (state.page - 1) * (state.showAll ? total : state.per_page);
  const end = state.showAll ? total : start + state.per_page;
  const items = filtered.slice(start, end);

  const testColumns = Object.keys(testKeyIndicators);
  const tbody = document.querySelector("#records tbody");
  tbody.innerHTML = "";

  items.forEach(item => {
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

      // Показываем ВСЕ значения показателей
      const values = indicators.map(ind => ind.value).filter(Boolean);

      if (testValues[testName] !== undefined) {
        testValues[testName] = values;
      }
    }

    // Получаем rulesMap из глобального контекста (нужно его сохранить при загрузке)
    let filteredText = rawText;

    const parsedDefinitions = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!parsedDefinitions[defId]) {
        parsedDefinitions[defId] = [];
      }
      parsedDefinitions[defId].push(test);
    });

    // Используем ту же логику что была в оригинале
    for (const defId in parsedDefinitions) {
      const indicators = parsedDefinitions[defId];
      indicators.forEach(test => {
        const ruleId = test.rule_id;
        const rule = window.rulesMapGlobal ? window.rulesMapGlobal[ruleId] : null;
        if (rule && rule.test_pattern) {
          const exactPattern = rule.test_pattern.replace(rule.variable_part, test.raw_value);
          filteredText = filteredText.replace(exactPattern + ';', '');
          filteredText = filteredText.replace(exactPattern, '');
        }
      });
    }

    filteredText = filteredText
      .replace(/:\s*[;,\s]*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, ': ')
      .replace(/(?:Определение|Исследование|Выявление|Анализ)[^:]+:\s*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, '')
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

    tr.innerHTML = `
      <td data-column-id="row_number">${item.row_id ?? item.id}</td>
      <td data-column-id="fio"><a href="${detailUrl}" target="_blank">${fio}</a></td>
      <td data-column-id="gender">${p.gender ?? ""}</td>
      <td data-column-id="age">${p.age_years ?? ""}</td>
      <td data-column-id="birth_date">${p.birth_date ?? ""}</td>
      <td data-column-id="sample_id">${item.sample_id ?? ""}</td>
      <td data-column-id="department">${item.department ?? ""}</td>
      ${testColumnsCells}
      <td class="result-cell" data-column-id="full_result">${resultCell}</td>
    `;
    tbody.appendChild(tr);
  });

  applyColumnSettings();

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        return;
      }
      tr.classList.toggle('expanded');
      setTimeout(() => syncColumnWidths(), 50);
    });
  });

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
  const totalPages = Math.ceil(total / state.per_page);
  const endItem = Math.min(end, total);

  let pageInfoText;
  if (state.showAll) {
    pageInfoText = total ? `Все ${total}` : "0";
  } else {
    pageInfoText = total ? `${start + 1}–${endItem} из ${total}` : "0";
  }
  document.getElementById("pageinfo-top").textContent = pageInfoText;

  const disablePrev = state.page <= 1;
  const disableNext = endItem >= total;

  document.getElementById("prev-top").disabled = disablePrev || state.showAll;
  document.getElementById("next-top").disabled = disableNext || state.showAll;

  if (state.showAll) {
    document.getElementById("page-numbers-top").style.display = 'none';
  } else {
    document.getElementById("page-numbers-top").style.display = 'flex';
    renderPageNumbers("top", state.page, totalPages);
  }

  syncColumnWidths();
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
    renderTable();
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

  loadColumnSettings();

  const perPageTop = document.getElementById("per-page-top");

  perPageTop.value = state.showAll ? 'all' : state.per_page;

  perPageTop.addEventListener("change", (e) => {
    const value = e.target.value;

    if (value === 'all') {
      state.showAll = true;
      state.page = 1;
    } else {
      state.showAll = false;
      state.per_page = parseInt(value);
      state.page = 1;
    }

    renderTable();
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
    state.testFilters = {};
    state.page = 1;
    loadData();
  });

  document.getElementById("prev-top").addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderTable();
    }
  });

  document.getElementById("next-top").addEventListener("click", () => {
    state.page++;
    renderTable();
  });

  document.getElementById("column-settings-btn").addEventListener("click", openColumnSettings);
  document.getElementById("close-modal-btn").addEventListener("click", closeColumnSettings);
  document.getElementById("reset-columns-btn").addEventListener("click", resetColumnSettings);

  document.getElementById("column-settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "column-settings-modal") {
      closeColumnSettings();
    }
  });

  loadData();
}

document.addEventListener('DOMContentLoaded', initTable);