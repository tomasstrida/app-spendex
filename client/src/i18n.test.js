import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod } from './i18n.js';

test('období ve stejném roce → čísla měsíců, rok jednou', () => {
  assert.equal(formatPeriod('2026-04-19', '2026-05-18'), '19. 4. – 18. 5. 2026');
});

test('období přes přelom roku → rok u obou konců', () => {
  assert.equal(formatPeriod('2025-12-19', '2026-01-18'), '19. 12. 2025 – 18. 1. 2026');
});

test('prázdný vstup → prázdný řetězec', () => {
  assert.equal(formatPeriod('', '2026-05-18'), '');
  assert.equal(formatPeriod('2026-04-19', null), '');
});
