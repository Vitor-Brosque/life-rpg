import type { Ref } from 'react';
import type { CodeLang, PracticePatch, PracticeSession, PracticeStep } from '@life/shared';
import { PRACTICE_LIMITS, listOps, stepLabel } from '@life/shared';
import { editPracticeList, peekImplementation, updatePractice } from '../../domain/practiceActions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { safeRun } from '../../ui/safeRun';
import { CodeEditor } from '../study/CodeEditor';
import { LANG_LABEL } from '../study/noteDraft';
import { CloseStep } from './CloseStep';
import { FeedbackStep } from './FeedbackStep';
import { RebuildStep } from './RebuildStep';
import { DraftText, JourneyMissionPicker, ListField } from './PracticeFields';
import { useDraftField } from './useDraftField';

export interface StepProps { session: PracticeSession; go(step: PracticeStep): void }

export const STEP_TITLE: Record<PracticeStep, string> = {
  problem: stepLabel('problem'), basics: stepLabel('basics'), plan: stepLabel('plan'), design: stepLabel('design'),
  code: stepLabel('code'), test: stepLabel('test'), feedback: stepLabel('feedback'), rebuild: 'Reconstruir sem consulta',
  close: stepLabel('close'),
};

const LANGS = Object.keys(LANG_LABEL) as CodeLang[];
const saver = (s: PracticeSession, key: keyof PracticePatch) => (v: string) => updatePractice(s.id, { [key]: v } as PracticePatch);
const T = PRACTICE_LIMITS.text;

function ProblemStep({ session }: StepProps) {
  return (
    <>
      <DraftText label="Qual é o problema?" hint="Uma ou duas frases, com suas palavras." multiline rows={3} maxLength={T}
        saved={session.problem} onSave={saver(session, 'problem')} />
      <DraftText label="Entradas" placeholder="ex.: JSON da NewsAPI com 100 artigos" multiline rows={2} maxLength={T}
        saved={session.inputs} onSave={saver(session, 'inputs')} />
      <DraftText label="Saídas" placeholder="ex.: linhas novas na tabela articles, sem repetidas" multiline rows={2} maxLength={T}
        saved={session.outputs} onSave={saver(session, 'outputs')} />
      <details className="practice__links">
        <summary>Jornada e missão</summary>
        <JourneyMissionPicker journeyId={session.journeyId} missionId={session.missionId}
          onChange={(next) => safeRun(updatePractice(session.id, { journeyId: next.journeyId, missionId: next.missionId }))} />
      </details>
    </>
  );
}

function BasicsStep({ session }: StepProps) {
  return (
    <>
      <p className="practice__hint">Que conceitos este problema usa? Liste o que você precisa saber ou rever.</p>
      <ListField legend="Conceitos" noun="conceito" items={session.basics} placeholder="ex.: set, UNIQUE no PostgreSQL"
        onEdit={(fn) => safeRun(editPracticeList(session.id, 'basics', fn))} />
    </>
  );
}

function PlanStep({ session }: StepProps) {
  return (
    <>
      <p className="practice__hint">Quebre em passos pequenos, na ordem. Diga que parte do código faz cada um: função, módulo ou tabela.</p>
      <ListField legend="Passos" noun="passo" items={session.plan} placeholder="ex.: normalizar a URL (função normalize_url)"
        onEdit={(fn) => safeRun(editPracticeList(session.id, 'plan', fn))} />
      <p className="practice__hint">Para desenhar o fluxo, use a Lousa, no topo.</p>
    </>
  );
}

function DesignStep({ session }: StepProps) {
  return (
    <>
      <DraftText label="Alternativas que você considerou" multiline rows={3} maxLength={T}
        saved={session.alternatives} onSave={saver(session, 'alternatives')} />
      <DraftText label="O que decidiu e por quê" multiline rows={3} maxLength={T}
        saved={session.decision} onSave={saver(session, 'decision')} />
    </>
  );
}

function CodeStep({ session, go }: StepProps) {
  const code = useDraftField(session.code, (v) => updatePractice(session.id, { code: v }));
  const rb = session.rebuild;
  const hidden = !!rb && rb.comparedAt === undefined && !rb.peeked;
  return (
    <>
      <p className="practice__hint">Escreva você mesmo, passo a passo. Travou? Volte ao Decompor ou registre o erro.</p>
      <fieldset className="attr">
        <legend className="field__label">Linguagem</legend>
        <div className="cluster">
          {LANGS.map((l) => (
            <Chip key={l} selected={session.language === l} onClick={() => safeRun(updatePractice(session.id, { language: l }))}>
              {LANG_LABEL[l]}
            </Chip>
          ))}
        </div>
      </fieldset>
      {session.plan.length > 0 ? (
        <fieldset className="practice-plan">
          <legend className="field__label">Passos</legend>
          <ul className="practice-plan__items">
            {session.plan.map((p) => (
              <li key={p.id}>
                <label className="practice-plan__item">
                  <input type="checkbox" className="px-checkbox" checked={p.done} aria-label={`Feito: ${p.text}`}
                    onChange={(e) => {
                      // Read now: the list changes later, inside the transaction, after React re-rendered the box.
                      const done = e.target.checked;
                      safeRun(editPracticeList(session.id, 'plan', (xs) => listOps.set(xs, p.id, { done })));
                    }} />
                  <span className={p.done ? 'is-done' : undefined}>{p.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <div className="practice__empty">
          <p className="muted">Sem passos ainda. Decompor ajuda a saber por onde começar.</p>
          <Button size="sm" variant="ghost" onClick={() => go('plan')}>Ir para Decompor</Button>
        </div>
      )}
      {hidden ? (
        <div className="practice-hidden" role="note" aria-label="Implementação escondida">
          <p>Implementação escondida enquanto você reconstrói.</p>
          <Button size="sm" onClick={() => safeRun(peekImplementation(session.id))}>Mostrar mesmo assim</Button>
        </div>
      ) : (
        <div onFocus={code.onFocus} onBlur={code.onBlur}>
          <CodeEditor label="Sua implementação" value={code.value} onChange={code.onChange} language={session.language} rows={14} />
        </div>
      )}
    </>
  );
}

function TestStep({ session }: StepProps) {
  return (
    <>
      <p className="practice__hint">
        Que casos você testou? Escreva entrada → esperado e marque os que passaram. Inclua um caso de borda: vazio, repetido, erro da API.
      </p>
      <ListField legend="Casos de teste" noun="caso" items={session.tests} placeholder="ex.: lista vazia → []"
        checkLabel={(t) => `Passou: ${t}`} onEdit={(fn) => safeRun(editPracticeList(session.id, 'tests', fn))} />
    </>
  );
}

/** The current step: its focusable title, then its fields. */
export function StepBody({ step, session, go, headingRef }: StepProps & { step: PracticeStep; headingRef: Ref<HTMLHeadingElement> }) {
  const props = { session, go };
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className="practice__step-title">{STEP_TITLE[step]}</h2>
      {step === 'problem' && <ProblemStep {...props} />}
      {step === 'basics' && <BasicsStep {...props} />}
      {step === 'plan' && <PlanStep {...props} />}
      {step === 'design' && <DesignStep {...props} />}
      {step === 'code' && <CodeStep {...props} />}
      {step === 'test' && <TestStep {...props} />}
      {step === 'feedback' && <FeedbackStep {...props} />}
      {step === 'rebuild' && <RebuildStep {...props} />}
      {step === 'close' && <CloseStep {...props} />}
    </>
  );
}
