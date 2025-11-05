from flask import Blueprint, request, jsonify, current_app
import os
from datetime import date
from ..utils.io_utils import list_uploaded_files
from ..models.parse_rules import get_parse_rules_db
from ..services.parse_excel import read_basic_records, read_records_with_parsing

api_bp = Blueprint("api", __name__, url_prefix="/api")

# ===== Моки данных =====
# Формат максимально близкий к будущему реальному
_MOCK_DATA = [
    {
        "id": 1,
        "row_id": 1,
        "patient": {
            "last_name": "Иванов",
            "first_name": "Иван",
            "middle_name": "Иванович",
            "gender": "Муж.",
            "birth_date": "1972-02-08",
            "age_years": 53
        },
        "sample_id": "1706250224",
        "department": "Поликлиника Покровка",
        "results": {
            "summary": "IgM/IgG SARS-CoV-2: отриц.",
            "tests": [
                {"name": "IgM SARS-CoV-2", "value": "отриц.", "units": None, "flag": "N"},
                {"name": "IgG SARS-CoV-2", "value": "отриц.", "units": None, "flag": "N"},
            ],
            "raw_text": "Определение антител классов M, G (IgM, IgG) к SARS-CoV-2",
            "parse_quality": "mock"
        }
    },
    {
        "id": 2,
        "row_id": 2,
        "patient": {
            "last_name": "Сидоров",
            "first_name": "Сидор",
            "middle_name": "Сидорович",
            "gender": "Муж.",
            "birth_date": "1973-09-16",
            "age_years": 52
        },
        "sample_id": "3007250122",
        "department": "Поликлиника Покровка",
        "results": {
            "summary": "HCV Ab: полож.",
            "tests": [
                {"name": "HCV Ab", "value": "полож.", "units": None, "flag": "A"}
            ],
            "raw_text": "Определение антител к вирусу гепатита C",
            "parse_quality": "mock"
        }
    },
]


def _apply_filters(items, q=None, gender=None, department=None):
    def match(item):
        ok = True
        if q:
            ql = q.lower()
            ok = ok and (
                    ql in item["patient"]["last_name"].lower()
                    or ql in item["patient"]["first_name"].lower()
                    or ql in (item["patient"]["middle_name"] or "").lower()
                    or ql in item["sample_id"].lower()
                    or ql in item["department"].lower()
                    or ql in (item["results"]["summary"] or "").lower()
            )
        if gender:
            ok = ok and (item["patient"]["gender"] == gender)
        if department:
            ok = ok and (item["department"] == department)
        return ok

    return [x for x in items if match(x)]



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


# ===== API для правил парсинга =====

@api_bp.get("/parse-rules")
def get_parse_rules():
    """Получить все правила парсинга"""
    db = get_parse_rules_db(current_app.instance_path)
    rules = db.get_all_rules()
    return jsonify({"rules": rules})


@api_bp.post("/parse-rules")
def create_parse_rule():
    """Создать новое правило парсинга"""
    data = request.get_json()

    # Валидация
    if not data:
        return jsonify({"error": "no data provided"}), 400

    test_pattern = data.get("test_pattern", "").strip()
    variable_part = data.get("variable_part", "").strip()
    value_type = data.get("value_type")
    short_name = data.get("short_name", "").strip()

    if not test_pattern:
        return jsonify({"error": "test_pattern is required"}), 400
    if not variable_part:
        return jsonify({"error": "variable_part is required"}), 400
    if value_type not in [1, 2, 3]:
        return jsonify({"error": "value_type must be 1, 2, or 3"}), 400
    if not short_name:
        return jsonify({"error": "short_name is required"}), 400

    # Проверка, что variable_part содержится в test_pattern
    if variable_part not in test_pattern:
        return jsonify({"error": "variable_part must be part of test_pattern"}), 400

    db = get_parse_rules_db(current_app.instance_path)
    try:
        rule_id = db.add_rule(test_pattern, variable_part, value_type, short_name)
        return jsonify({"success": True, "id": rule_id}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api_bp.put("/parse-rules/<int:rule_id>")
def update_parse_rule(rule_id: int):
    """Обновить правило парсинга"""
    data = request.get_json()

    if not data:
        return jsonify({"error": "no data provided"}), 400

    test_pattern = data.get("test_pattern", "").strip()
    variable_part = data.get("variable_part", "").strip()
    value_type = data.get("value_type")
    short_name = data.get("short_name", "").strip()

    if not test_pattern or not variable_part or not short_name:
        return jsonify({"error": "all fields are required"}), 400
    if value_type not in [1, 2, 3]:
        return jsonify({"error": "value_type must be 1, 2, or 3"}), 400
    if variable_part not in test_pattern:
        return jsonify({"error": "variable_part must be part of test_pattern"}), 400

    db = get_parse_rules_db(current_app.instance_path)
    success = db.update_rule(rule_id, test_pattern, variable_part, value_type, short_name)

    if not success:
        return jsonify({"error": "rule not found"}), 404

    return jsonify({"success": True})


@api_bp.get("/parse-rules/<int:rule_id>")
def get_parse_rule(rule_id: int):
    """Получить правило по ID"""
    db = get_parse_rules_db(current_app.instance_path)
    rule = db.get_rule(rule_id)
    if not rule:
        return jsonify({"error": "rule not found"}), 404
    return jsonify(rule)
@api_bp.get("/records")
def records():
    """
    Если передан ?batch=<имя_файла.xlsx>, читаем реальный Excel из instance/uploads/.
    Если batch не указан - пытаемся загрузить последний файл.
    Если файлов нет - возвращаем пустой результат с сообщением.

    Применяет правила парсинга если они есть.
    """
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(max(int(request.args.get("per_page", 20)), 1), 100)

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
                "message": "Нет загруженных файлов. Перейдите на страницу загрузки.",
                "batch": None
            })

    # Читаем файл
    path = os.path.join(uploads_dir, os.path.basename(batch))
    if not os.path.isfile(path):
        return jsonify({"error": "batch not found", "batch": batch}), 404

    try:
        # Загружаем правила парсинга
        rules_db = get_parse_rules_db(current_app.instance_path)
        rules = rules_db.get_all_rules()

        # Читаем данные с применением правил парсинга
        data = read_records_with_parsing(path, rules)
    except Exception as e:
        return jsonify({"error": f"failed to read excel: {e}"}), 500

    # Собираем уникальные колонки тестов из всех записей
    test_columns_set = set()
    for item in data:
        tests = item.get("results", {}).get("tests", [])
        for test in tests:
            test_columns_set.add(test["name"])

    # Сортируем колонки для стабильного порядка
    test_columns = sorted(list(test_columns_set))

    # Создаем маппинг rule_id -> test_pattern для фильтрации на клиенте
    rules_map = {}
    for rule in rules:
        rules_map[rule['id']] = {
            'test_pattern': rule['test_pattern'],
            'variable_part': rule['variable_part'],
            'short_name': rule['short_name']
        }

    # простые фильтры
    def _match(item):
        ok = True
        if q:
            ql = q.lower()
            p = item["patient"]
            ok = ok and (
                    (p.get("last_name") or "").lower().find(ql) >= 0
                    or (p.get("first_name") or "").lower().find(ql) >= 0
                    or (p.get("middle_name") or "").lower().find(ql) >= 0
                    or (item.get("sample_id") or "").lower().find(ql) >= 0
                    or (item.get("department") or "").lower().find(ql) >= 0
                    or (item["results"].get("summary") or "").lower().find(ql) >= 0
            )
        if gender:
            ok = ok and (p.get("gender") == gender)
        if department:
            ok = ok and (item.get("department") == department)
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
        "rules_map": rules_map,
        "batch": batch
    })

@api_bp.delete("/parse-rules/<int:rule_id>")
def delete_parse_rule(rule_id: int):
    """Удалить правило парсинга"""
    db = get_parse_rules_db(current_app.instance_path)
    success = db.delete_rule(rule_id)

    if not success:
        return jsonify({"error": "rule not found"}), 404

    return jsonify({"success": True})