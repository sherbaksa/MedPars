import os
from datetime import datetime

def allowed_file(filename: str, allowed_extensions: set[str]) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_extensions

def list_uploaded_files(instance_path: str, uploads_subdir: str):
    """
    Возвращает список словарей: имя, абсолютный путь, размер (байты), mtime (datetime).
    Отсортировано по времени (новые сверху).
    """
    uploads_dir = os.path.join(instance_path, uploads_subdir)
    if not os.path.isdir(uploads_dir):
        return []

    rows = []
    for name in os.listdir(uploads_dir):
        path = os.path.join(uploads_dir, name)
        if not os.path.isfile(path):
            continue
        st = os.stat(path)
        rows.append({
            "name": name,
            "path": path,
            "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime),
        })

    rows.sort(key=lambda r: r["mtime"], reverse=True)
    return rows

def human_size(nbytes: int) -> str:
    # простая читаемая форма
    for unit in ["Б", "КБ", "МБ", "ГБ", "ТБ"]:
        if nbytes < 1024:
            return f"{nbytes:.0f} {unit}"
        nbytes /= 1024
    return f"{nbytes:.0f} ПБ"
