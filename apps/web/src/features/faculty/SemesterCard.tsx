import { useState } from 'react';
import { create } from 'zustand';
import type { HHmm } from '@life/shared';
import { CLASS_END, CLASS_START, SEMESTER_GRADE, genericClass, semesterSetup } from '@life/shared';
import type { FacultyData } from '../../db/facultyData';
import { FacultyValidationError, setupSemester } from '../../domain/facultyActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { WEEKDAY_ABBR, plural } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { FAILURE_TOAST } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { WEEKDAY_ORDER } from './SubjectSheet';

/** "Agora não": hides the card until the app is opened again (memory only, nothing is written). */
export const useSemesterCard = create<{ hidden: boolean; hide(): void }>((set) => ({
  hidden: false,
  hide: () => set({ hidden: true }),
}));

interface Row { title: string; day: string; start: string; end: string }

const rowsOf = (): Row[] => SEMESTER_GRADE.map((t) => ({
  title: t.title, day: t.weekdays[0] !== undefined ? String(t.weekdays[0]) : '', start: t.start, end: t.end,
}));

/** "Cadastrar a grade do semestre?" (an example grade to edit): writes only on "Confirmar". */
export function SemesterCard({ data }: { data: FacultyData }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(rowsOf);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { today, journeys, commitments } = data;
  const generic = genericClass(commitments, today);

  const confirm = async (button: Element | null) => {
    setBusy(true);
    try {
      const items = editing
        ? rows.map((r) => ({ title: r.title, weekdays: r.day === '' ? [] : [Number(r.day)], start: r.start as HHmm, end: r.end as HHmm }))
        : [...SEMESTER_GRADE];
      await setupSemester(items);
      useToast.getState().show(`Grade cadastrada: ${plural(items.length, 'disciplina', 'disciplinas')}.`);
      focusWhenGone(button);
    } catch (err) {
      if (err instanceof FacultyValidationError) setError(err.message);
      else { console.error('semester setup failed', err); useToast.getState().show(FAILURE_TOAST); }
    } finally {
      setBusy(false);
    }
  };
  const setRow = (i: number, changes: Partial<Row>) => {
    setRows((xs) => xs.map((r, j) => (j === i ? { ...r, ...changes } : r)));
    setError(undefined);
  };

  return (
    <Panel variant="stone" role="region" aria-labelledby="semester-title" className="semester">
      <h2 id="semester-title" className="semester__title">Cadastrar a grade do semestre?</h2>
      {!editing ? (
        <>
          <ul className="semester__list">
            {semesterSetup(SEMESTER_GRADE, journeys, commitments, today).map(({ template: t, journeyId, classId }) => (
              <li key={t.title}>
                {`${WEEKDAY_ABBR[t.weekdays[0] ?? 0]} · ${t.title} · ${t.start}–${t.end}`}
                {journeyId ? ' (jornada já existe)' : ''}{classId ? ' (aula já cadastrada)' : ''}
              </li>
            ))}
          </ul>
          <p className="semester__note muted">Esta grade é um exemplo: use “Editar antes” para pôr as suas disciplinas, dias e horários.</p>
          <p className="semester__note muted">Cria uma jornada por disciplina, na área Faculdade, e a aula semanal de cada uma. O que já existe com o mesmo nome é reaproveitado; nada é duplicado.</p>
          {generic && <p className="semester__note muted">O compromisso “Aula” (seg a sex) continua. Se as aulas agora são por disciplina, apague-o em Planejar → Rotina → Recorrentes.</p>}
          {error && <p role="alert" className="semester__error">{error}</p>}
          <div className="semester__actions">
            <Button variant="primary" disabled={busy} onClick={(e) => { void confirm(e.currentTarget); }}>Confirmar</Button>
            <Button onClick={() => setEditing(true)}>Editar antes</Button>
            <Button variant="ghost" onClick={() => useSemesterCard.getState().hide()}>Agora não</Button>
          </div>
        </>
      ) : (
        <>
          <ul className="semester__rows">
            {rows.map((r, i) => {
              const name = r.title.trim() || `disciplina ${i + 1}`;
              return (
                <li key={i} className="semester__row">
                  <label className="field">
                    <span className="field__label">Disciplina</span>
                    <input type="text" aria-label={`Nome da disciplina ${i + 1}`} value={r.title} autoComplete="off"
                      onChange={(e) => setRow(i, { title: e.target.value })} />
                  </label>
                  <label className="field">
                    <span className="field__label">Dia</span>
                    <select aria-label={`Dia da aula de ${name}`} value={r.day} onChange={(e) => setRow(i, { day: e.target.value })}>
                      {WEEKDAY_ORDER.map((d) => <option key={d} value={String(d)}>{WEEKDAY_ABBR[d]}</option>)}
                      <option value="">Sem dia ainda</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Início</span>
                    <input type="time" aria-label={`Início da aula de ${name}`} value={r.start} onChange={(e) => setRow(i, { start: e.target.value || CLASS_START })} />
                  </label>
                  <label className="field">
                    <span className="field__label">Fim</span>
                    <input type="time" aria-label={`Fim da aula de ${name}`} value={r.end} onChange={(e) => setRow(i, { end: e.target.value || CLASS_END })} />
                  </label>
                  <Button variant="ghost" aria-label={`Remover ${name}`}
                    onClick={() => { setRows((xs) => xs.filter((_, j) => j !== i)); setError(undefined); }}>Remover</Button>
                </li>
              );
            })}
          </ul>
          {error && <p role="alert" className="semester__error">{error}</p>}
          <div className="semester__actions">
            <Button variant="primary" disabled={busy || rows.length === 0} onClick={(e) => { void confirm(e.currentTarget); }}>Confirmar</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setRows(rowsOf()); setError(undefined); }}>Cancelar</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
