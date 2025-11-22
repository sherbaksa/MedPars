const urlParams = new URLSearchParams(window.location.search);

const reportState = {
  q: urlParams.get("q") || "",
  gender: urlParams.get("gender") || "",
  department: urlParams.get("department") || "",
  batch: urlParams.get("batch") || "",
  testFilters: {},
  columnOrder: [],
  columnHidden: []
};

// Парсим фильтры по тестам
try {
  const testFiltersParam = urlParams.get("testFilters");
  if (testFiltersParam) {
    reportState.testFilters = JSON.parse(testFiltersParam);
  }
} catch (e) {
  console.error("Error parsing testFilters:", e);
}

// Парсим порядок колонок
try {
  const columnOrderParam = urlParams.get("columnOrder");
  if (columnOrderParam) {
    reportState.columnOrder = JSON.parse(columnOrderParam);
  }
} catch (e) {
  console.error("Error parsing columnOrder:", e);
}

// Парсим скрытые колонки
try {
  const columnHiddenParam = urlParams.get("columnHidden");
  if (columnHiddenParam) {
    reportState.columnHidden = JSON.parse(columnHiddenParam);
  }
} catch (e) {
  console.error("Error parsing columnHidden:", e);
}

let allRecords = [];
let testKeyIndicators = {};

function getApiParams() {
  const p = new URLSearchParams();
  p.set("page", 1);
  p.set("per_page", 999999); // Получаем все записи
  if (reportState.q) p.set("q", reportState.q);
  if (reportState.gender) p.set("gender", reportState.gender);
  if (reportState.department) p.set("department", reportState.department);
  if (reportState.batch) p.set("batch", reportState.batch);
  return p;
}

function filterRecordsByTests(records) {
  if (Object.keys(reportState.testFilters).length === 0) {
    return records;
  }

  return records.filter(item => {
    for (const testName in reportState.testFilters) {
      const filterValues = reportState.testFilters[testName];
      if (!filterValues || filterValues.length === 0) continue;

      const tests = item.results?.tests || [];
      const indicator = testKeyIndicators[testName];
      if (!indicator) continue;

      for (const test of tests) {
        if (test.test_definition_id === indicator.test_definition_id &&
            test.rule_id === indicator.rule_id &&
            test.is_key_indicator) {
          const rawValue = test.raw_value;
          if (filterValues.includes(rawValue)) {
            return true;
          }
        }
      }
    }

    return false;
  });
}

async function loadReportData() {
  const params = getApiParams();

  try {
    const res = await fetch(`/api/records?${params.toString()}`);
    const data = await res.json();

    if (data.error) {
      document.getElementById("report-content").innerHTML = `<p style="color: red;">Ошибка: ${data.error}</p>`;
      return;
    }

    if (data.message) {
      document.getElementById("report-content").innerHTML = `<p>${data.message}</p>`;
      return;
    }

    testKeyIndicators = data.test_key_indicators || {};
    allRecords = data.items;

    // Применяем фильтры по тестам
    const filtered = filterRecordsByTests(allRecords);

    renderReport(filtered, data.test_columns || [], data.rules_map || {});
  } catch (error) {
    document.getElementById("report-content").innerHTML = `<p style="color: red;">Ошибка загрузки данных: ${error.message}</p>`;
  }
}

function renderReport(records, testColumns, rulesMap) {
  const reportContent = document.getElementById("report-content");

  if (records.length === 0) {
    reportContent.innerHTML = '<p>Нет данных для отображения.</p>';
    return;
  }

  // Определяем порядок колонок
  const defaultColumns = ['row_number', 'fio', 'gender', 'age', 'birth_date', 'sample_id', 'department'];
  const testColumnIds = testColumns.map(name => `test_${name}`);
  const allColumnIds = [...defaultColumns, ...testColumnIds, 'full_result', 'notes'];

  let orderedColumns = reportState.columnOrder.length > 0
    ? reportState.columnOrder.filter(id => allColumnIds.includes(id) && id !== 'notes')
    : allColumnIds.filter(id => id !== 'notes');

  // Добавляем колонку "Примечания" в конец
  orderedColumns.push('notes');

  // Убираем скрытые колонки
  const visibleColumns = orderedColumns.filter(id => !reportState.columnHidden.includes(id));

  // Названия колонок
  const columnNames = {
    'row_number': '#',
    'fio': 'ФИО',
    'gender': 'Пол',
    'age': 'Возраст',
    'birth_date': 'ДР',
    'sample_id': 'Идентификатор',
    'department': 'Отделение',
    'full_result': 'Результат (полный)',
    'notes': 'Примечания'
  };

  // Добавляем названия для колонок тестов
  testColumns.forEach(testName => {
    columnNames[`test_${testName}`] = testName;
  });

  // Формируем таблицу
  let tableHTML = '<table id="report-table"><thead><tr>';

  visibleColumns.forEach(colId => {
    tableHTML += `<th data-column-id="${colId}">${columnNames[colId] || colId}</th>`;
  });

  tableHTML += '</tr></thead><tbody>';

  // Формируем строки данных
  records.forEach(item => {
    const p = item.patient;
    const fio = [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(" ");

    const rawText = item.results?.raw_text ?? "";
    const tests = item.results?.tests || [];

    // Собираем значения тестов
    const testValues = {};
    testColumns.forEach(testName => {
      testValues[testName] = [];
    });

    const testsByDefinition = {};
    tests.forEach(test => {
      const defId = test.test_definition_id || test.rule_id;
      if (!testsByDefinition[defId]) {
        testsByDefinition[defId] = [];
      }
      testsByDefinition[defId].push(test);
    });

    for (const defId in testsByDefinition) {
      const indicators = testsByDefinition[defId];
      const testName = indicators[0].name.split('-')[0];
      const values = indicators.map(ind => ind.value).filter(Boolean);

      if (testValues[testName] !== undefined) {
        testValues[testName] = values;
      }
    }

    // Фильтруем результат (убираем распарсенные части)
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

    filteredText = filteredText
      .replace(/:\s*[;,\s]*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, ': ')
      .replace(/(?:Определение|Исследование|Выявление|Анализ)[^:]+:\s*(?=(?:Определение|Исследование|Выявление|Анализ|$))/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/^[,;\s]+/g, '')
      .replace(/[,;\s]+$/g, '')
      .trim();

    // Данные ячеек
    const cellData = {
      'row_number': item.row_id ?? item.id,
      'fio': fio,
      'gender': p.gender ?? "",
      'age': p.age_years ?? "",
      'birth_date': p.birth_date ?? "",
      'sample_id': item.sample_id ?? "",
      'department': item.department ?? "",
      'full_result': filteredText,
      'notes': '' // Пустая колонка для заметок
    };

    // Добавляем значения тестов
    testColumns.forEach(testName => {
      const values = testValues[testName] || [];
      cellData[`test_${testName}`] = values.join(', ');
    });

    // Формируем строку
    tableHTML += '<tr>';
    visibleColumns.forEach(colId => {
      tableHTML += `<td data-column-id="${colId}">${cellData[colId] || ''}</td>`;
    });
    tableHTML += '</tr>';
  });

  tableHTML += '</tbody></table>';

  reportContent.innerHTML = tableHTML;

  // Обновляем информацию
  document.getElementById("report-info").textContent = `Всего записей: ${records.length}`;
}

// Загружаем данные при загрузке страницы
document.addEventListener('DOMContentLoaded', loadReportData);