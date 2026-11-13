import { useEffect, useState } from 'react';
import type { Deck } from '@life/shared';
import { useAreas, useJourneys } from '../../db/hooks';
import { saveDeck } from '../../domain/studyActions';
import { Button } from '../../ui/Button';
import { safeRun } from '../../ui/safeRun';
import { Sheet } from '../../ui/Sheet';
import { SPEECH_LANGS, speechSupported } from '../media/speech';
import { LinkSelect } from '../routine/BlockFields';

const linkOf = (d?: Deck): string => (d?.journeyId ? `journey:${d.journeyId}` : d?.areaId ? `area:${d.areaId}` : '');

/** New / edit deck: a name and an optional link (journey or area: where its XP goes). */
export function DeckSheet({ open, onClose, deck }: { open: boolean; onClose(): void; deck?: Deck }) {
  const areas = useAreas();
  const journeys = useJourneys();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [lang, setLang] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(deck?.name ?? '');
    setLink(linkOf(deck));
    setLang(deck?.speechLang ?? '');
  }, [open, deck]);

  const submit = (): void => {
    if (!name.trim()) return;
    const [type, id] = link.split(':');
    safeRun(saveDeck({
      id: deck?.id, name,
      journeyId: type === 'journey' ? id : undefined,
      areaId: type === 'area' ? id : undefined,
      speechLang: lang,
    }).then(onClose));
  };

  return (
    <Sheet open={open} onClose={onClose} title={deck ? 'Editar baralho' : 'Novo baralho'}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <label className="field__label" htmlFor="deck-name">Nome</label>
          <input id="deck-name" type="text" enterKeyHint="done" value={name} autoComplete="off" placeholder="Ex.: SQL, Faculdade · Cálculo"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <LinkSelect value={link} areas={areas} journeys={journeys} onChange={setLink}
          hint="O XP das revisões vai para essa área (ou para a área da jornada)." />
        <div className="field">
          <label className="field__label" htmlFor="deck-lang">Ouvir em voz alta</label>
          <select id="deck-lang" value={lang} aria-describedby="deck-lang-hint" onChange={(e) => setLang(e.target.value)}>
            <option value="">Desligado</option>
            {lang !== '' && !SPEECH_LANGS.some((l) => l.tag === lang) && <option value={lang}>{lang}</option>}
            {SPEECH_LANGS.map((l) => <option key={l.tag} value={l.tag}>{l.label}</option>)}
          </select>
          <p id="deck-lang-hint" className="block-form__hint">
            {speechSupported() ? 'Mostra o botão Ouvir nos cards deste baralho. A voz é a do aparelho.'
              : 'Este navegador não lê em voz alta; a escolha vale nos outros aparelhos.'}
          </p>
        </div>
        <div className="commit-form__actions">
          <Button type="submit" variant="primary" icon="check" disabled={!name.trim()}>Salvar</Button>
          <Button onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Sheet>
  );
}
