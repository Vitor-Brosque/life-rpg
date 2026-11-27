import { describe, expect, it } from 'vitest';
import { ASSIST_LIMITS, buildAssistContext } from '../src/assist';
import { PROPOSAL_SCHEMA } from '../src/assistSchema';
import { parsePastedProposal, pasteRequestText } from '../src/assistPaste';

const json = '{"title":"Rotina","summary":"Teste","missions":[{"title":"Ler"}]}';

describe('parsePastedProposal', () => {
  it('reads a ```json fenced block', () => {
    expect(parsePastedProposal(`Aqui está:\n\`\`\`json\n${json}\n\`\`\`\nQualquer ajuste, avise.`)).toEqual({ ok: true, value: JSON.parse(json) });
  });
  it('reads raw JSON and JSON surrounded by chatter', () => {
    expect(parsePastedProposal(json)).toEqual({ ok: true, value: JSON.parse(json) });
    expect(parsePastedProposal(`Claro! ${json} Espero que ajude.`)).toEqual({ ok: true, value: JSON.parse(json) });
  });
  it('rejects empty, too big and not JSON', () => {
    expect(parsePastedProposal('  \n ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePastedProposal(`{"a":"${'x'.repeat(ASSIST_LIMITS.bodyBytes)}"}`)).toEqual({ ok: false, reason: 'too-big' });
    expect(parsePastedProposal('só conversa, sem proposta')).toEqual({ ok: false, reason: 'not-json' });
    expect(parsePastedProposal('{ isto não é json }')).toEqual({ ok: false, reason: 'not-json' });
  });
});

describe('pasteRequestText', () => {
  const text = pasteRequestText(buildAssistContext({ areas: [] }, '2026-11-25'), '2026-11-25');
  it('carries the schema, the context and the instructions', () => {
    expect(text).toContain(JSON.stringify(PROPOSAL_SCHEMA));
    expect(text).toContain('"today":"2026-11-25"');
    expect(text).toContain('LIFE RPG');
    expect(text).toContain('```json');
    expect(text).toContain('Nunca invente dados meus');
    expect(text).not.toContain('enviar_proposta');
  });
  it('has no diary, sleep or note fields in the context (the schema may ask for cards to send)', () => {
    const context = text.slice(text.indexOf('Como o LIFE RPG está montado agora:'));
    expect(context).not.toMatch(/"(diary|diaryEntries|sleep|sleepLogs?|notes?|cards?|decks?|checkins?|energyLogs?|chatUrl)"\s*:/i);
  });
  it('starts with the usual introduction when there is no subject focus', () => {
    expect(text.startsWith('Você vai me ajudar a personalizar o LIFE RPG')).toBe(true);
  });
});

describe('pasteRequestText with a subject focus', () => {
  const ctx = buildAssistContext({ journeys: [{ id: 'bd', createdAt: 1, updatedAt: 1, deleted: false, title: 'Banco de Dados', status: 'active', order: 0, subject: true }] }, '2026-11-25');
  const plain = pasteRequestText(ctx, '2026-11-25');
  const focused = pasteRequestText(ctx, '2026-11-25', 'Banco de Dados');
  it('starts saying what to send to that subject, with study (subjects only if it does not exist yet)', () => {
    const first = focused.split('\n\n')[0]!;
    expect(first).toContain('Banco de Dados');
    expect(first).toContain('o que estudamos nesta conversa');
    expect(first).toContain('study');
    expect(first).toMatch(/subjects só se/);
    expect(focused.indexOf('Banco de Dados')).toBeLessThan(focused.indexOf('Como fazer:'));
  });
  it('keeps the rules, the format and the context of the usual request', () => {
    expect(focused).toContain(plain.slice(plain.indexOf('Como fazer:')));
    expect(focused).toContain(JSON.stringify(PROPOSAL_SCHEMA));
    expect(PROPOSAL_SCHEMA.properties.study.maxItems).toBe(ASSIST_LIMITS.study);
  });
});
