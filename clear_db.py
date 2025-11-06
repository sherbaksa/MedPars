import sqlite3
import os

# Путь к БД
db_path = os.path.join("lab_parser", "instance", "parse_rules.db")

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Очищаем таблицы
        cursor.execute("DELETE FROM test_indicators")
        print("Очищена таблица test_indicators")

        cursor.execute("DELETE FROM test_definitions")
        print("Очищена таблица test_definitions")

        # Удаляем старую таблицу
        cursor.execute("DROP TABLE IF EXISTS parse_rules")
        print("Удалена старая таблица parse_rules")

        conn.commit()
        print("\n✓ База данных успешно очищена!")

    except Exception as e:
        print(f"Ошибка: {e}")
        conn.rollback()
    finally:
        conn.close()
else:
    print(f"Файл БД не найден: {db_path}")