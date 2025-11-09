from flask import Blueprint, request, jsonify, current_app
import os
from datetime import date
from ..utils.io_utils import list_uploaded_files
from ..models.parse_rules import get_parse_rules_db
from ..services.parse_excel import read_basic_records, read_records_with_parsing

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.get("/record/<int:rid>")
def record_by_id(rid: int):
    """
    Получение детальной информации о записи по ID.
    Если передан ?batch=<имя_файла>, ищет в реальном файле.
    Если batch не указан - ищем в последнем файле.
    """
    batch = request.args.get("batch")
    uploads_dir = os.path.join(current_app.instance_path, current_app.config["INSTANCE_UPLOADS_SUBDIR"])

    # Если batch не указан - берем последний файл
    if not batch:
        files = list_uploaded_files(
            instance_path=current_app.instance_path,
            uploads_subdir=current_app.config["INSTANCE_UPLOADS_SUBDIR"]
        )
        if files:
            batch = files[0]["name"]

    if batch:
        # Ищем в реальном файле
        path = os.path.join(uploads_dir, os.path.basename(batch))
        if not os.path.isfile(path):
            return jsonify({"error": "batch not found", "batch": batch}), 404

        try:
            data = read_basic_records(path)
        except Exception as e:
            return jsonify({"error": f"failed to read excel: {e}"}), 500

        # Ищем запись с нужным ID
        for item in data:
            if item.get("id") == rid or item.get("row_id") == rid:
                return jsonify(item)

        return jsonify({"error": "not found"}), 404

    # Если файлов вообще нет - возвращаем ошибку
    return jsonify({"error": "no files uploaded"}), 404


# ===== API для определений анализов =====

@api_bp.get("/test-definitions")
def get_test_definitions():
    """Получить все определения анализов с их показателями"""
    db = get_parse_rules_db(current_app.instance_path)
    definitions = db.get_all_test_definitions()

    # Для каждого определения получаем показатели
    for definition in definitions:
        definition['indicators'] = db.get_indicators_for_test(definition['id'])

    return jsonify({"definitions": definitions})


@api_bp.post("/test-definitions")
def create_test_definition():
    """Создать новое определение анализа с показателями"""
    data = request.get_json()

    if not data:
        return jsonify({"error": "no data provided"}), 400

    full_example_text = data.get("full_example_text", "").strip()
    short_description = data.get("short_description", "").strip()
    indicators = data.get("indicators", [])

    if not full_example_text:
        return jsonify({"error": "full_example_text is required"}), 400
    if not short_description:
        return jsonify({"error": "short_description is required"}), 400
    if not indicators or len(indicators) == 0:
        return jsonify({"error": "at least one indicator is required"}), 400

    # Валидация показателей
    for idx, indicator in enumerate(indicators):
        if not indicator.get("indicator_pattern"):
            return jsonify({"error": f"indicator {idx + 1}: indicator_pattern is required"}), 400
        if not indicator.get("variable_part"):
            return jsonify({"error": f"indicator {idx + 1}: variable_part is required"}), 400
        if indicator.get("value_type") not in [1, 2, 3]:
            return jsonify({"error": f"indicator {idx + 1}: value_type must be 1, 2, or 3"}), 400
        if indicator["variable_part"] not in indicator["indicator_pattern"]:
            return jsonify({"error": f"indicator {idx + 1}: variable_part must be part of indicator_pattern"}), 400

    db = get_parse_rules_db(current_app.instance_path)

    try:
        # Создаем определение анализа
        definition_id = db.add_test_definition(full_example_text, short_description)

        # Добавляем показатели
        for idx, indicator in enumerate(indicators):
            db.add_test_indicator(
                test_definition_id=definition_id,
                indicator_pattern=indicator["indicator_pattern"],
                variable_part=indicator["variable_part"],
                value_type=indicator["value_type"],
                is_key_indicator=indicator.get("is_key_indicator", False),
                is_required=indicator.get("is_required", True),
                display_order=indicator.get("display_order", idx)
            )

        return jsonify({"success": True, "id": definition_id}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.get("/test-definitions/<int:definition_id>")
def get_test_definition(definition_id: int):
    """Получить определение анализа с показателями по ID"""
    db = get_parse_rules_db(current_app.instance_path)
    definition = db.get_test_definition(definition_id)

    if not definition:
        return jsonify({"error": "definition not found"}), 404

    # Получаем показатели
    definition['indicators'] = db.get_indicators_for_test(definition_id)

    return jsonify(definition)


@api_bp.put("/test-definitions/<int:definition_id>")
def update_test_definition(definition_id: int):
    """Обновить определение анализа с показателями"""
    data = request.get_json()

    if not data:
        return jsonify({"error": "no data provided"}), 400

    full_example_text = data.get("full_example_text", "").strip()
    short_description = data.get("short_description", "").strip()
    indicators = data.get("indicators", [])

    if not full_example_text or not short_description:
        return jsonify({"error": "all fields are required"}), 400
    if not indicators or len(indicators) == 0:
        return jsonify({"error": "at least one indicator is required"}), 400

    # Валидация показателей
    for idx, indicator in enumerate(indicators):
        if not indicator.get("indicator_pattern"):
            return jsonify({"error": f"indicator {idx + 1}: indicator_pattern is required"}), 400
        if not indicator.get("variable_part"):
            return jsonify({"error": f"indicator {idx + 1}: variable_part is required"}), 400
        if indicator.get("value_type") not in [1, 2, 3]:
            return jsonify({"error": f"indicator {idx + 1}: value_type must be 1, 2, or 3"}), 400
        if indicator["variable_part"] not in indicator["indicator_pattern"]:
            return jsonify({"error": f"indicator {idx + 1}: variable_part must be part of indicator_pattern"}), 400

    db = get_parse_rules_db(current_app.instance_path)

    # Проверяем существование определения
    if not db.get_test_definition(definition_id):
        return jsonify({"error": "definition not found"}), 404

    try:
        # Обновляем определение
        db.update_test_definition(definition_id, full_example_text, short_description)

        # Удаляем старые показатели
        old_indicators = db.get_indicators_for_test(definition_id)
        for old_indicator in old_indicators:
            db.delete_test_indicator(old_indicator['id'])

        # Добавляем новые показатели
        for idx, indicator in enumerate(indicators):
            db.add_test_indicator(
                test_definition_id=definition_id,
                indicator_pattern=indicator["indicator_pattern"],
                variable_part=indicator["variable_part"],
                value_type=indicator["value_type"],
                is_key_indicator=indicator.get("is_key_indicator", False),
                is_required=indicator.get("is_required", True),
                display_order=indicator.get("display_order", idx)
            )

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.delete("/test-definitions/<int:definition_id>")
def delete_test_definition(definition_id: int):
    """Удалить определение анализа (каскадно удалятся все показатели)"""
    db = get_parse_rules_db(current_app.instance_path)
    success = db.delete_test_definition(definition_id)

    if not success:
        return jsonify({"error": "definition not found"}), 404

    return jsonify({"success": True})


# ===== API для работы с записями (таблица результатов) =====

@api_bp.get("/records")
def records():
    """
    Если передан ?batch=<имя_файла.xlsx>, читаем реальный Excel из instance/uploads/.
    Если batch не указан - пытаемся загрузить последний файл.
    Если файлов нет - возвращаем пустой результат с сообщением.

    Применяет правила парсинга если они есть.
    """
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(max(int(request.args.get("per_page", 20)), 1), 1000000)

    q = request.args.get("q")
    gender = request.args.get("gender")
    department = request.args.get("department")

    batch = request.args.get("batch")
    uploads_dir = os.path.join(current_app.instance_path, current_app.config["INSTANCE_UPLOADS_SUBDIR"])

    # Если batch не указан - берем последний файл
    if not batch:
        files = list_uploaded_files(
            instance_path=current_app.instance_path,
            uploads_subdir=current_app.config["INSTANCE_UPLOADS_SUBDIR"]
        )
        if files:
            batch = files[0]["name"]
        else:
            return jsonify({
                "page": page,
                "per_page": per_page,
                "total": 0,
                "items": [],
                "facets": {"departments": [], "genders": []},
                "test_columns": [],
                "test_key_indicators": {},
                "message": "Нет загруженных файлов. Перейдите на страницу загрузки.",
                "batch": None
            })

    # Читаем файл
    path = os.path.join(uploads_dir, os.path.basename(batch))
    if not os.path.isfile(path):
        return jsonify({"error": "batch not found", "batch": batch}), 404

    try:
        # Загружаем правила парсинга (в старом формате для совместимости с парсером)
        rules_db = get_parse_rules_db(current_app.instance_path)
        rules = rules_db.get_all_rules()

        # Читаем данные с применением правил парсинга
        data = read_records_with_parsing(path, rules)
    except Exception as e:
        return jsonify({"error": f"failed to read excel: {e}"}), 500

    # Собираем уникальные колонки тестов из всех записей
    test_definitions_set = set()
    test_def_names = {}

    for item in data:
        tests = item.get("results", {}).get("tests", [])
        for test in tests:
            test_def_id = test.get("test_definition_id", test.get("rule_id"))
            base_name = test["name"].split('-')[0] if '-' in test["name"] else test["name"]
            test_definitions_set.add(test_def_id)
            test_def_names[test_def_id] = base_name

    test_columns = sorted([test_def_names[def_id] for def_id in test_definitions_set])

    # Создаем маппинг rule_id -> test_pattern для фильтрации на клиенте
    rules_map = {}
    for rule in rules:
        rules_map[rule['id']] = {
            'test_pattern': rule['test_pattern'],
            'variable_part': rule['variable_part'],
            'short_name': rule['short_name']
        }

    # НОВОЕ: Собираем информацию о ключевых показателях для каждого анализа
    test_key_indicators = {}

    # Группируем правила по test_definition_id
    definitions_map = {}
    for rule in rules:
        def_id = rule.get('test_definition_id', rule['id'])
        if def_id not in definitions_map:
            definitions_map[def_id] = []
        definitions_map[def_id].append(rule)

    # Для каждого определения анализа находим ключевой показатель
    for def_id, indicators in definitions_map.items():
        # Находим ключевой показатель (is_key_indicator = True)
        key_indicator = None
        for indicator in indicators:
            if indicator.get('is_key_indicator', True):  # По умолчанию True для старых данных
                key_indicator = indicator
                break

        if not key_indicator:
            # Если нет явно указанного ключевого, берём первый
            key_indicator = indicators[0] if indicators else None

        if key_indicator:
            # Получаем базовое имя анализа
            base_name = test_def_names.get(def_id)
            if not base_name:
                continue

            # Собираем уникальные значения этого ключевого показателя из всех записей
            # ВАЖНО: Используем raw_value (исходное значение), а не нормализованное
            possible_values = set()
            for item in data:
                tests = item.get("results", {}).get("tests", [])
                for test in tests:
                    test_def = test.get("test_definition_id", test.get("rule_id"))
                    if test_def == def_id and test.get("rule_id") == key_indicator['id']:
                        # Это нужный показатель
                        if test.get("is_key_indicator", True):
                            # Используем raw_value для фильтра (исходное значение из таблицы)
                            raw_value = test.get("raw_value")
                            if raw_value:
                                possible_values.add(str(raw_value))

            # Формируем информацию о ключевом показателе
            test_key_indicators[base_name] = {
                "rule_id": key_indicator['id'],
                "test_definition_id": def_id,
                "indicator_name": key_indicator['short_name'],
                "possible_values": sorted(list(possible_values)),
                "value_type": key_indicator['value_type']
            }

    # простые фильтры
    def _match(item):
        ok = True
        p = item.get("patient", {})

        if q:
            ql = q.lower()
            ok = ok and (
                    (p.get("last_name") or "").lower().find(ql) >= 0
                    or (p.get("first_name") or "").lower().find(ql) >= 0
                    or (p.get("middle_name") or "").lower().find(ql) >= 0
                    or (item.get("sample_id") or "").lower().find(ql) >= 0
                    or (item.get("department") or "").lower().find(ql) >= 0
                    or (item.get("results", {}).get("summary") or "").lower().find(ql) >= 0
            )
        if gender:
            patient_gender = p.get("gender")
            match = patient_gender == gender
            if not match and patient_gender:
                print(f"Не совпало: '{patient_gender}' != '{gender}'")
            ok = ok and match
        if department:
            item_dept = item.get("department")
            match = item_dept == department
            if not match and item_dept:
                print(f"Не совпало отделение: '{item_dept}' != '{department}'")
            ok = ok and match
        return ok

    filtered = [x for x in data if _match(x)]
    total = len(filtered)
    start = (page - 1) * per_page
    end = start + per_page
    items = filtered[start:end]

    facets = {
        "departments": sorted(list({(x.get("department") or "") for x in data if x.get("department")})),
        "genders": sorted(list({(x["patient"].get("gender") or "") for x in data if x["patient"].get("gender")})),
    }

    return jsonify({
        "page": page,
        "per_page": per_page,
        "total": total,
        "items": items,
        "facets": facets,
        "test_columns": test_columns,
        "test_key_indicators": test_key_indicators,  # НОВОЕ ПОЛЕ
        "rules_map": rules_map,
        "batch": batch
    })