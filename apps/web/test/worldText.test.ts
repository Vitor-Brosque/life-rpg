import { describe, expect, it } from 'vitest';
import type { Area } from '@life/shared';
import { buildWorld } from '@life/shared';
import {
  celebrationText, hubLabel, journeyLine, newsLine, nextStageText, territoryLabel, worldSummary,
} from '../src/features/world/worldText';

const area = (id: string, attribute: string, name: string, order: number): Area => ({
  id, name, attribute, color: '#e5675d', icon: 'heart', order, archived: false, createdAt: 1, updatedAt: 1, deleted: false,
});
const AREAS = [area('area-vigor', 'Vigor', 'Corpo', 0), area('area-oficio', 'Ofício', 'Trabalho', 1)];

describe('celebrationText', () => {
  it('one sentence per news, outfit names from the palette, unknown areas skipped', () => {
    expect(celebrationText([{ kind: 'stage', areaId: 'area-vigor', stage: 2, at: 1 }], AREAS))
      .toBe('O território de Vigor agora é uma aldeia!');
    expect(celebrationText([{ kind: 'outfit', outfit: 6, at: 1 }], AREAS))
      .toBe('Nova cor de roupa: Esmeralda. Ela já está em Editar aparência.');
    expect(celebrationText([{ kind: 'stage', areaId: 'gone', stage: 2, at: 1 }], AREAS)).toBeUndefined();
    expect(celebrationText([], AREAS)).toBeUndefined();
  });
  it('more than two: the first two and a pointer to the map', () => {
    expect(celebrationText([
      { kind: 'stage', areaId: 'area-vigor', stage: 1, at: 1 },
      { kind: 'stage', areaId: 'area-oficio', stage: 4, at: 1 },
      { kind: 'outfit', outfit: 7, at: 1 },
    ], AREAS)).toBe('O território de Vigor agora é um acampamento! O território de Ofício agora é um castelo! E há mais novidades no mapa.');
  });
});

describe('news, labels and summary', () => {
  it('newsLine for the Personagem card', () => {
    expect(newsLine({ kind: 'stage', areaId: 'area-vigor', stage: 2, at: 1 }, AREAS)).toBe('Vigor virou aldeia');
    expect(newsLine({ kind: 'outfit', outfit: 9, at: 1 }, AREAS)).toBe('Nova cor de roupa: Dourado');
    expect(newsLine({ kind: 'stage', areaId: 'gone', stage: 2, at: 1 }, AREAS)).toBeUndefined();
  });

  it('territoryLabel joins only the parts that apply', () => {
    const w = buildWorld({
      areas: AREAS, xp: [], avatarAreaId: 'area-vigor',
      journeys: [{ id: 'j', title: 'Tech News', areaId: 'area-oficio', order: 0, done: 3, total: 7 }],
    });
    const [vigor, oficio] = w.territories;
    expect(territoryLabel(vigor!, { avatarHere: true, talk: false, grew: true }))
      .toBe('Vigor, Corpo: Ruínas, nível 1. Dara (treinadora) está aqui. Você está aqui. Cresceu nos últimos dias.');
    expect(territoryLabel(oficio!, { avatarHere: false, talk: true, grew: false }))
      .toBe('Ofício, Trabalho: Ruínas, nível 1. Bruna (ferreira) tem um recado para hoje. Jornada “Tech News”: 3 de 7 missões.');
    expect(journeyLine({ title: 'X', done: 0, total: 1 })).toBe('Jornada “X”: 0 de 1 missão');
    expect(journeyLine({ title: 'X', done: 0, total: 0 })).toBe('Jornada “X”: sem missões ainda');
    expect(worldSummary(w)).toBe('Você está em Vigor · 2 territórios · 2 em ruínas');
    expect(worldSummary({ ...w, avatar: { cell: w.hub.cell } })).toBe('Você está na Encruzilhada · 2 territórios · 2 em ruínas');
  });

  it('nextStageText and hubLabel', () => {
    expect(nextStageText({ next: { stage: 2, level: 5, xpLeft: 115 } })).toBe('Próximo estágio: Aldeia, no nível 5 (faltam 115 XP)');
    expect(nextStageText({ next: { stage: 2, level: 5, xpLeft: 1 } })).toBe('Próximo estágio: Aldeia, no nível 5 (falta 1 XP)');
    expect(nextStageText({})).toBe('Estágio máximo. O castelo fica, mesmo nos dias parados.');
    expect(hubLabel('Faísca', true)).toBe('Encruzilhada, onde começam as estradas das jornadas. Faísca está aqui. Você está aqui.');
    expect(hubLabel('Lume', false)).toBe('Encruzilhada, onde começam as estradas das jornadas. Lume está aqui.');
  });
});
