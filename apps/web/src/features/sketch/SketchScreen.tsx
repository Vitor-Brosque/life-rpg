import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useLiveQuery } from 'dexie-react-hooks';
import { sketchTitle } from '@life/shared';
import { db } from '../../db/db';
import { deleteSketch, renameSketch, restoreSketch } from '../../domain/sketchActions';
import { Button } from '../../ui/Button';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { safeRun } from '../../ui/safeRun';
import { useToast } from '../../ui/Toast';
import { useMissionSheet } from '../mission/MissionSheet';
import { SketchPad } from './SketchPad';
import { safeBack } from './sketchData';
import { usePersistedSketch } from './usePersistedSketch';
import './sketch.css';

/** "/lousa/:id": one lousa, full height (spec §6.2). */
export function SketchScreen({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const back = safeBack(new URLSearchParams(useSearch()).get('voltar'));
  const doc = usePersistedSketch(id);
  const missionId = doc.sketch?.missionId;
  const mission = useLiveQuery(async () => (missionId ? (await db.missions.get(missionId)) ?? null : null), [missionId]);
  const missionTitle = mission && !mission.deleted ? mission.title : undefined;
  const [title, setTitle] = useState<string | undefined>(undefined);
  const savedTitle = doc.sketch?.title ?? '';
  useEffect(() => { if (doc.status === 'ready') setTitle((t) => t ?? savedTitle); }, [doc.status, savedTitle]);

  if (doc.status === 'loading') return <section className="screen sketch-screen" aria-busy="true" aria-label="Lousa" />;
  if (doc.status === 'missing' || !doc.sketch) {
    return (
      <section className="screen stack">
        <h1 tabIndex={-1} data-focus-target={FOCUS_PAGE}>Lousa não encontrada</h1>
        <Link href="/estudo/lousas">Ver lousas</Link>
      </section>
    );
  }
  const sketch = doc.sketch;
  const saveTitle = (): void => {
    const next = (title ?? '').trim();
    if (next !== sketch.title) safeRun(renameSketch(id, next));
    setTitle(next);
  };
  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); setTitle(sketch.title); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
  };
  const remove = (): void => safeRun(deleteSketch(id).then(() => {
    navigate(back);
    useToast.getState().show('Lousa apagada.', { label: 'Desfazer', run: () => safeRun(restoreSketch(id)) });
  }));

  return (
    <section className="screen sketch-screen" aria-labelledby="sketch-title">
      <h1 id="sketch-title" className="visually-hidden" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Lousa</h1>
      <div className="sketch-screen__top">
        <Button size="sm" variant="ghost" onClick={() => navigate(back)}>← Voltar</Button>
        <input className="sketch-screen__title" aria-label="Título da lousa" value={title ?? ''} maxLength={80}
          placeholder={sketchTitle({ title: '', createdAt: sketch.createdAt }, missionTitle)}
          onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={onTitleKey} />
        {sketch.missionId && (
          <Button size="sm" variant="ghost" onClick={() => useMissionSheet.getState().open(sketch.missionId!)}>Missão</Button>
        )}
        <Button size="sm" variant="ghost" onClick={remove}>Apagar</Button>
      </div>
      <SketchPad key={doc.padKey} className="sketch-screen__pad" label="Lousa" initial={doc.initial}
        onChange={doc.onChange} onGestureChange={doc.onGestureChange} />
    </section>
  );
}
