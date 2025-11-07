"""
Парсер результатов анализов на основе пользовательских правил
Поддерживает анализы с множественными показателями
"""
import re
from typing import List, Dict, Any, Optional, Tuple


class ResultsParser:
    """Парсер результатов на основе правил из БД с поддержкой множественных показателей"""

    def __init__(self, rules: List[Dict[str, Any]]):
        """
        Args:
            rules: Список правил парсинга из БД (в старом формате для совместимости)
        """
        self.rules = rules
        self._prepare_patterns()

    def _prepare_patterns(self):
        """Подготовка регулярных выражений из правил"""
        self.compiled_rules = []

        for rule in self.rules:
            test_pattern = rule['test_pattern']
            variable_part = rule['variable_part']

            # Экранируем специальные символы regex для основного паттерна
            escaped_pattern = re.escape(test_pattern)

            # Экранируем переменную часть
            escaped_variable = re.escape(variable_part)

            # Заменяем переменную часть на паттерн который захватит значение
            # Учитываем, что показатель может заканчиваться на ";" (если не последний)
            # или на начало следующего предложения
            search_pattern = escaped_pattern.replace(
                escaped_variable,
                r'(.+?)(?=;|\s+(?:Определение|Исследование|Антитела|Выявление|Анализ)|$)'
            )

            try:
                compiled = re.compile(search_pattern, re.IGNORECASE | re.DOTALL)
                self.compiled_rules.append({
                    'rule': rule,
                    'pattern': compiled,
                    'value_type': rule['value_type']
                })
            except re.error:
                # Если не удалось скомпилировать регекс, пропускаем правило
                continue

    def parse_results(self, raw_text: Optional[str]) -> Dict[str, Any]:
        """
        Парсит строку с результатами анализов

        Args:
            raw_text: Сырой текст из колонки "Результаты исследования"

        Returns:
            Словарь с распарсенными тестами
        """
        if not raw_text or not isinstance(raw_text, str):
            return {
                "tests": [],
                "summary": None,
                "raw_text": raw_text,
                "parse_quality": "none"
            }

        raw_text = raw_text.strip()
        tests = []
        matched_rules = []

        # Группируем правила по test_definition_id (для анализов с несколькими показателями)
        rules_by_definition = {}
        for compiled_rule in self.compiled_rules:
            rule = compiled_rule['rule']
            def_id = rule.get('test_definition_id', rule['id'])  # Fallback на id для старых данных

            if def_id not in rules_by_definition:
                rules_by_definition[def_id] = []
            rules_by_definition[def_id].append(compiled_rule)

        # Обрабатываем каждый анализ (группу показателей)
        for def_id, indicators in rules_by_definition.items():
            # Создаем рабочую копию текста для этого анализа
            working_text = raw_text

            # Для каждого показателя в этом анализе
            for compiled_rule in indicators:
                rule = compiled_rule['rule']
                pattern = compiled_rule['pattern']
                value_type = compiled_rule['value_type']

                match = pattern.search(working_text)
                if match:
                    # Получили захваченное значение (сырое)
                    captured_value = match.group(1).strip()

                    # Извлекаем конечное значение в зависимости от типа
                    extracted_value = self._extract_value_by_type(captured_value, value_type)

                    if extracted_value:
                        # Нормализация значения в зависимости от типа
                        normalized_value = self._normalize_value(extracted_value, value_type)

                        # Формируем название показателя
                        # Если у анализа несколько показателей, добавляем номер
                        indicator_name = rule['short_name']
                        if len(indicators) > 1:
                            # TODO: В будущем можно добавить более осмысленные суффиксы
                            # например, на основе display_order или is_key_indicator
                            indicator_index = indicators.index(compiled_rule) + 1
                            indicator_name = f"{rule['short_name']}-{indicator_index}"

                        tests.append({
                            "name": indicator_name,
                            "value": normalized_value,
                            "raw_value": extracted_value,
                            "value_type": value_type,
                            "rule_id": rule['id'],
                            "test_definition_id": def_id,
                            "is_key_indicator": rule.get('is_key_indicator', True),
                            "is_required": rule.get('is_required', True)
                        })

                        matched_rules.append(rule['id'])

                        # ВАЖНО: Удаляем найденную часть из рабочего текста
                        # чтобы следующий показатель этого же анализа искался в оставшейся части
                        matched_text = match.group(0)
                        working_text = working_text.replace(matched_text, '', 1)  # Удаляем только первое вхождение

        # Формируем краткую сводку
        summary = self._build_summary(tests, raw_text)

        # Определяем качество парсинга
        if len(tests) > 0:
            parse_quality = "parsed"
        else:
            parse_quality = "unparsed"

        return {
            "tests": tests,
            "summary": summary,
            "raw_text": raw_text,
            "parse_quality": parse_quality,
            "matched_rules": matched_rules
        }

    def _extract_value_by_type(self, captured_text: str, value_type: int) -> Optional[str]:
        """
        Извлекает значение из захваченного текста в зависимости от типа

        Args:
            captured_text: Захваченный текст (может содержать лишнее)
            value_type: Тип значения (1, 2, 3)

        Returns:
            Извлеченное значение или None
        """
        if not captured_text:
            return None

        # Обрезаем текст перед заглавной буквой (начало следующего предложения)
        # Ищем паттерн: пробел + заглавная русская буква
        cutoff = re.search(r'\s+[А-ЯЁ][а-яё]', captured_text)
        if cutoff:
            captured_text = captured_text[:cutoff.start()].strip()

        # TODO: БУДУЩЕЕ УЛУЧШЕНИЕ
        # Здесь можно добавить автоматическое определение типа значения
        # на основе содержимого captured_text:
        # - Если найдено число с точкой/запятой -> тип 2
        # - Если найдено "обнаружено/не обнаружено" -> тип 1
        # - Иначе -> тип 3
        # Это позволит парсеру самостоятельно различать показатели в одном анализе

        if value_type == 1:
            # Тип 1: Обнаружено/Не обнаружено - ищем в конце строки
            match = re.search(
                r'(не\s+обнаружен[оа]?|обнаружен[оа]?|отрицательн(?:ый|ая|ое)|положительн(?:ый|ая|ое)|отриц\.|полож\.)\s*$',
                captured_text,
                re.IGNORECASE
            )
            return match.group(1) if match else None

        elif value_type == 2:
            # Тип 2: Числовое значение - извлекаем число с 1-3 знаками после запятой из конца
            match = re.search(r'(\d+[.,]\d{1,3})\s*$', captured_text)
            if match:
                return match.group(1)
            # Если не нашли с запятой, попробуем целое число
            match = re.search(r'(\d+)\s*$', captured_text)
            return match.group(1) if match else None

        else:
            # Тип 3: Произвольное значение - берем от последнего " - " до конца
            # Сначала пробуем найти " - значение"
            match = re.search(r'-\s+([^\s-][^-]+?)\s*$', captured_text)
            if match:
                return match.group(1).strip()
            # Если не нашли " - ", берем последнее слово
            words = captured_text.strip().split()
            return words[-1] if words else None

    def _normalize_value(self, value: str, value_type: int) -> str:
        """
        Нормализует значение в зависимости от типа

        Args:
            value: Исходное значение
            value_type: Тип значения (1, 2, 3)

        Returns:
            Нормализованное значение для отображения
        """
        if value_type == 1:
            # Тип 1: Обнаружено/Не обнаружено → +/-
            value_lower = value.lower()
            if 'не обнаружен' in value_lower or 'отрицательн' in value_lower or 'отриц' in value_lower:
                return "-"
            elif 'обнаружен' in value_lower or 'положительн' in value_lower or 'полож' in value_lower:
                return "+"
            else:
                return value
        elif value_type == 2:
            # Тип 2: Числовое значение - возвращаем как есть
            return value
        else:
            # Тип 3: Иное - возвращаем как есть
            return value

    def _build_summary(self, tests: List[Dict], raw_text: str) -> str:
        """
        Создает краткую сводку результатов

        Args:
            tests: Список распарсенных тестов
            raw_text: Исходный текст

        Returns:
            Краткая строка-сводка
        """
        if not tests:
            # Если ничего не распарсено, возвращаем начало исходного текста
            if len(raw_text) > 140:
                return raw_text[:137] + "..."
            return raw_text

        # Формируем сводку из названий и значений (только ключевые показатели)
        parts = []
        for test in tests:
            # В сводку добавляем только ключевые показатели
            if test.get('is_key_indicator', True):
                parts.append(f"{test['name']}: {test['value']}")

        summary = "; ".join(parts)

        # Если сводка слишком длинная, обрезаем
        if len(summary) > 140:
            summary = summary[:137] + "..."

        return summary


def apply_parsing_rules(items: List[Dict[str, Any]], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Применяет правила парсинга ко всем записям

    Args:
        items: Список записей с результатами
        rules: Список правил парсинга из БД

    Returns:
        Список записей с распарсенными результатами
    """
    if not rules:
        # Если правил нет, возвращаем данные без изменений
        return items

    parser = ResultsParser(rules)

    for item in items:
        raw_text = item.get('results', {}).get('raw_text')
        parsed = parser.parse_results(raw_text)

        # Обновляем результаты
        item['results'] = parsed

    return items