import { describe, expect, it } from 'vitest';
import { MOMENT_HINT, MOMENT_ORDER, MOMENT_TITLE, pickMoment } from '../src/moments';

describe('one moment card at a time', () => {
  it('the priority: Como foi hoje?, Como está hoje?, Nova semana, reflexão do mês, revisão rápida', () => {
    expect(MOMENT_ORDER).toEqual(['fechamento', 'tipo', 'semana', 'mes', 'revisao']);
    expect(MOMENT_TITLE.fechamento).toBe('Como foi hoje?');
    expect(MOMENT_HINT.revisao).toBe('Decidir o que fazer com o que ficou de outros dias.');
  });
  it('the first due card shows; the others wait in "Mais para hoje", in order', () => {
    expect(pickMoment([])).toEqual({ more: [] });
    expect(pickMoment(['revisao'])).toEqual({ shown: 'revisao', more: [] });
    expect(pickMoment(['revisao', 'semana', 'fechamento'])).toEqual({ shown: 'fechamento', more: ['semana', 'revisao'] });
  });
  it('a card brought up from "Mais para hoje" stays while it is due; one no longer due is ignored', () => {
    expect(pickMoment(['fechamento', 'semana', 'revisao'], 'revisao')).toEqual({ shown: 'revisao', more: ['fechamento', 'semana'] });
    expect(pickMoment(['fechamento', 'semana'], 'mes')).toEqual({ shown: 'fechamento', more: ['semana'] });
  });
});
