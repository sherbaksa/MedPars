import sqlite3
import os
from typing import List, Dict, Optional, Any
from contextlib import contextmanager


class ParseRulesDB:
    """Управление правилами парсинга результатов анализов"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _get_connection(self):
        """Контекстный менеджер для работы с БД"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self):
        """Инициализация структуры БД"""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS parse_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    test_pattern TEXT NOT NULL,
                    variable_part TEXT NOT NULL,
                    value_type INTEGER NOT NULL,
                    short_name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(test_pattern)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_test_pattern 
                ON parse_rules(test_pattern)
            """)

    def add_rule(self, test_pattern: str, variable_part: str,
                 value_type: int, short_name: str) -> int:
        """
        Добавить правило парсинга

        Args:
            test_pattern: Полная строка с результатом (например: "IgM SARS-CoV-2: {value}")
            variable_part: Переменная часть (например: "{value}")
            value_type: Тип значения (1 - Обнаружено/Не обнаружено, 2 - Число, 3 - Иное)
            short_name: Краткое название для колонки (например: "IgM-CoV2")

        Returns:
            ID созданного правила
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO parse_rules (test_pattern, variable_part, value_type, short_name)
                VALUES (?, ?, ?, ?)
            """, (test_pattern, variable_part, value_type, short_name))
            return cursor.lastrowid

    def get_all_rules(self) -> List[Dict[str, Any]]:
        """Получить все правила парсинга"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, test_pattern, variable_part, value_type, short_name, 
                       created_at, updated_at
                FROM parse_rules
                ORDER BY created_at DESC
            """)
            return [dict(row) for row in cursor.fetchall()]

    def get_rule(self, rule_id: int) -> Optional[Dict[str, Any]]:
        """Получить правило по ID"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, test_pattern, variable_part, value_type, short_name,
                       created_at, updated_at
                FROM parse_rules
                WHERE id = ?
            """, (rule_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_rule(self, rule_id: int, test_pattern: str, variable_part: str,
                    value_type: int, short_name: str) -> bool:
        """Обновить правило"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE parse_rules
                SET test_pattern = ?, variable_part = ?, value_type = ?, 
                    short_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (test_pattern, variable_part, value_type, short_name, rule_id))
            return cursor.rowcount > 0

    def delete_rule(self, rule_id: int) -> bool:
        """Удалить правило"""
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM parse_rules WHERE id = ?", (rule_id,))
            return cursor.rowcount > 0

    def search_rules(self, query: str) -> List[Dict[str, Any]]:
        """Поиск правил по названию теста или короткому имени"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, test_pattern, variable_part, value_type, short_name,
                       created_at, updated_at
                FROM parse_rules
                WHERE test_pattern LIKE ? OR short_name LIKE ?
                ORDER BY created_at DESC
            """, (f"%{query}%", f"%{query}%"))
            return [dict(row) for row in cursor.fetchall()]


def get_parse_rules_db(instance_path: str) -> ParseRulesDB:
    """Фабрика для получения экземпляра БД правил парсинга"""
    db_path = os.path.join(instance_path, "parse_rules.db")
    return ParseRulesDB(db_path)