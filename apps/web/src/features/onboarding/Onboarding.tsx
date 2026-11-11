import { useState } from 'react';
import type { Mission, Profile } from '@life/shared';
import { Companion } from '../../art/Companion';
import { db } from '../../db/db';
import { patch } from '../../db/repo';
import { captureLines, reorderDay } from '../../domain/actions';
import { getToday } from '../../domain/common';
import { setSyncToken, syncNow, type TokenResult } from '../../sync/client';
import { Panel } from '../../ui/Panel';
import { useToast } from '../../ui/Toast';
import { DEFAULT_COMPANION, draftFromProfile, profileChanges, type LookDraft } from '../character/LookEditor';
import { useCompanion } from '../companion/store';
import { AccessCodeStep, LookStep, MindStep, PickStep, WelcomeStep } from './OnboardingSteps';
import './onboarding.css';

type Step = 'welcome' | 'code' | 'look' | 'mind' | 'pick';

const STEP_NUMBER: Record<Step, number> = { welcome: 1, code: 1, look: 2, mind: 3, pick: 4 };
const STEP_COUNT = 4;
/** The introduction stays a little longer than an ordinary companion line. */
const INTRO_MS = 10_000;

const isMission = (r: object): r is Mission => 'status' in r;

/** "Oi, Vitor! Eu sou Faísca. Vou te mostrar um passo de cada vez." */
export function introMessage(name: string, companion: string): string {
  const n = name.trim();
  return `Oi${n ? `, ${n}` : ''}! Eu sou ${companion || DEFAULT_COMPANION}. Vou te mostrar um passo de cada vez.`;
}

/**
 * First access (§13), shown by App instead of the routes while `profile.onboarded` is false.
 * Everything works offline; only "Já uso em outro aparelho" talks to the server. Once
 * `onboarded` flips (here, or through a synced profile) App leaves this screen by itself.
 */
export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [look, setLook] = useState<LookDraft>();
  const [created, setCreated] = useState<Mission[]>([]);
  const toast = useToast((s) => s.show);

  const guard = (fn: () => Promise<void>) => fn().catch((e: unknown) => {
    console.error('onboarding step failed', e);
    toast('Não foi possível salvar. Tente de novo.');
  });

  const goLook = () => guard(async () => {
    setLook(draftFromProfile(await db.profile.get('me')));
    setStep('look');
  });

  const finish = () => guard(async () => {
    const p = await db.profile.get('me');
    await useCompanion.getState().announce(introMessage(p?.name ?? '', p?.companionName ?? ''), INTRO_MS);
    await patch<Profile>('profile', 'me', { onboarded: true });
  });

  const connect = async (code: string): Promise<TokenResult> => {
    const result = await setSyncToken(code);
    if (result !== 'ok') return result;
    await syncNow();
    // An onboarded profile from the other device makes App leave this screen (live query).
    const p = await db.profile.get('me');
    if (!p?.onboarded) await goLook();
    return result;
  };

  const saveLook = (draft: LookDraft) => guard(async () => {
    await patch<Profile>('profile', 'me', profileChanges(draft));
    setStep('mind');
  });

  const saveMind = (text: string) => guard(async () => {
    const missions = (await captureLines(text)).filter(isMission);
    setCreated(missions);
    if (missions.length > 0) setStep('pick');
    else await finish();
  });

  const pick = (id: string) => guard(async () => {
    await reorderDay([id], await getToday());
    await finish();
  });

  const number = STEP_NUMBER[step];
  return (
    <main className="onboarding">
      <div className="onboarding__inner">
        <div className="onboarding__top">
          <Companion scale={step === 'welcome' ? 6 : 4} />
          <ol className="onboarding__dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <li key={i} className={i + 1 === number ? 'is-current' : i + 1 < number ? 'is-done' : undefined} />
            ))}
          </ol>
          <p className="visually-hidden">Passo {number} de {STEP_COUNT}</p>
        </div>
        <Panel className="onboarding__card">
          {step === 'welcome' && <WelcomeStep onFresh={() => { void goLook(); }} onExisting={() => setStep('code')} />}
          {step === 'code' && <AccessCodeStep onConnect={connect} onBack={() => setStep('welcome')} />}
          {step === 'look' && look && <LookStep initial={look} onNext={saveLook} onSkip={() => setStep('mind')} />}
          {step === 'mind' && <MindStep onNext={saveMind} onSkip={() => { void finish(); }} />}
          {step === 'pick' && <PickStep missions={created} onPick={pick} onSkip={() => { void finish(); }} />}
        </Panel>
      </div>
    </main>
  );
}
