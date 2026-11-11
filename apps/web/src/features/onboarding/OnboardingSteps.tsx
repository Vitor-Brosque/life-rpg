import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Mission } from '@life/shared';
import type { TokenResult } from '../../sync/client';
import { Button } from '../../ui/Button';
import { LookFields, type LookDraft } from '../character/LookEditor';

// The individual first-access steps (§13). Onboarding.tsx owns the flow and the writes.

/** Step heading that takes focus when the step appears, so screen readers announce it. */
export function StepHeading({ id, children }: { id?: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <h2 id={id} ref={ref} tabIndex={-1} className="onboarding__heading">{children}</h2>;
}

export function WelcomeStep({ onFresh, onExisting }: { onFresh(): void; onExisting(): void }) {
  return (
    <>
      <h1 className="onboarding__title">Boas-vindas ao LIFE RPG</h1>
      <p>Tire as coisas da cabeça e avance um passo de cada vez. Sem culpa: um dia parado não apaga nada.</p>
      <div className="onboarding__actions onboarding__actions--stack">
        <Button variant="primary" size="lg" onClick={onFresh}>Começar do zero</Button>
        <Button onClick={onExisting}>Já uso em outro aparelho</Button>
      </div>
      <p className="onboarding__note">Funciona sem internet: tudo fica salvo neste aparelho.</p>
    </>
  );
}

const CODE_ERRORS: Partial<Record<TokenResult, string>> = {
  invalid: 'Código inválido',
  offline: 'Sem conexão com o servidor',
};

export function AccessCodeStep({ onConnect, onBack }: {
  onConnect(code: string): Promise<TokenResult>;
  onBack(): void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'connecting' | 'syncing' | undefined>();
  const [error, setError] = useState<string>();
  const submit = async () => {
    const token = code.trim();
    if (!token || busy) return;
    setError(undefined);
    setBusy('connecting');
    let result: TokenResult;
    try {
      result = await onConnect(token);
    } catch (e) {
      console.error('connect failed', e);
      result = 'offline';
    }
    if (result === 'ok') { setBusy('syncing'); return; }
    setBusy(undefined);
    setError(CODE_ERRORS[result]);
  };
  return (
    <form className="onboarding__form" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-busy={busy !== undefined}>
      <StepHeading>Conectar a outro aparelho</StepHeading>
      <p>Digite o código de acesso do servidor, o mesmo usado no outro aparelho. Seus dados vêm de lá.</p>
      <label className="field">
        <span className="field__label">Código de acesso</span>
        <input type="text" value={code} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          enterKeyHint="go" onChange={(e) => setCode(e.target.value)} />
      </label>
      <p className="onboarding__error" role="alert">{error}</p>
      {busy === 'syncing' && <p className="onboarding__status" role="status">Sincronizando…</p>}
      <div className="onboarding__actions">
        <Button type="submit" variant="primary" disabled={!code.trim() || busy !== undefined}>
          {busy === 'connecting' ? 'Conectando…' : 'Conectar'}
        </Button>
        <Button onClick={onBack} disabled={busy !== undefined}>Voltar</Button>
      </div>
    </form>
  );
}

export function LookStep({ initial, onNext, onSkip }: {
  initial: LookDraft;
  onNext(draft: LookDraft): Promise<void>;
  onSkip(): void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <form className="onboarding__form" onSubmit={(e) => { e.preventDefault(); void onNext(draft); }}>
      <StepHeading>Seu personagem</StepHeading>
      <p>Escolha um nome e uma aparência. Dá para mudar depois, em Personagem.</p>
      <LookFields value={draft} onChange={setDraft} nameLabel="Como devo te chamar?" />
      <div className="onboarding__actions">
        <Button type="submit" variant="primary">Continuar</Button>
        <Button variant="ghost" onClick={onSkip}>Pular</Button>
      </div>
    </form>
  );
}

export function MindStep({ onNext, onSkip }: { onNext(text: string): Promise<void>; onSkip(): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onNext(text); } finally { setBusy(false); }
  };
  return (
    <form className="onboarding__form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <StepHeading id={`${id}-q`}>O que está ocupando sua cabeça agora?</StepHeading>
      <p id={`${id}-hint`} className="onboarding__hint">Uma ideia por linha.</p>
      <textarea
        className="onboarding__mind"
        rows={5}
        value={text}
        aria-labelledby={`${id}-q ${id}-hint`}
        placeholder={'pagar a conta de luz\nligar para a Ana\narrumar a mesa'}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="onboarding__note">Cada linha vira uma missão. Tirar da cabeça já alivia.</p>
      <div className="onboarding__actions">
        <Button type="submit" variant="primary" disabled={!text.trim() || busy}>Continuar</Button>
        <Button variant="ghost" onClick={onSkip}>Pular</Button>
      </div>
    </form>
  );
}

export function PickStep({ missions, onPick, onSkip }: {
  missions: Mission[];
  onPick(id: string): Promise<void>;
  onSkip(): void;
}) {
  const [chosen, setChosen] = useState<string>();
  const id = useId();
  return (
    <form className="onboarding__form" onSubmit={(e) => { e.preventDefault(); if (chosen) void onPick(chosen); }}>
      {/* Pixelify's "5" reads like an "S": the digit uses the body font. */}
      <StepHeading id={`${id}-q`}>Qual delas dá para começar em <span className="onboarding__digit">5</span> minutos?</StepHeading>
      <p>Ela vira a primeira do seu plano de hoje.</p>
      <div className="onboarding__choices" role="radiogroup" aria-labelledby={`${id}-q`}>
        {missions.map((m) => (
          <label key={m.id} className="onboarding__choice">
            <input type="radio" name={`${id}-pick`} checked={chosen === m.id} onChange={() => setChosen(m.id)} />
            <span>{m.title}</span>
          </label>
        ))}
      </div>
      <div className="onboarding__actions">
        <Button type="submit" variant="primary" disabled={!chosen}>Continuar</Button>
        <Button variant="ghost" onClick={onSkip}>Pular</Button>
      </div>
    </form>
  );
}
