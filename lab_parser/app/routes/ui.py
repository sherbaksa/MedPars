from flask import Blueprint, render_template, request, current_app, redirect, url_for, flash, send_file
from werkzeug.utils import secure_filename
import os
import time
import pandas as pd
import unicodedata

from ..utils.io_utils import allowed_file, list_uploaded_files, human_size


def safe_filename_unicode(filename: str) -> str:
    """
    Создает безопасное имя файла с сохранением кириллицы.
    Удаляет только опасные символы, оставляя буквы (включая кириллицу), цифры, точки, дефисы и подчеркивания.
    """
    # Нормализуем unicode
    filename = unicodedata.normalize('NFKC', filename)

    # Разрешенные символы: буквы (любые), цифры, точка, дефис, подчеркивание, пробел
    safe_chars = []
    for char in filename:
        if char.isalnum() or char in '._- ':
            safe_chars.append(char)
        else:
            safe_chars.append('_')

    result = ''.join(safe_chars)

    # Убираем множественные пробелы и подчеркивания
    result = ' '.join(result.split())
    result = result.replace(' ', '_')

    # Убираем точки в начале (скрытые файлы в Unix)
    result = result.lstrip('.')

    # Ограничиваем длину (оставляем место для метки времени)
    if len(result) > 100:
        name, ext = os.path.splitext(result)
        result = name[:100] + ext

    return result or 'unnamed'

ui_bp = Blueprint("ui", __name__)


@ui_bp.get("/")
def index():
    return render_template("index.html")


@ui_bp.get("/table")
def table():
    return render_template("table.html")


@ui_bp.get("/report")
def report():
    return render_template("report.html")


@ui_bp.get("/upload")
def upload_get():
    return render_template("upload.html")


def _is_html_file(file_path: str) -> bool:
    """Определяет, является ли файл HTML"""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(1024).lower()
            return b'<html' in header or b'<!doctype html' in header or b'<table' in header
    except Exception:
        return False


def _convert_to_xlsx(source_path: str, dest_path: str) -> None:
    """
    Конвертирует файл любого поддерживаемого формата в настоящий .xlsx

    Поддерживает:
    - .xlsx файлы (копирует через pandas для нормализации)
    - .xls файлы (конвертирует в .xlsx)
    - HTML-файлы с расширением .xls/.xlsx (парсит и сохраняет как .xlsx)
    """
    file_ext = os.path.splitext(source_path)[1].lower()
    is_html = _is_html_file(source_path)

    if is_html:
        # Читаем HTML-таблицу
        tables = pd.read_html(source_path, encoding='utf-8')
        if not tables:
            raise ValueError("HTML файл не содержит таблиц")
        df = tables[0]
    else:
        # Определяем движок по расширению
        engine = None
        if file_ext == '.xlsx':
            engine = 'openpyxl'
        elif file_ext == '.xls':
            engine = 'xlrd'

        # Читаем Excel-файл
        df = pd.read_excel(source_path, sheet_name=0, engine=engine)

    # Сохраняем как настоящий .xlsx
    df.to_excel(dest_path, index=False, engine='openpyxl')


@ui_bp.post("/upload")
def upload_post():
    if "file" not in request.files:
        flash("Файл не найден в запросе", "error")
        return redirect(url_for("ui.upload_get"))

    f = request.files["file"]
    if f.filename == "":
        flash("Вы не выбрали файл", "error")
        return redirect(url_for("ui.upload_get"))

    if not allowed_file(f.filename, current_app.config["ALLOWED_EXTENSIONS"]):
        flash("Разрешены только файлы .xlsx и .xls", "error")
        return redirect(url_for("ui.upload_get"))

    # Безопасное имя с сохранением кириллицы + метка времени
    safe_name = safe_filename_unicode(f.filename)
    name, _ = os.path.splitext(safe_name)  # Игнорируем исходное расширение
    ts = time.strftime("%Y%m%d-%H%M%S")

    dest_dir = os.path.join(current_app.instance_path, current_app.config["INSTANCE_UPLOADS_SUBDIR"])
    os.makedirs(dest_dir, exist_ok=True)

    # Временный файл для загрузки
    temp_path = os.path.join(dest_dir, f"temp_{ts}_{safe_name}")

    try:
        # Сохраняем загруженный файл временно
        f.save(temp_path)

        # Итоговое имя ВСЕГДА с расширением .xlsx
        final_name = f"{name}__{ts}.xlsx"
        dest_path = os.path.join(dest_dir, final_name)

        # Конвертируем в настоящий .xlsx
        _convert_to_xlsx(temp_path, dest_path)

        # Удаляем временный файл
        os.remove(temp_path)

        flash(f"Файл загружен и сконвертирован: {final_name}", "success")
        return redirect(url_for("ui.table") + f"?batch={final_name}")

    except Exception as e:
        # Очищаем временный файл в случае ошибки
        if os.path.exists(temp_path):
            os.remove(temp_path)
        flash(f"Ошибка при обработке файла: {str(e)}", "error")
        return redirect(url_for("ui.upload_get"))

@ui_bp.get("/batches")
def batches():
    files = list_uploaded_files(
        instance_path=current_app.instance_path,
        uploads_subdir=current_app.config["INSTANCE_UPLOADS_SUBDIR"]
    )
    # подготовим удобные поля для шаблона
    for f in files:
        f["size_h"] = human_size(f["size"])
        f["mtime_h"] = f["mtime"].strftime("%Y-%m-%d %H:%M:%S")
    return render_template("batches.html", files=files)


@ui_bp.get("/batches/download")
def batches_download():
    """
    Скачивание исходного загруженного файла по имени (?name=...).
    Полезно для проверки.
    """
    name = request.args.get("name")
    if not name:
        flash("Не указано имя файла", "error")
        return redirect(url_for("ui.batches"))

    uploads_dir = os.path.join(current_app.instance_path, current_app.config["INSTANCE_UPLOADS_SUBDIR"])
    path = os.path.join(uploads_dir, name)
    if not os.path.isfile(path):
        flash("Файл не найден", "error")
        return redirect(url_for("ui.batches"))

    return send_file(path, as_attachment=True, download_name=name)
@ui_bp.get("/parse-settings")
def parse_settings():
    """Страница настроек парсинга результатов"""
    return render_template("parse_settings.html")