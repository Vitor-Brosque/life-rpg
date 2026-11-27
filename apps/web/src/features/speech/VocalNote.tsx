import { useSpeechSettings } from '../../db/speechData';
import { dismissSpeechNote } from '../../domain/speechActions';
import { Button } from '../../ui/Button';
import { focusWhenGone } from '../../ui/focusAfter';
import { Panel } from '../../ui/Panel';
import { safeRun } from '../../ui/safeRun';
import './speech.css';

export const VOCAL_NOTE = 'Rouquidão que não melhora em cerca de 4 semanas, dor ao falar, perda de voz ou esforço constante para ser '
  + 'ouvido são motivos para procurar avaliação de um otorrinolaringologista ou de um fonoaudiólogo. Se a dificuldade de ser '
  + 'entendido continuar frequente apesar da prática, uma avaliação fonoaudiológica é o caminho para saber o que está acontecendo. '
  + 'O app não avalia a sua voz e não faz diagnóstico.';
export const VOCAL_COMFORT = 'Pratique num volume confortável. Se a voz cansar ou doer, pare.';
export const VOCAL_SOURCE = 'Diretriz clínica de rouquidão (disfonia) da Academia Americana de Otorrinolaringologia e Cirurgia de Cabeça e Pescoço, '
  + 'atualização de 2018.';

/** The first-time note: shown until "Entendi"; the same text stays in "Saúde vocal e limites". */
export function VocalNote() {
  const settings = useSpeechSettings();
  if (settings === undefined || settings.noteDismissed) return null;
  return (
    <Panel variant="stone" className="speech-note">
      <p>{VOCAL_NOTE}</p>
      <Button size="sm" onClick={(e) => {
        // The note goes away: focus moves to the screen's own heading, never to <body>.
        focusWhenGone(e.currentTarget, () => document.getElementById('speech-title'));
        safeRun(dismissSpeechNote());
      }}>Entendi</Button>
    </Panel>
  );
}

/** Always available, closed by default. */
export function VocalLimits() {
  return (
    <details className="speech-why">
      <summary>Saúde vocal e limites</summary>
      <p>{VOCAL_NOTE}</p>
      <p>{VOCAL_COMFORT}</p>
      <p className="muted">{VOCAL_SOURCE}</p>
    </details>
  );
}
