import sqlite3
import os
from typing import List, Dict, Optional, Any
from contextlib import contextmanager


class ParseRulesDB:
    """Управление правилами парсинга результатов анализов с поддержкой множественных показателей"""

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
        """Инициализация структуры БД с миграцией старой таблицы"""
        with self._get_connection() as conn:
            # Проверяем, существует ли старая таблица parse_rules
            cursor = conn.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='parse_rules'
            """)
            old_table_exists = cursor.fetchone() is not None

            # Создаем новую таблицу определений анализов
            conn.execute("""
                CREATE TABLE IF NOT EXISTS test_definitions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_example_text TEXT NOT NULL,
                    short_description TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Создаем таблицу показателей
            conn.execute("""
                CREATE TABLE IF NOT EXISTS test_indicators (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    test_definition_id INTEGER NOT NULL,
                    indicator_pattern TEXT NOT NULL,
                    variable_part TEXT NOT NULL,
                    value_type INTEGER NOT NULL,
                    is_key_indicator BOOLEAN NOT NULL DEFAULT 0,
                    is_required BOOLEAN NOT NULL DEFAULT 1,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (test_definition_id) REFERENCES test_definitions(id) ON DELETE CASCADE
                )
            """)

            # Создаем индексы
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_test_indicators_definition 
                ON test_indicators(test_definition_id)
            """)

            # Миграция данных из старой таблицы, если она существует
            if old_table_exists:
                self._migrate_old_data(conn)

    def _migrate_old_data(self, conn):
        """Миграция данных из старой таблицы parse_rules в новую структуру"""
        # Проверяем, были ли уже мигрированы данные
        cursor = conn.execute("SELECT COUNT(*) as cnt FROM test_definitions")
        if cursor.fetchone()['cnt'] > 0:
            # Данные уже мигрированы, пропускаем
            return

        # Читаем все записи из старой таблицы
        cursor = conn.execute("""
            SELECT id, test_pattern, variable_part, value_type, short_name
            FROM parse_rules
            ORDER BY id
        """)
        old_rules = cursor.fetchall()

        # Мигрируем каждое правило
        for rule in old_rules:
            # Создаем определение анализа
            cursor = conn.execute("""
                INSERT INTO test_definitions (full_example_text, short_description)
                VALUES (?, ?)
            """, (rule['test_pattern'], rule['short_name']))
            test_def_id = cursor.lastrowid

            # Создаем единственный показатель для этого анализа
            conn.execute("""
                INSERT INTO test_indicators 
                (test_definition_id, indicator_pattern, variable_part, value_type, 
                 is_key_indicator, is_required, display_order)
                VALUES (?, ?, ?, ?, 1, 1, 0)
            """, (test_def_id, rule['test_pattern'], rule['variable_part'], rule['value_type']))

        print(f"Мигрировано {len(old_rules)} правил из старой таблицы parse_rules")

    # ===== Методы для работы с определениями анализов =====

    def add_test_definition(self, full_example_text: str, short_description: str) -> int:
        """
        Добавить определение анализа

        Args:
            full_example_text: Полная строка с примером результата
            short_description: Краткое описание для отображения

        Returns:
            ID созданного определения
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO test_definitions (full_example_text, short_description)
                VALUES (?, ?)
            """, (full_example_text, short_description))
            return cursor.lastrowid

    def get_all_test_definitions(self) -> List[Dict[str, Any]]:
        """Получить все определения анализов"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, full_example_text, short_description, created_at, updated_at
                FROM test_definitions
                ORDER BY created_at DESC
            """)
            return [dict(row) for row in cursor.fetchall()]

    def get_test_definition(self, definition_id: int) -> Optional[Dict[str, Any]]:
        """Получить определение анализа по ID"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, full_example_text, short_description, created_at, updated_at
                FROM test_definitions
                WHERE id = ?
            """, (definition_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_test_definition(self, definition_id: int, full_example_text: str,
                              short_description: str) -> bool:
        """Обновить определение анализа"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE test_definitions
                SET full_example_text = ?, short_description = ?, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (full_example_text, short_description, definition_id))
            return cursor.rowcount > 0

    def delete_test_definition(self, definition_id: int) -> bool:
        """Удалить определение анализа (каскадно удалятся и все показатели)"""
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM test_definitions WHERE id = ?", (definition_id,))
            return cursor.rowcount > 0

    # ===== Методы для работы с показателями =====

    def add_test_indicator(self, test_definition_id: int, indicator_pattern: str,
                          variable_part: str, value_type: int, is_key_indicator: bool = False,
                          is_required: bool = True, display_order: int = 0) -> int:
        """
        Добавить показатель к анализу

        Args:
            test_definition_id: ID определения анализа
            indicator_pattern: Часть строки с примером показателя
            variable_part: Изменяемая часть
            value_type: Тип значения (1, 2, 3)
            is_key_indicator: Ключевой показатель (для поиска/фильтрации)
            is_required: Обязательный показатель
            display_order: Порядок отображения

        Returns:
            ID созданного показателя
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO test_indicators 
                (test_definition_id, indicator_pattern, variable_part, value_type,
                 is_key_indicator, is_required, display_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (test_definition_id, indicator_pattern, variable_part, value_type,
                  is_key_indicator, is_required, display_order))
            return cursor.lastrowid

    def get_indicators_for_test(self, test_definition_id: int) -> List[Dict[str, Any]]:
        """Получить все показатели для конкретного анализа"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, test_definition_id, indicator_pattern, variable_part, value_type,
                       is_key_indicator, is_required, display_order, created_at, updated_at
                FROM test_indicators
                WHERE test_definition_id = ?
                ORDER BY display_order, id
            """, (test_definition_id,))
            return [dict(row) for row in cursor.fetchall()]

    def get_test_indicator(self, indicator_id: int) -> Optional[Dict[str, Any]]:
        """Получить показатель по ID"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, test_definition_id, indicator_pattern, variable_part, value_type,
                       is_key_indicator, is_required, display_order, created_at, updated_at
                FROM test_indicators
                WHERE id = ?
            """, (indicator_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_test_indicator(self, indicator_id: int, indicator_pattern: str,
                            variable_part: str, value_type: int, is_key_indicator: bool,
                            is_required: bool, display_order: int) -> bool:
        """Обновить показатель"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE test_indicators
                SET indicator_pattern = ?, variable_part = ?, value_type = ?,
                    is_key_indicator = ?, is_required = ?, display_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (indicator_pattern, variable_part, value_type, is_key_indicator,
                  is_required, display_order, indicator_id))
            return cursor.rowcount > 0

    def delete_test_indicator(self, indicator_id: int) -> bool:
        """Удалить показатель"""
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM test_indicators WHERE id = ?", (indicator_id,))
            return cursor.rowcount > 0

    # ===== Вспомогательные методы =====

    def get_all_rules_for_parsing(self) -> List[Dict[str, Any]]:
        """
        Получить все правила в формате, совместимом с парсером
        Возвращает список определений анализов с их показателями
        """
        with self._get_connection() as conn:
            # Получаем все определения
            cursor = conn.execute("""
                SELECT id, full_example_text, short_description
                FROM test_definitions
                ORDER BY id
            """)
            definitions = [dict(row) for row in cursor.fetchall()]

            # Для каждого определения получаем показатели
            for definition in definitions:
                cursor = conn.execute("""
                    SELECT id, indicator_pattern, variable_part, value_type,
                           is_key_indicator, is_required, display_order
                    FROM test_indicators
                    WHERE test_definition_id = ?
                    ORDER BY display_order, id
                """, (definition['id'],))
                definition['indicators'] = [dict(row) for row in cursor.fetchall()]

            return definitions

    def search_test_definitions(self, query: str) -> List[Dict[str, Any]]:
        """Поиск определений анализов по короткому описанию или примеру"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, full_example_text, short_description, created_at, updated_at
                FROM test_definitions
                WHERE full_example_text LIKE ? OR short_description LIKE ?
                ORDER BY created_at DESC
            """, (f"%{query}%", f"%{query}%"))
            return [dict(row) for row in cursor.fetchall()]

    # ===== Методы обратной совместимости =====

    def get_all_rules(self) -> List[Dict[str, Any]]:
        """
        УСТАРЕВШИЙ МЕТОД для обратной совместимости.
        Возвращает показатели в старом формате (как отдельные правила).
        Используется старым парсером до его обновления.
        """
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT 
                    ti.id,
                    ti.indicator_pattern as test_pattern,
                    ti.variable_part,
                    ti.value_type,
                    td.short_description as short_name,
                    ti.created_at,
                    ti.updated_at,
                    ti.test_definition_id,
                    ti.is_key_indicator,
                    ti.is_required
                FROM test_indicators ti
                JOIN test_definitions td ON ti.test_definition_id = td.id
                ORDER BY td.created_at DESC, ti.display_order, ti.id
            """)
            return [dict(row) for row in cursor.fetchall()]


def get_parse_rules_db(instance_path: str) -> ParseRulesDB:
    """Фабрика для получения экземпляра БД правил парсинга"""
    db_path = os.path.join(instance_path, "parse_rules.db")
    return ParseRulesDB(db_path)