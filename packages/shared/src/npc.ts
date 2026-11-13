import type { Area, Block, BlockSession, DayKey, DayMode, FocusSession, ID, Journey, Mission, XpEvent } from './types';
import { addDays, diffDays } from './dates';
import { STAGES, type NextStage, type NpcKind, type StageIndex, type WorldJourney } from './world';

// NPC lines (Marco 6, spec §5): short, rule-based, tied to real data, never guilt. Every NPC
// always has at least one line (the stage line), so the panel is never empty.

// ------------------------------------------------------------------ facts

export interface AreaFacts {
  weekXp: number;          // XP of the area this week (Monday → today, by dayKey)
  weekDays: number;        // distinct days with XP of the area this week
  openMissions: number;    // open/doing missions of the area available today
  doneThisWeek: number;    // missions of the area completed this week
  focusMin: number;        // focus minutes this week (sessions with this areaId), floored
  blocksStarted: number;   // block sessions started this week, block (or its journey) in this area
  nextDeadline?: { title: string; day: DayKey };  // nearest deadline from today to today + 7
  last?: { label: string; missionTitle?: string; day: DayKey };  // newest XP of the area, any time
}

export interface WorldFacts {
  today: DayKey;
  mode: DayMode;
  reasonDays: Record<string, number>;  // per XP reason: distinct days this week (all areas)
  study?: { due: number; fresh: number; minutes: number; goalMet: boolean; restDay: boolean; cards: number };
  sketchesThisWeek: number;            // live lousas with updatedAt this week
  checkinsThisWeek: number;            // live check-ins of kind 'start' this week
  workouts?: { total: number; cardio: number };          // Marco 4 table, this week
  freezer?: { portions: number; everPrepped: boolean };  // Marco 4 table
  sleepNights?: number;                                  // Marco 4 table: complete nights of the last 7
}

export interface AreaFactsInput {
  today: DayKey;
  weekStart: DayKey;       // Monday (weekKey)
  weekStartTs: number;     // start of the Monday's logical day
  areaIds: readonly ID[];
  xp: readonly XpEvent[];
  missions: readonly Mission[];
  journeys: readonly Pick<Journey, 'id' | 'areaId'>[];
  focus: readonly FocusSession[];
  blocks: readonly Block[];
  sessions: readonly BlockSession[];
  reasonLabel(reason: string): string;
}

const emptyFacts = (): AreaFacts => ({ weekXp: 0, weekDays: 0, openMissions: 0, doneThisWeek: 0, focusMin: 0, blocksStarted: 0 });

export function buildAreaFacts(input: AreaFactsInput): Record<ID, AreaFacts> {
  const { today, weekStart, weekStartTs } = input;
  const inWeek = (d: DayKey): boolean => d >= weekStart && d <= today;
  const journeyArea = new Map(input.journeys.map((j) => [j.id, j.areaId]));
  const missionTitle = new Map(input.missions.map((m) => [m.id, m.title]));
  const missionArea = (m: Mission): ID | undefined => m.areaId ?? (m.journeyId ? journeyArea.get(m.journeyId) : undefined);
  const blockArea = new Map(input.blocks.map((b) => [b.id, b.areaId ?? (b.journeyId ? journeyArea.get(b.journeyId) : undefined)]));
  const out: Record<ID, AreaFacts> = {};
  for (const id of input.areaIds) out[id] = emptyFacts();

  const days = new Map<ID, Set<DayKey>>();
  const newest = new Map<ID, XpEvent>();
  for (const x of input.xp) {
    if (x.deleted || !x.areaId) continue;
    const f = out[x.areaId];
    if (!f) continue;
    if (inWeek(x.dayKey)) {
      f.weekXp += x.amount;
      const set = days.get(x.areaId) ?? new Set<DayKey>();
      set.add(x.dayKey);
      days.set(x.areaId, set);
    }
    const prev = newest.get(x.areaId);
    if (!prev || x.at > prev.at) newest.set(x.areaId, x);
  }
  for (const [id, set] of days) out[id]!.weekDays = set.size;
  for (const [id, x] of newest) {
    const title = x.missionId ? missionTitle.get(x.missionId) : undefined;
    out[id]!.last = { label: input.reasonLabel(x.reason), ...(title ? { missionTitle: title } : {}), day: x.dayKey };
  }

  const horizon = addDays(today, 7);
  for (const m of input.missions) {
    if (m.deleted) continue;
    const area = missionArea(m);
    const f = area ? out[area] : undefined;
    if (!f) continue;
    if (m.status === 'open' || m.status === 'doing') {
      if ((m.date && m.date > today) || (m.notBefore && m.notBefore > today)) continue;
      f.openMissions += 1;
      if (m.deadline && m.deadline >= today && m.deadline <= horizon) {
        const cur = f.nextDeadline;
        if (!cur || m.deadline < cur.day || (m.deadline === cur.day && m.title < cur.title)) {
          f.nextDeadline = { title: m.title, day: m.deadline };
        }
      }
    } else if (m.status === 'done' && m.completedAt !== undefined && m.completedAt >= weekStartTs) {
      f.doneThisWeek += 1;
    }
  }

  for (const s of input.focus) {
    if (s.deleted || !s.areaId || s.startedAt < weekStartTs) continue;
    const f = out[s.areaId];
    if (f) f.focusMin += s.activeMs / 60_000;
  }
  for (const f of Object.values(out)) f.focusMin = Math.floor(f.focusMin);

  for (const s of input.sessions) {
    if (s.deleted || s.startedAt === undefined || !inWeek(s.day)) continue;
    const area = blockArea.get(s.blockId);
    const f = area ? out[area] : undefined;
    if (f) f.blocksStarted += 1;
  }
  return out;
}

/** Distinct days this week with live XP of each reason (robust to several awards per action). */
export function reasonDaysThisWeek(xp: readonly XpEvent[], weekStart: DayKey, today: DayKey): Record<string, number> {
  const sets = new Map<string, Set<DayKey>>();
  for (const x of xp) {
    if (x.deleted || x.dayKey < weekStart || x.dayKey > today) continue;
    const reason: string = x.reason;
    const set = sets.get(reason) ?? new Set<DayKey>();
    set.add(x.dayKey);
    sets.set(reason, set);
  }
  const out: Record<string, number> = {};
  for (const [reason, set] of sets) out[reason] = set.size;
  return out;
}

// Rows of Marco 4 tables arrive untyped (read by table name): only the fields used are checked.
const rec = (r: unknown): Record<string, unknown> | undefined =>
  (r && typeof r === 'object' ? (r as Record<string, unknown>) : undefined);

/** Marco 4 `workouts`: live rows of this week (`day` in Monday → today); cardio = kind 'cardio'. */
export function workoutFacts(rows: readonly unknown[], weekStart: DayKey, today: DayKey): { total: number; cardio: number } {
  let total = 0;
  let cardio = 0;
  for (const raw of rows) {
    const r = rec(raw);
    if (!r || r.deleted === true || typeof r.day !== 'string' || r.day < weekStart || r.day > today) continue;
    total += 1;
    if (r.kind === 'cardio') cardio += 1;
  }
  return { total, cardio };
}

/** Marco 4 `freezerMoves`: portions = sum over dishes of their live deltas (a dish never below 0, as in the Casa tab); any live 'prep' move. */
export function freezerFacts(rows: readonly unknown[]): { portions: number; everPrepped: boolean } {
  const perDish = new Map<string, number>();
  let everPrepped = false;
  for (const raw of rows) {
    const r = rec(raw);
    if (!r || r.deleted === true || typeof r.delta !== 'number' || !Number.isFinite(r.delta)) continue;
    const id = typeof r.recipeId === 'string' ? r.recipeId : '';
    perDish.set(id, (perDish.get(id) ?? 0) + r.delta);
    if (r.kind === 'prep') everPrepped = true;
  }
  let sum = 0;
  for (const n of perDish.values()) sum += Math.max(0, n);
  return { portions: Math.round(sum), everPrepped };
}

/** Marco 4 `sleepLogs`: complete nights (bed and wake, wake after bed, at most 16 h) of the 7 nights before today. */
export function sleepFacts(rows: readonly unknown[], today: DayKey): number {
  const from = addDays(today, -7);
  let n = 0;
  for (const raw of rows) {
    const r = rec(raw);
    if (!r || r.deleted === true || typeof r.night !== 'string' || r.night < from || r.night >= today) continue;
    if (typeof r.bedAt === 'number' && typeof r.wakeAt === 'number' && r.wakeAt > r.bedAt && r.wakeAt - r.bedAt <= 16 * 3_600_000) n += 1;
  }
  return n;
}

// ------------------------------------------------------------------ lines

export interface NpcLine { id: string; text: string; now: boolean }

export interface NpcCtx {
  kind: NpcKind;
  area: Pick<Area, 'name' | 'attribute'>;
  stage: StageIndex;
  next?: NextStage;
  journey?: WorldJourney;  // the territory's first active journey
  facts: AreaFacts;
  world: WorldFacts;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** 20 → "20 min", 60 → "1h", 90 → "1h30" (same format as the web's formatDuration). */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}

const whenAhead = (day: DayKey, today: DayKey): string => {
  const d = diffDays(today, day);
  return d <= 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d} dias`;
};

const whenAgo = (day: DayKey, today: DayKey): string => {
  const d = diffDays(day, today);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
};

function kindLines(c: NpcCtx, add: (id: string, text: string, now?: boolean) => void): void {
  const { world: w, facts: f } = c;
  const free = w.mode === 'free';
  const light = w.mode === 'low' || w.mode === 'recovery';
  switch (c.kind) {
    case 'treinadora': {
      if (free) add('t-free', 'Dia livre. O corpo também se fortalece no descanso.', true);
      if (light) add('t-light', 'Dia de pouca energia? A versão mínima do treino conta inteira.', true);
      const wk = w.workouts;
      if (wk && wk.total > 0) {
        add('t-week', `${plural(wk.total, 'treino registrado', 'treinos registrados')} nesta semana${wk.cardio > 0 ? `, ${wk.cardio} de cardio` : ''}. Cada registro reforça este campo.`);
        if (wk.cardio === 0 && !free) add('t-cardio', 'Se o cardio pesar, a versão mínima são 10 minutos em ritmo de conversa.');
      } else if (wk && !free) {
        add('t-start', 'Semana aberta no campo de treino. Um treino registrado, de qualquer tamanho, já conta.');
      }
      break;
    }
    case 'herbalista': {
      if (free) add('h-free', 'Dia livre. Descansar de propósito também é cuidar de você.', true);
      if (light) add('h-light', 'Hoje o dia é mais leve. O essencial já basta.', true);
      if (w.sleepNights !== undefined && w.sleepNights > 0) {
        add('h-sleep', `${plural(w.sleepNights, 'noite registrada', 'noites registradas')} nos últimos 7 dias. Olhar os horários com calma ajuda a ajustar a rotina.`);
      } else if (w.sleepNights === 0) {
        add('h-sleep-start', 'Se quiser acompanhar o sono, “Deitei” e “Acordei” no Agora são dois toques.');
      }
      if (w.checkinsThisWeek > 0) {
        add('h-checkin', `Você parou para nomear o que sentia ${plural(w.checkinsThisWeek, 'vez', 'vezes')} nesta semana. Perceber já é um passo.`);
      }
      break;
    }
    case 'escriba': {
      const s = w.study;
      if (free) add('e-free', 'Dia livre. Os estudos esperam, sem pressa.', true);
      if (s && !s.restDay && !free && !s.goalMet && s.due + s.fresh > 0) {
        const parts = [
          ...(s.due > 0 ? [plural(s.due, 'revisão', 'revisões')] : []),
          ...(s.fresh > 0 ? [plural(s.fresh, 'card novo', 'cards novos')] : []),
        ];
        add('e-due', `Hoje há ${parts.join(' e ')} esperando, uns ${Math.max(1, Math.round(s.minutes))} min. Lembrar com esforço é o que fixa.`, true);
      }
      if (s && s.goalMet) add('e-done', 'Revisão de hoje feita. O resto volta na hora certa.');
      else if (s && s.restDay && !free && s.cards > 0) add('e-rest', 'Dia sem revisão. Os cards esperam sem pressa.');
      if (w.sketchesThisWeek > 0) {
        add('e-sketch', `${plural(w.sketchesThisWeek, 'lousa mexida', 'lousas mexidas')} nesta semana. Pensar desenhando também é estudar.`);
      }
      const practice = w.reasonDays.practice ?? 0;
      if (practice > 0) {
        add('e-practice', `Você praticou em ${plural(practice, 'dia', 'dias')} nesta semana. Reconstruir sem consulta é onde a autonomia aparece.`);
      }
      if (s && s.cards === 0) add('e-first', 'Quando quiser guardar algo para lembrar, uma linha com “? ” na captura vira rascunho de card.');
      break;
    }
    case 'ferreira': {
      if (free) add('f-free', 'Dia livre. A forja esfria um pouco e reacende rápido.', true);
      if (f.focusMin >= 10) add('f-focus', `${formatMinutes(f.focusMin)} de foco na forja nesta semana.`);
      if (f.blocksStarted > 0) {
        add('f-blocks', `${plural(f.blocksStarted, 'bloco começado', 'blocos começados')} aqui nesta semana. Começar é a parte difícil, e ela já foi.`);
      }
      break;
    }
    case 'intendente': {
      const fz = w.freezer;
      if (free) add('i-free', 'Dia livre. A despensa também descansa hoje.', true);
      if (fz && fz.everPrepped && fz.portions > 0 && fz.portions < 3) {
        const head = fz.portions === 1 ? 'Resta 1 marmita no freezer.' : `Restam ${fz.portions} marmitas no freezer.`;
        add('i-low', `${head} Se fizer sentido, o preparo em lote pode entrar na semana.`, !free); // no nudge on free days
      } else if (fz && fz.everPrepped && fz.portions === 0) {
        add('i-empty', 'O freezer está vazio por enquanto. A aba Casa ajuda a planejar o próximo preparo.');
      } else if (fz && fz.portions >= 3) {
        add('i-stock', `${fz.portions} marmitas no freezer. Comida pronta é uma decisão a menos.`);
      } else if (fz && !fz.everPrepped) {
        add('i-first', 'Quando quiser, a aba Casa guarda a conta das marmitas do freezer.');
      }
      if ((w.reasonDays.mealprep ?? 0) > 0) add('i-prep', 'Preparo em lote feito nesta semana. A despensa agradece.');
      break;
    }
    case 'bardo': {
      if (free) add('b-free', 'Dia livre é bom para estar com quem importa. Sem pressa.', true);
      if (f.doneThisWeek > 0) add('b-done', `Você cuidou de ${plural(f.doneThisWeek, 'laço', 'laços')} nesta semana. Isso já dá uma canção.`);
      if (f.openMissions > 0) {
        const head = f.openMissions === 1 ? '1 missão com pessoas está guardada.' : `${f.openMissions} missões com pessoas estão guardadas.`;
        add('b-open', `${head} Laços não têm pressa: quando fizer sentido, uma mensagem curta já aproxima.`);
      } else if (f.doneThisWeek === 0) {
        add('b-quiet', 'Por aqui, tudo calmo. Se alguém vier à mente, dá para guardar como missão.');
      }
      break;
    }
    case 'mestra': {
      if (free) add('m-free', 'Dia livre. A academia fecha as portas hoje, sem pendência.', true);
      if (f.blocksStarted > 0) {
        add('m-blocks', `${plural(f.blocksStarted, 'bloco começado', 'blocos começados')} em ${c.area.name} nesta semana. Esse tempo protegido foi escolha sua.`);
      }
      break;
    }
    case 'andarilha': {
      if (free) add('v-free', 'Dia livre. A estrada espera, sem pressa.', true);
      break;
    }
  }
}

function stageLine(c: NpcCtx): string {
  if (c.stage === 0) return `Por enquanto, ruínas. Qualquer ação de ${c.area.attribute} levanta a primeira tenda.`;
  if (!c.next) return 'Um castelo de pé. Ele fica, mesmo nos dias parados.';
  return `Mais ${c.next.xpLeft} XP e isto aqui vira ${STAGES[c.next.stage]!.a}.`;
}

function sharedLines(c: NpcCtx, add: (id: string, text: string, now?: boolean) => void): void {
  const { world: w, facts: f } = c;
  const free = w.mode === 'free';
  if (f.nextDeadline) {
    const near = diffDays(w.today, f.nextDeadline.day) <= 1;
    add('deadline', `Próxima entrega: “${f.nextDeadline.title}”, ${whenAhead(f.nextDeadline.day, w.today)}.`, near && !free);
  }
  const j = c.journey;
  if (j) {
    if (j.total === 0) add('journey', `A jornada “${j.title}” ainda não tem missões. Um primeiro passo pequeno já abre a estrada.`);
    else if (j.done >= j.total) add('journey', `Todas as missões de “${j.title}” feitas. Quando quiser, é só concluir a jornada.`);
    else add('journey', `A jornada “${j.title}” está em ${j.done} de ${j.total}.${j.nextTitle ? ` Próximo passo: ${j.nextTitle}.` : ''}`);
  }
  if (f.openMissions > 0 && c.kind !== 'bardo' && !free) {
    add('open', `${plural(f.openMissions, 'missão', 'missões')} de ${c.area.name} em aberto. Escolha a menor, se quiser começar.`);
  }
  if (f.weekXp > 0) add('week', `Nesta semana, ${c.area.attribute} ganhou ${f.weekXp} XP em ${plural(f.weekDays, 'dia', 'dias')}.`);
  if (f.last) {
    add('last', `Última marca aqui: ${f.last.label}${f.last.missionTitle ? ` (“${f.last.missionTitle}”)` : ''}, ${whenAgo(f.last.day, w.today)}.`);
  }
  add('stage', stageLine(c));
}

/** Every line that applies, kind-specific first, then the shared ones; the stage line is always last. */
export function npcLines(c: NpcCtx): NpcLine[] {
  const out: NpcLine[] = [];
  const add = (id: string, text: string, now = false): void => { out.push({ id, text, now }); };
  kindLines(c, add);
  sharedLines(c, add);
  return out;
}

/**
 * Which line the panel opens on: the first time-sensitive ("now") line when there is one; otherwise
 * it rotates by day (and by territory, so neighbours differ). "Outra fala" moves on from here.
 */
export function npcStartIndex(lines: readonly NpcLine[], today: DayKey, salt: number): number {
  if (lines.length === 0) return 0;
  const now = lines.findIndex((l) => l.now);
  if (now >= 0) return now;
  const day = diffDays('2026-01-01', today);
  return (((day + salt) % lines.length) + lines.length) % lines.length;
}
