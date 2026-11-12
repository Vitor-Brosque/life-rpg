import { describe, expect, it } from 'vitest';
import {
  CLOZE_CLOSE, CLOZE_HIDDEN, CLOZE_OPEN, clozeNumbers, numberClozes, renderCloze, stripCloze, wrapCloze,
} from '../src/cloze';

describe('numberClozes', () => {
  it('numbers unnumbered clozes after the highest existing number, in reading order', () => {
    expect(numberClozes('a {{x}} b {{2::y}} c {{z}}')).toBe('a {{3::x}} b {{2::y}} c {{4::z}}');
    expect(numberClozes('{{a}} {{b}}')).toBe('{{1::a}} {{2::b}}');
    expect(numberClozes('sem lacuna')).toBe('sem lacuna');
  });
});

describe('clozeNumbers', () => {
  it('groups equal numbers and ignores empty clozes', () => {
    expect(clozeNumbers('{{1::a}} {{1::b}} {{2::c}} {{}} {{3::  }}')).toEqual([1, 2]);
    expect(clozeNumbers('{{x}} e {{y}}')).toEqual([1, 2]);
    expect(clozeNumbers('nada')).toEqual([]);
  });
});

describe('renderCloze', () => {
  const text = 'O {{1::INNER JOIN}} junta e o {{2::LEFT JOIN}} mantém, {{1::só}} iguais.';
  it('front hides group n, shows other groups as plain text', () => {
    expect(renderCloze(text, 1, 'front')).toBe(
      `O ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE} junta e o LEFT JOIN mantém, ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE} iguais.`,
    );
  });
  it('back reveals group n between sentinels', () => {
    expect(renderCloze(text, 2, 'back')).toBe(`O INNER JOIN junta e o ${CLOZE_OPEN}LEFT JOIN${CLOZE_CLOSE} mantém, só iguais.`);
  });
  it('works inside fenced code', () => {
    const code = '```python\nx = {{1::42}}\n```';
    expect(renderCloze(code, 1, 'front')).toBe(`\`\`\`python\nx = ${CLOZE_OPEN}${CLOZE_HIDDEN}${CLOZE_CLOSE}\n\`\`\``);
  });
});

describe('wrapCloze', () => {
  it('wraps the selection with the next number', () => {
    expect(wrapCloze('soma de a e b', 8, 9)).toEqual({ text: 'soma de {{1::a}} e b', cursor: 16 });
  });
  it('numbers existing unnumbered clozes first, so the new one comes after them', () => {
    expect(wrapCloze('{{x}} y', 6, 7).text).toBe('{{1::x}} {{2::y}}');
  });
  it('an empty selection leaves the cursor inside the braces', () => {
    const r = wrapCloze('ab', 1, 1);
    expect(r.text).toBe('a{{1::}}b');
    expect(r.cursor).toBe(6);
  });
});

describe('stripCloze', () => {
  it('shows the answers without markup', () => {
    expect(stripCloze('O {{1::INNER}} e {{x}}')).toBe('O INNER e x');
  });
});
