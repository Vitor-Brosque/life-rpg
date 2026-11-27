import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { DayKey, ReportOptions, ReportPeriod, ReportPeriodKind, ReportSection, ReportTheme } from '@life/shared';
import {
  CUSTOM_ISSUE_TEXT, REPORT_DEFAULTS, REPORT_DIARY_CHOICES, REPORT_DIARY_LABEL, REPORT_HEALTH_KEYS, REPORT_HEALTH_LABEL,
  REPORT_PERIOD_KINDS, REPORT_PERIOD_LABEL, REPORT_SECTIONS, REPORT_SECTION_TITLE, REPORT_THEMES, REPORT_THEME_LABEL, addDays,
  addMonths, customPeriodIssue, defaultReportWeek, diaryClock, diaryPreview, diaryWeekLabel, monthKeyOf, reportCustomPeriod,
  reportDiaryCandidates, reportFileName, reportMarkdown, reportMonthPeriod, reportMonthTitle, reportRange, reportSectionsOf,
  reportShortDay, reportWeekPeriod, weekOfDay,
} from '@life/shared';
import { canShareFiles, deliverExport } from '../../db/exportData';
import { useToday } from '../../db/hooks';
import { useReportData } from '../../db/reportData';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { FOCUS_PAGE } from '../../ui/focusAfter';
import { useToast } from '../../ui/Toast';
import '../plan/plan.css';
import './diary.css';

/** A copy of the defaults: toggling never touches the shared arrays and objects. */
const freshOptions = (): ReportOptions => ({
  ...REPORT_DEFAULTS, sections: [...REPORT_DEFAULTS.sections], chosen: [...REPORT_DEFAULTS.chosen], health: { ...REPORT_DEFAULTS.health },
});

/** `/diario/relatorios`: choices on top, the exact preview below, Compartilhar/Baixar at the end. Nothing here writes. */
export function ReportScreen() {
  const today = useToday();
  return (
    <section className="screen diary report stack" aria-labelledby="report-title">
      <Link href="/diario" className="settings__back">‹ Diário</Link>
      <h1 id="report-title" tabIndex={-1} data-focus-target={FOCUS_PAGE}>Relatórios</h1>
      <p className="muted">
        Monte um relatório para levar a uma conversa com uma IA. A prévia mostra exatamente o que vai sair; nada sai do app sem o
        seu toque.
      </p>
      {today && <ReportBuilder today={today} />}
    </section>
  );
}

function Switch({ label, checked, onToggle }: { label: string; checked: boolean; onToggle(): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={onToggle}>
      <span className="switch-row__track" aria-hidden="true"><span className="switch-row__thumb" /></span>
      <span>{label}</span>
    </button>
  );
}

function ReportBuilder({ today }: { today: DayKey }) {
  const [kind, setKind] = useState<ReportPeriodKind>('semana');
  const [monday, setMonday] = useState(() => defaultReportWeek(today));
  const [month, setMonth] = useState(() => monthKeyOf(today));
  const [from, setFrom] = useState(() => addDays(today, -6));
  const [to, setTo] = useState(today);
  const [options, setOptions] = useState<ReportOptions>(() => freshOptions());
  const issue = kind === 'personalizado' ? customPeriodIssue(from, to, today) : undefined;
  const period = useMemo((): ReportPeriod | undefined => {
    if (kind === 'semana') return reportWeekPeriod(monday);
    if (kind === 'mes') return reportMonthPeriod(month);
    return issue ? undefined : reportCustomPeriod(from, to);
  }, [kind, monday, month, from, to, issue]);
  const range = useMemo(() => (period ? reportRange(period, today) : undefined), [period, today]);
  const [attempt, setAttempt] = useState(0);
  const { data, failed } = useReportData(range, today, attempt);
  const text = useMemo(() => (data && period ? reportMarkdown({ data, period, options }) : undefined), [data, period, options]);
  const candidates = useMemo(
    () => (data && range ? reportDiaryCandidates(data.diaryEntries, range, options.includePrivate) : []),
    [data, range, options.includePrivate],
  );
  const sections = reportSectionsOf(options);
  const thisWeek = weekOfDay(today);
  const thisMonth = monthKeyOf(today);
  const share = canShareFiles();
  const set = (patch: Partial<ReportOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const chooseTheme = (theme: ReportTheme) => setOptions((o) => ({
    ...o, theme,
    // Personalizado starts from the sections of the theme that was chosen before.
    sections: theme === 'personalizado' && o.theme !== 'personalizado' ? reportSectionsOf(o) : o.sections,
  }));
  const toggleSection = (s: ReportSection) => setOptions((o) => ({
    ...o, sections: o.sections.includes(s) ? o.sections.filter((x) => x !== s) : [...o.sections, s],
  }));
  const toggleChosen = (id: string) => setOptions((o) => ({
    ...o, chosen: o.chosen.includes(id) ? o.chosen.filter((x) => x !== id) : [...o.chosen, id],
  }));

  // Straight from the tap: share() needs the tap's user activation. MIME text/plain: the share sheets accept it.
  const deliver = () => {
    if (text === undefined || !range) return;
    const file = new File([text], reportFileName(options.theme, range), { type: 'text/plain' });
    deliverExport(file, 'LIFE RPG — relatório').catch((e: unknown) => {
      console.error('report export failed', e);
      useToast.getState().show('Não foi possível exportar. Tente de novo.');
    });
  };

  return (
    <div className="stack">
      <fieldset className="report__group">
        <legend className="field__label">Período</legend>
        <div className="cluster">
          {REPORT_PERIOD_KINDS.map((k) => (
            <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>{REPORT_PERIOD_LABEL[k]}</Chip>
          ))}
        </div>
        {kind === 'semana' && (
          <div className="diary__week">
            <p className="diary__week-label">{diaryWeekLabel(monday)}</p>
            <div className="cluster">
              <Button size="sm" id="report-prev" onClick={() => setMonday(addDays(monday, -7))}>Semana anterior</Button>
              <Button size="sm" disabled={monday >= thisWeek} onClick={() => {
                // Reaching this week disables the button: keep the focus on a control that stays.
                if (addDays(monday, 7) >= thisWeek) document.getElementById('report-prev')?.focus();
                setMonday(addDays(monday, 7));
              }}>Próxima semana</Button>
            </div>
          </div>
        )}
        {kind === 'mes' && (
          <div className="diary__week">
            <p className="diary__week-label">{reportMonthTitle(month)}</p>
            <div className="cluster">
              <Button size="sm" id="report-prev" onClick={() => setMonth(addMonths(month, -1))}>Mês anterior</Button>
              <Button size="sm" disabled={month >= thisMonth} onClick={() => {
                if (addMonths(month, 1) >= thisMonth) document.getElementById('report-prev')?.focus();
                setMonth(addMonths(month, 1));
              }}>Próximo mês</Button>
            </div>
          </div>
        )}
        {kind === 'personalizado' && (
          <>
            <div className="cluster">
              <label className="field">
                <span className="field__label">De</span>
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span className="field__label">Até</span>
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <p className="muted" role="status">{issue ? CUSTOM_ISSUE_TEXT[issue] : ''}</p>
          </>
        )}
      </fieldset>

      <fieldset className="report__group">
        <legend className="field__label">Tema</legend>
        <div className="cluster">
          {REPORT_THEMES.map((t) => (
            <Chip key={t} selected={options.theme === t} onClick={() => chooseTheme(t)}>{REPORT_THEME_LABEL[t]}</Chip>
          ))}
        </div>
      </fieldset>

      {options.theme === 'personalizado' && (
        <fieldset className="report__group">
          <legend className="field__label">Seções</legend>
          <div className="cluster">
            {REPORT_SECTIONS.map((s) => (
              <Chip key={s} selected={options.sections.includes(s)} onClick={() => toggleSection(s)}>{REPORT_SECTION_TITLE[s]}</Chip>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="report__group">
        <legend className="field__label">Entradas do diário</legend>
        <div className="cluster">
          {REPORT_DIARY_CHOICES.map((c) => (
            <Chip key={c} selected={options.diary === c} onClick={() => set({ diary: c })}>{REPORT_DIARY_LABEL[c]}</Chip>
          ))}
        </div>
        <Switch label="Incluir entradas privadas" checked={options.includePrivate} onToggle={() => set({ includePrivate: !options.includePrivate })} />
        {options.diary === 'escolher' && data && (
          candidates.length === 0
            ? <p className="muted">Nenhuma entrada neste período.</p>
            : (
              <ul className="report__entries" aria-label="Entradas do período">
                {candidates.map((e) => (
                  <li key={e.id}>
                    <label className="report__entry">
                      <input type="checkbox" checked={options.chosen.includes(e.id)} onChange={() => toggleChosen(e.id)} />
                      <span>{`${reportShortDay(e.day)} · ${diaryClock(e.at)}${e.private ? ' · privada' : ''} — ${diaryPreview(e.text, 1, 80)}`}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )
        )}
      </fieldset>

      {sections.includes('saude') && (
        <fieldset className="report__group">
          <legend className="field__label">Dados de saúde</legend>
          {REPORT_HEALTH_KEYS.map((k) => (
            <Switch key={k} label={REPORT_HEALTH_LABEL[k]} checked={options.health[k]}
              onToggle={() => set({ health: { ...options.health, [k]: !options.health[k] } })} />
          ))}
        </fieldset>
      )}

      <div className="cluster">
        <p className="muted" role="status">{failed ? 'Não foi possível ler os registros agora. Tente de novo.' : ''}</p>
        {failed && <Button size="sm" onClick={() => {
          // The button disappears once the read restarts: keep the focus on the preview, which stays.
          document.getElementById('report-text')?.focus();
          setAttempt((n) => n + 1);
        }}>Tentar de novo</Button>}
      </div>
      <h2 id="report-preview" className="field__label">Prévia</h2>
      {range && text === undefined && !failed && <p className="muted">Carregando…</p>}
      <pre id="report-text" className="diary-export__preview report__preview" role="region" aria-labelledby="report-preview" tabIndex={0}>{text ?? ''}</pre>
      <div className="cluster">
        <Button variant="primary" disabled={text === undefined} onClick={deliver}>{share ? 'Compartilhar' : 'Baixar'}</Button>
      </div>
    </div>
  );
}
