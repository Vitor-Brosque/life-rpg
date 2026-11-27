import { describe, expect, it } from 'vitest';
import type { ContactData } from '../src/faculty';
import type { Journey, StudyFile } from '../src/types';
import { ASSIST_RULES, PASTE_NOTEBOOK_RULE, buildAssistContext } from '../src/assist';
import { pasteRequestText } from '../src/assistPaste';
import { lastContactDay } from '../src/faculty';
import {
  MEDIA_MAX_BYTES, PDF_MAX_BYTES, PDF_TEXT_MAX_BYTES, PDF_TEXT_SIGNATURE, PDF_TEXT_TYPE, isStudyFileMedia, mediaMaxBytes,
  sniffMediaType,
} from '../src/media';
import {
  MATERIAL_MESSAGES, MATERIAL_TABLES, STUDY_FILE_LIMITS, buildMaterialView, encodePdfText, pageTextFromItems, pagesHaveText,
  pagesText, parsePdfText, recallFront, studyFileTitle, type PdfText,
} from '../src/studyFiles';
import { SUBJECT_CONTEXT_TABLES, buildSubjectContext } from '../src/subjectContext';
import { base } from './patternFixture';

// PDFs da aula no app (spec 2026-11-26 fase 2, §2, §3 and §6).

const TODAY = '2026-11-26';
const ascii = (s: string) => new TextEncoder().encode(s);
const journey = (id: string, title: string, p: Partial<Journey> = {}): Journey => ({ ...base, id, title, status: 'active', order: 0, subject: true, ...p });
const file = (id: string, p: Partial<StudyFile> = {}): StudyFile => ({
  ...base, id, title: `PDF ${id}`, fileHash: 'a'.repeat(64), bytes: 1000, pages: 10, hasText: true, textHash: 'b'.repeat(64), textChars: 100, ...p,
});

describe('media types of the PDFs (§2.1–§2.2)', () => {
  it('sniffs a PDF by %PDF- and the extracted text by its own signature; the declared type is never trusted', () => {
    expect(sniffMediaType(ascii('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe('application/pdf');
    expect(sniffMediaType(ascii(`${PDF_TEXT_SIGNATURE}"pages":["a"]}`))).toBe(PDF_TEXT_TYPE);
    expect(PDF_TEXT_SIGNATURE).toBe('{"lifeRpgPdfText":1,');
    // Close but not the signatures: refused.
    expect(sniffMediaType(ascii(' %PDF-1.7 with a space first'))).toBeUndefined();
    expect(sniffMediaType(ascii('{"lifeRpgPdfText":2,"pages":[]}'))).toBeUndefined();
    expect(sniffMediaType(ascii('{"pages":[],"lifeRpgPdfText":1}'))).toBeUndefined();
  });

  it('each type has its limit: 50 MB for a PDF, 4 MB for its text, 8 MB for images and audio', () => {
    expect(PDF_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(PDF_TEXT_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(mediaMaxBytes('application/pdf')).toBe(PDF_MAX_BYTES);
    expect(mediaMaxBytes(PDF_TEXT_TYPE)).toBe(PDF_TEXT_MAX_BYTES);
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'] as const) {
      expect(mediaMaxBytes(t)).toBe(MEDIA_MAX_BYTES);
    }
    expect([isStudyFileMedia('application/pdf'), isStudyFileMedia(PDF_TEXT_TYPE), isStudyFileMedia('image/png')]).toEqual([true, true, false]);
  });
});

describe('the extracted text (§2.3)', () => {
  it('is a JSON that starts exactly with the signature and comes back with every page', () => {
    const pages = ['Aula 1: modelo relacional', '', 'Normalização "3FN" \\ fim', 'Índice ç ã'];
    const { bytes, chars, keptPages } = encodePdfText(pages);
    expect(new TextDecoder().decode(bytes.subarray(0, 20))).toBe(PDF_TEXT_SIGNATURE);
    expect(sniffMediaType(bytes)).toBe(PDF_TEXT_TYPE);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ lifeRpgPdfText: 1, pages });
    expect(parsePdfText(bytes)).toEqual({ lifeRpgPdfText: 1, pages });
    expect(keptPages).toBe(4);
    expect(chars).toBe(pages.join('').length);
  });

  it('pages that do not fit the limit are left out from the end', () => {
    const pages = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
    const { bytes, keptPages, chars } = encodePdfText(pages, 120);
    expect(bytes.length).toBeLessThanOrEqual(120);
    expect(keptPages).toBe(2);
    expect(chars).toBe(80);
    expect(parsePdfText(bytes)!.pages).toEqual(pages.slice(0, 2));
  });

  it('parse refuses what is not the app\'s text', () => {
    expect(parsePdfText('{"lifeRpgPdfText":1,"pages":[1]}')).toBeUndefined();
    expect(parsePdfText('{"lifeRpgPdfText":1,"pages":"x"}')).toBeUndefined();
    expect(parsePdfText('{"lifeRpgPdfText":1,"pages":[')).toBeUndefined();
    expect(parsePdfText('{"pages":[]}')).toBeUndefined();
    expect(parsePdfText(ascii('%PDF-1.4'))).toBeUndefined();
  });

  it('a page\'s text: runs joined, line breaks kept, spaces squeezed; a scanned PDF has no text', () => {
    expect(pageTextFromItems([
      { str: 'Banco  de', hasEOL: false }, { str: ' Dados', hasEOL: true }, { str: '' , hasEOL: true }, { str: '', hasEOL: true },
      { str: '\u00a0 Aula 1 ', hasEOL: true }, { hasEOL: false },
    ])).toBe('Banco de Dados\n\nAula 1');
    expect(pagesHaveText(['', '  \n '])).toBe(false);
    expect(pagesHaveText(['', 'x'])).toBe(true);
  });

  it('titles, pages and fronts', () => {
    expect(studyFileTitle('Aula_03 - Normalização.PDF')).toBe('Aula 03 - Normalização');
    expect(studyFileTitle('.pdf')).toBe('PDF');
    expect(studyFileTitle(`${'x'.repeat(200)}.pdf`)).toHaveLength(STUDY_FILE_LIMITS.title);
    expect([pagesText(1), pagesText(120)]).toEqual(['1 página', '120 páginas']);
    expect(recallFront('Slides BD', 12, 18)).toBe('Slides BD · p. 12–18');
    expect(recallFront('Slides BD', 12, 12)).toBe('Slides BD · p. 12');
  });
});

// ------------------------------------------------------------------ the connector (§3)

const journeys = [
  journey('bd', 'Banco de Dados'), journey('calc', 'Cálculo I', { order: 1 }), journey('old', 'Física', { deleted: true }),
  journey('proj', 'Projeto pessoal', { subject: undefined }),
];
const files = [
  file('f1', { journeyId: 'bd', title: 'Slides de BD', pages: 3 }),
  file('f2', { journeyId: 'bd', title: 'Apostila escaneada', hasText: false, textHash: undefined, textChars: undefined, pages: 4 }),
  file('f3', { journeyId: 'bd', title: 'Apagado', deleted: true }),
  file('f4', { journeyId: 'calc', title: 'Lista de cálculo' }),
  file('f5', { title: 'Extrato pessoal secreto' }),
  file('f6', { journeyId: 'old', title: 'De disciplina apagada' }),
  file('f7', { journeyId: 'proj', title: 'De jornada comum' }),
  file('f8', { journeyId: 'bd', title: 'Plano de ensino', pages: 2, textChars: 50, textHash: 'c'.repeat(64) }),
];

describe('ler_disciplina with files (§3.1)', () => {
  it('lists the live PDFs of the subject (id, title, pages, hasText, textChars), never their text or others', () => {
    expect(SUBJECT_CONTEXT_TABLES).toContain('studyFiles');
    const r = buildSubjectContext({ journeys, studyFiles: files }, 'Banco de Dados', TODAY);
    if (!r.ok) throw new Error('subject');
    expect(r.context.files).toEqual([
      { id: 'f2', title: 'Apostila escaneada', pages: 4, hasText: false, textChars: 0 },
      { id: 'f8', title: 'Plano de ensino', pages: 2, hasText: true, textChars: 50 },
      { id: 'f1', title: 'Slides de BD', pages: 3, hasText: true, textChars: 100 },
    ]);
    const all = JSON.stringify(r.context);
    for (const secret of ['Extrato pessoal secreto', 'Lista de cálculo', 'Apagado', 'De jornada comum', 'a'.repeat(64)]) expect(all).not.toContain(secret);
  });
  it('a subject without PDFs has an empty list', () => {
    const r = buildSubjectContext({ journeys }, 'Cálculo I', TODAY);
    expect(r.ok && r.context.files).toEqual([]);
  });
});

describe('ler_material (§3.2)', () => {
  const texts: Record<string, PdfText> = {
    ['b'.repeat(64)]: { lifeRpgPdfText: 1, pages: ['Página um', 'Página dois', 'Página três'] },
  };
  const read = (h: string) => texts[h];
  const view = (input: Record<string, unknown>, t = { journeys, studyFiles: files }) => buildMaterialView(t, input, read);

  it('reads only journeys and studyFiles', () => {
    expect([...MATERIAL_TABLES]).toEqual(['journeys', 'studyFiles']);
  });

  it('without fromPage starts at 1 and goes to the end, each page with its number', () => {
    const r = view({ id: 'f1' });
    expect(r).toEqual({ ok: true, material: {
      id: 'f1', title: 'Slides de BD', subject: 'Banco de Dados', pages: 3, fromPage: 1, toPage: 3,
      text: [{ page: 1, text: 'Página um' }, { page: 2, text: 'Página dois' }, { page: 3, text: 'Página três' }],
    } });
  });

  it('a range', () => {
    const r = view({ id: 'f1', fromPage: 2, toPage: 2 });
    expect(r.ok && r.material.text).toEqual([{ page: 2, text: 'Página dois' }]);
    expect(r.ok && [r.material.fromPage, r.material.toPage, r.material.nextPage]).toEqual([2, 2, undefined]);
  });

  it('at most 40 thousand characters: cut at the last whole page that fits, with nextPage', () => {
    const big = { lifeRpgPdfText: 1 as const, pages: ['a'.repeat(15_000), 'b'.repeat(15_000), 'c'.repeat(15_000), 'd'.repeat(5)] };
    const t = { journeys, studyFiles: [file('g', { journeyId: 'bd', pages: 4 })] };
    const r = buildMaterialView(t, { id: 'g' }, () => big);
    if (!r.ok) throw new Error(r.message);
    expect(r.material.text.map((p) => p.page)).toEqual([1, 2]);
    expect([r.material.fromPage, r.material.toPage, r.material.nextPage]).toEqual([1, 2, 3]);
    const next = buildMaterialView(t, { id: 'g', fromPage: 3 }, () => big);
    expect(next.ok && next.material.text.map((p) => p.page)).toEqual([3, 4]);
    expect(next.ok && next.material.nextPage).toBeUndefined();
    // Exactly 40 thousand fits.
    const exact = buildMaterialView(t, { id: 'g' }, () => ({ lifeRpgPdfText: 1, pages: ['a'.repeat(20_000), 'b'.repeat(20_000), 'c', 'd'] }));
    expect(exact.ok && exact.material.toPage).toBe(2);
  });

  it('a single page longer than the limit comes cut, and the next call starts after it', () => {
    const t = { journeys, studyFiles: [file('g', { journeyId: 'bd', pages: 2 })] };
    const r = buildMaterialView(t, { id: 'g' }, () => ({ lifeRpgPdfText: 1, pages: ['x'.repeat(50_000), 'y'] }));
    if (!r.ok) throw new Error(r.message);
    expect(r.material.text).toHaveLength(1);
    expect(r.material.text[0]!.text).toHaveLength(STUDY_FILE_LIMITS.materialChars);
    expect(r.material.text[0]!.text.endsWith('…')).toBe(true);
    expect(r.material.nextPage).toBe(2);
  });

  it('a PDF without text, text not on the server yet, unknown or deleted ids', () => {
    expect(view({ id: 'f2' })).toEqual({ ok: false, message: 'Este PDF não tem texto: é uma imagem escaneada.' });
    expect(view({ id: 'f8' })).toEqual({ ok: false, message: MATERIAL_MESSAGES.textMissing });
    expect(MATERIAL_MESSAGES.textMissing).toBe('O texto deste PDF ainda não chegou ao PC. Abra o app no aparelho onde o PDF foi adicionado, com o PC ligado.');
    for (const id of ['nada', 'f3', '', 42]) {
      const r = view({ id });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/^PDF ".*" não existe\. Use o id que ler_disciplina mostra em files\.$/);
    }
  });

  it('privacy: a "Sem disciplina" PDF, one of a deleted subject or of a plain journey answers as if it did not exist', () => {
    let reads = 0;
    for (const id of ['f5', 'f6', 'f7']) {
      const r = buildMaterialView({ journeys, studyFiles: files }, { id }, () => { reads += 1; return texts['b'.repeat(64)]; });
      expect(r).toEqual({ ok: false, message: `PDF "${id}" não existe. Use o id que ler_disciplina mostra em files.` });
    }
    expect(reads).toBe(0); // its text is never even read
  });

  it('only PDFs of active subjects: an archived or concluded subject\'s PDF answers as if it did not exist, like ler_disciplina', () => {
    let reads = 0;
    const readCounting = (h: string) => { reads += 1; return texts[h]; };
    for (const status of ['archived', 'done'] as const) {
      const t = { journeys: [journey('bd', 'Banco de Dados', { status })], studyFiles: [file('g', { journeyId: 'bd', pages: 3 })] };
      expect(buildMaterialView(t, { id: 'g' }, readCounting)).toEqual({ ok: false, message: 'PDF "g" não existe. Use o id que ler_disciplina mostra em files.' });
      expect(buildSubjectContext(t, 'Banco de Dados', TODAY).ok).toBe(false);
    }
    expect(reads).toBe(0);
    const active = { journeys: [journey('bd', 'Banco de Dados')], studyFiles: [file('g', { journeyId: 'bd', pages: 3 })] };
    expect(buildMaterialView(active, { id: 'g' }, readCounting).ok).toBe(true);
  });

  it('pages out of range', () => {
    const msg = 'Página fora do intervalo: o PDF tem 3 páginas. Use fromPage e toPage entre 1 e 3, com fromPage até toPage.';
    for (const input of [{ fromPage: 0 }, { fromPage: 4 }, { toPage: 4 }, { fromPage: 3, toPage: 2 }, { fromPage: 1.5 }, { fromPage: '2' }]) {
      expect(view({ id: 'f1', ...input })).toEqual({ ok: false, message: msg });
    }
  });

  it('pages whose text did not fit the 4 MB come empty, with a note', () => {
    const t = { journeys, studyFiles: [file('g', { journeyId: 'bd', pages: 3 })] };
    const r = buildMaterialView(t, { id: 'g' }, () => ({ lifeRpgPdfText: 1, pages: ['um'] }));
    if (!r.ok) throw new Error(r.message);
    expect(r.material.text).toEqual([{ page: 1, text: 'um' }, { page: 2, text: '' }, { page: 3, text: '' }]);
    expect(r.material.note).toBe('O texto das páginas depois da 1 não coube no limite de 4 MB do app.');
  });
});

describe('rules, paste and contact (§1.7, §3.4, §3.5)', () => {
  it('the notebook rule says to read the PDFs with ler_material and cite the page; privacy leaves out PDFs without a subject', () => {
    expect(ASSIST_RULES.notebook).toContain('leia os PDFs da disciplina com ler_material antes de montar apostilas a partir deles; cite a página');
    expect(ASSIST_RULES.privacy).toContain('PDFs');
    expect(ASSIST_RULES.privacy).toContain('PDFs fora das disciplinas');
    expect(PASTE_NOTEBOOK_RULE).not.toContain('ler_material');
  });

  it('"Copiar pedido de estudo" lists the PDFs with title and pages, without the text or the id', () => {
    const r = buildSubjectContext({ journeys, studyFiles: files }, 'Banco de Dados', TODAY);
    if (!r.ok) throw new Error('subject');
    const ctx = buildAssistContext({ journeys }, TODAY);
    const text = pasteRequestText(ctx, TODAY, 'Banco de Dados', r.context);
    const memory = JSON.parse(text.slice(text.lastIndexOf('\n') + 1)) as { files: unknown };
    expect(memory.files).toEqual([
      { title: 'Apostila escaneada', pages: 4 }, { title: 'Plano de ensino', pages: 2 }, { title: 'Slides de BD', pages: 3 },
    ]);
    expect(text).not.toContain('"f1"');
    expect(text).not.toContain('Extrato pessoal secreto');
  });

  it('reading a PDF of the subject counts as contact (its progress record; not a deleted PDF, not another subject\'s)', () => {
    const empty: ContactData = { dayStartHour: 4, decks: [], cards: [], reviews: [], practice: [], missions: [], focus: [], problemSets: [], topics: [] };
    expect(lastContactDay('bd', empty)).toBeUndefined();
    const at = (d: number) => new Date(2026, 10, d, 12).getTime();
    const studyFiles = [
      file('r1', { journeyId: 'bd' }),
      file('r2', { journeyId: 'bd', deleted: true }),
      file('r3', { journeyId: 'calc' }),
      file('r4', { journeyId: 'bd' }),
      file('r5', { journeyId: 'bd' }),
    ];
    const studyFileProgress = [
      { ...base, id: 'r1', lastPage: 3, lastReadAt: at(20) },
      { ...base, id: 'r2', lastReadAt: at(24) },
      { ...base, id: 'r3', lastReadAt: at(25) },
      { ...base, id: 'r5', lastPage: 9 }, // a page written without real reading is no contact
    ];
    expect(lastContactDay('bd', { ...empty, studyFiles })).toBeUndefined();
    expect(lastContactDay('bd', { ...empty, studyFiles, studyFileProgress })).toBe('2026-11-20');
    expect(lastContactDay('calc', { ...empty, studyFiles, studyFileProgress })).toBe('2026-11-25');
  });
});
