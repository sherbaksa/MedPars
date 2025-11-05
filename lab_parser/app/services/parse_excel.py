import os
import re
import pandas as pd
from datetime import datetime
from typing import List, Dict, Any, Optional

from .results_parser import apply_parsing_rules

# Простые регексы под возраст/дату
AGE_RE = re.compile(r"(\d+)\s*(?:год|года|лет)")
DATE_RE = re.compile(r"(\d{2}\.\d{2}\.\d{4})")

# Ожидаемые заголовки колонок (точное совпадение после strip)
EXPECTED_COLUMNS = [
    "№ п/п",
    "ФИО пациента, пол, дата рождения",
    "Идентификатор образца",
    "Отделение",
    "Результаты исследования"
]


def _is_html_file(file_path: str) -> bool:
    """
    Определяет, является ли файл HTML, читая первые байты.
    """
    try:
        with open(file_path, 'rb') as f:
            header = f.read(1024).lower()
            return b'<html' in header or b'<!doctype html' in header or b'<table' in header
    except Exception:
        return False


def _detect_header_row(xlsx_path: str, sheet_name: Optional[str] = None) -> int:
    """
    Определяет, в какой строке находятся заголовки колонок.
    Возвращает номер строки для параметра skiprows в pd.read_excel():
    - 0: заголовки в первой строке (дообработанный файл)
    - 1: заголовки во второй строке (сырой файл, пропускаем первую)

    Выбрасывает ValueError, если заголовки не найдены ни в первой, ни во второй строке.
    """
    # Если sheet_name не указан, используем первый лист (индекс 0)
    if sheet_name is None:
        sheet_name = 0

    # Проверяем, является ли файл HTML
    is_html = _is_html_file(xlsx_path)

    try:
        if is_html:
            # Читаем HTML-таблицу
            tables = pd.read_html(xlsx_path, encoding='utf-8')
            if not tables:
                raise ValueError("HTML файл не содержит таблиц")
            df_check = tables[0]  # Берем первую таблицу целиком

            # Для HTML pandas автоматически определяет заголовки из <thead>
            # Проверяем, что колонки содержат ожидаемые заголовки
            columns = [str(c).strip() for c in df_check.columns]
            if all(col in columns for col in EXPECTED_COLUMNS):
                return 0  # Заголовки уже на месте, не нужно пропускать строки

            # Если заголовки не найдены в <thead>, проверяем первые две строки
            if len(df_check) >= 2:
                first_row = [str(val).strip() for val in df_check.iloc[0]]
                if all(col in first_row for col in EXPECTED_COLUMNS):
                    return 1  # Заголовки во второй строке (первая - заголовок журнала)

            raise ValueError("Не удалось найти ожидаемые заголовки колонок в HTML-таблице")
        else:
            # Определяем движок по расширению файла
            file_ext = os.path.splitext(xlsx_path)[1].lower()
            engine = None

            if file_ext == '.xlsx':
                engine = 'openpyxl'
            elif file_ext == '.xls':
                engine = 'xlrd'

            # Читаем первые 2 строки без обработки заголовков
            df_check = pd.read_excel(xlsx_path, sheet_name=sheet_name, header=None, nrows=2, engine=engine)
    except Exception as e:
        file_ext = os.path.splitext(xlsx_path)[1].lower()
        raise ValueError(f"Не удалось прочитать файл (расширение: {file_ext}, HTML: {is_html}): {str(e)}")

    def _check_row(row_index: int) -> bool:
        """Проверяет, содержит ли строка все ожидаемые заголовки"""
        if row_index >= len(df_check):
            return False
        row_values = [str(val).strip() for val in df_check.iloc[row_index]]
        # Проверяем наличие всех ожидаемых заголовков
        return all(col in row_values for col in EXPECTED_COLUMNS)

    # Для не-HTML файлов проверяем первую и вторую строки
    # Проверяем первую строку (индекс 0)
    if _check_row(0):
        return 0  # Дообработанный файл, заголовки в первой строке

    # Проверяем вторую строку (индекс 1)
    if _check_row(1):
        return 1  # Сырой файл, пропускаем первую строку

    # Заголовки не найдены
    raise ValueError(
        "Не удалось определить формат файла. "
        "Ожидаемые заголовки колонок не найдены ни в первой, ни во второй строке. "
        "Проверьте, что загружен правильный файл."
    )


def _parse_patient_block(text: str) -> dict:
    """Разбирает поле 'ФИО пациента, пол, дата рождения' вида:
    'Иванов Иван Иванович, Муж., 53 года, 08.02.1972'
    Возвращает часть patient + age_years.
    """
    if not isinstance(text, str):
        return {
            "last_name": None, "first_name": None, "middle_name": None,
            "gender": None, "birth_date": None, "age_years": None
        }

    parts = [p.strip() for p in text.split(",")]
    # parts[0] — ФИО
    fio = parts[0] if parts else ""
    fio_bits = fio.split()
    ln = fio_bits[0] if len(fio_bits) > 0 else None
    fn = fio_bits[1] if len(fio_bits) > 1 else None
    mn = " ".join(fio_bits[2:]) if len(fio_bits) > 2 else None

    # пол
    gender = None
    if len(parts) >= 2:
        gender = parts[1] or None

    # возраст
    age_years = None
    if len(parts) >= 3:
        m = AGE_RE.search(parts[2])
        if m:
            try:
                age_years = int(m.group(1))
            except ValueError:
                age_years = None

    # дата рождения (обычно последний фрагмент)
    birth_date = None
    for p in reversed(parts):
        m = DATE_RE.search(p)
        if m:
            # нормализуем к YYYY-MM-DD
            try:
                birth_date = datetime.strptime(m.group(1), "%d.%m.%Y").date().isoformat()
            except Exception:
                birth_date = None
            break

    return {
        "last_name": ln,
        "first_name": fn,
        "middle_name": mn,
        "gender": gender,
        "birth_date": birth_date,
        "age_years": age_years
    }


def read_basic_records(xlsx_path: str, sheet_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Читает Excel и возвращает упрощённые записи для таблицы.

    Автоматически определяет формат файла:
    - Дообработанный: заголовки в первой строке
    - Сырой: заголовки во второй строке (первая строка - заголовок журнала)
    - HTML с расширением .xls/.xlsx: парсит как HTML-таблицу

    Если sheet_name не указан, использует первый лист файла.

    Столбцы ожидаются: № п/п, ФИО пациента..., Идентификатор образца, Отделение, Результаты исследования
    """
    # Если sheet_name не указан, используем первый лист (индекс 0)
    if sheet_name is None:
        sheet_name = 0

    # Определяем, сколько строк нужно пропустить
    skip_rows = _detect_header_row(xlsx_path, sheet_name)

    # Проверяем, является ли файл HTML
    is_html = _is_html_file(xlsx_path)

    if is_html:
        # Читаем HTML-таблицу
        tables = pd.read_html(xlsx_path, encoding='utf-8')
        if not tables:
            raise ValueError("HTML файл не содержит таблиц")

        df = tables[0]  # Берем первую таблицу

        # Для HTML pandas уже правильно определил заголовки из <thead>
        # Просто проверяем, что skip_rows = 0 (заголовки уже на месте)
        if skip_rows != 0:
            # Это не должно произойти для HTML с <thead>, но на всякий случай
            df.columns = df.iloc[skip_rows]
            df = df.iloc[skip_rows + 1:].reset_index(drop=True)
    else:
        # Определяем движок по расширению файла
        file_ext = os.path.splitext(xlsx_path)[1].lower()
        engine = None

        if file_ext == '.xlsx':
            engine = 'openpyxl'
        elif file_ext == '.xls':
            engine = 'xlrd'

        # Читаем файл с правильным смещением
        df = pd.read_excel(xlsx_path, sheet_name=sheet_name, skiprows=skip_rows, engine=engine)

    # нормализуем имена колонок (уберём лишние пробелы)
    df.columns = [str(c).strip() for c in df.columns]

    # маппинги по наблюдаемому файлу
    col_idx = "№ п/п"
    col_patient = "ФИО пациента, пол, дата рождения"
    col_sample = "Идентификатор образца"
    col_dept = "Отделение"
    col_res = "Результаты исследования"

    items: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        row_id = row.get(col_idx, None)
        patient_block = row.get(col_patient, None)
        sample_id = row.get(col_sample, None)
        department = row.get(col_dept, None)
        raw_res = row.get(col_res, None)

        patient = _parse_patient_block(patient_block)

        # summary результатов (пока коротко — первые 140 символов)
        summary = None
        if isinstance(raw_res, str):
            summary = raw_res.strip()
            if len(summary) > 140:
                summary = summary[:137] + "..."

        items.append({
            "id": int(row_id) if pd.notna(row_id) else None,  # для ссылки
            "row_id": int(row_id) if pd.notna(row_id) else None,
            "patient": patient,
            "sample_id": str(sample_id) if pd.notna(sample_id) else None,
            "department": str(department) if pd.notna(department) else None,
            "results": {
                "summary": summary,
                "tests": [],  # заполним позже продвинутым парсером
                "raw_text": str(raw_res) if pd.notna(raw_res) else None,
                "parse_quality": "basic"
            }
        })

    return items


def read_records_with_parsing(xlsx_path: str, rules: List[Dict[str, Any]],
                               sheet_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Читает Excel и применяет правила парсинга к результатам

    Args:
        xlsx_path: Путь к файлу Excel
        rules: Список правил парсинга из БД
        sheet_name: Название листа (если None, используется первый)

    Returns:
        Список записей с распарсенными результатами
    """
    # Сначала читаем базовые данные
    items = read_basic_records(xlsx_path, sheet_name)

    # Затем применяем правила парсинга
    if rules:
        items = apply_parsing_rules(items, rules)

    return items