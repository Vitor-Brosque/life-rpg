export type ID = string;
/** Local calendar day, 'YYYY-MM-DD' */
export type DayKey = string;
/** Local time of day, 'HH:mm' */
export type HHmm = string;

export interface BaseRecord {
  id: ID;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export type MissionStatus = 'open' | 'doing' | 'done' | 'dropped';
export type Energy = 'light' | 'medium' | 'heavy';
export type EnergyLevel = 'low' | 'medium' | 'high';

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] } // 0 = Sunday
  | { kind: 'monthly'; day: number }       // 1..31, clamped to month length
  | { kind: 'afterDays'; days: number };

export interface ChecklistItem { id: ID; text: string; done: boolean }

export interface Mission extends BaseRecord {
  title: string;
  firstStep?: string;
  notes?: string;
  checklist: ChecklistItem[];
  status: MissionStatus;
  durationMin?: number;
  energy?: Energy;
  areaId?: ID;
  journeyId?: ID;
  journeyOrder?: number;
  date?: DayKey;          // planned day (soft)
  dayOrder?: number;      // manual order inside the day list
  deadline?: DayKey;      // hard deadline
  notBefore?: DayKey;
  snoozedUntil?: number;  // epoch ms
  important: boolean;
  shrunk: boolean;
  postponeCount: number;
  recurrence?: Recurrence;
  startedAt?: number;
  completedAt?: number;
  dropReason?: string;
  blockId?: ID;           // explicit block assignment (wins over area/journey link)
}

export type JourneyStatus = 'active' | 'done' | 'archived';
export interface Journey extends BaseRecord {
  title: string;
  outcome?: string;
  areaId?: ID;
  status: JourneyStatus;
  order: number;
}

export interface Commitment extends BaseRecord {
  title: string;
  date: DayKey;          // first (or only) occurrence
  start: HHmm;
  end: HHmm;
  weekdays?: number[];   // weekly recurrence, 0 = Sunday
  untilDate?: DayKey;
  remind: boolean;
}

export interface Area extends BaseRecord {
  name: string;       // e.g. 'Corpo'
  attribute: string;  // e.g. 'Vigor'
  color: string;      // CSS color
  icon: string;       // icon key from art/icons.tsx
  order: number;
  archived: boolean;
}

export type TimerMode = 'free' | 'pomodoro' | 'countdown';
export interface FocusSession extends BaseRecord {
  startedAt: number;
  endedAt: number;
  activeMs: number;
  mode: TimerMode;
  missionId?: ID;
  areaId?: ID;
  outcome: 'finished' | 'interrupted';
  interruptReason?: string;
  notes?: string;
}

export interface EnergyLog extends BaseRecord { at: number; level: EnergyLevel }

export type EventType =
  | 'created' | 'started' | 'completed' | 'uncompleted' | 'skipped' | 'shrunk'
  | 'snoozed' | 'dropped' | 'rescheduled' | 'split' | 'focus' | 'review' | 'hardDay';
export interface LifeEvent extends BaseRecord {
  at: number;
  type: EventType;
  missionId?: ID;
  data?: Record<string, unknown>;
}

export type XpReason = 'complete' | 'start' | 'strategy' | 'focus' | 'review' | 'journey' | 'resilience'
  | 'block' | 'resumption' | 'checkin' | 'objective' | 'study' | 'practice'
  | 'sleep' | 'mealprep' | 'workout';
export interface XpEvent extends BaseRecord {
  at: number;
  amount: number;
  areaId?: ID;
  reason: XpReason;
  missionId?: ID;
  dayKey: DayKey;
}

export interface CharacterLook { skin: number; hair: number; hairColor: number; outfit: number }
export interface Profile extends BaseRecord {   // id = 'me'
  name: string;
  look: CharacterLook;
  companionName: string;
  onboarded: boolean;
}
export interface Settings extends BaseRecord {  // id = 'settings'
  dayStartHour: number;
  dayEndHour: number;
  pomodoro: { focusMin: number; breakMin: number };
  companionMuted: boolean;
  commitmentReminderMin: number; // 0 = off
  checkinCard?: boolean;         // absent = true
  study?: StudySettings;           // Marco 3; absent = DEFAULT_STUDY (see studySettingsOf)
  sleep?: SleepSettings;           // Marco 4; absent = DEFAULT_SLEEP (see sleepSettingsOf)
  patterns?: PatternSettings;      // Marco 5; absent = { watchDismissed: [] } (see patternSettingsOf)
  ai?: AiSettings;                 // Marco 7; absent = every AI aid off (see aiSettingsOf)
}
export interface DayState extends BaseRecord {  // id = DayKey
  hardDay: boolean;
  reviewDone: boolean;
  mode?: DayMode;
  startedAt?: number;   // when the day actually started
}

export type DayMode = 'normal' | 'low' | 'recovery' | 'free';
export type BlockKind = 'focus' | 'body' | 'study' | 'light' | 'routine';

export interface Block extends BaseRecord {
  name: string;
  weekdays: number[];          // 0 = Sunday
  order: number;
  targetStart: HHmm;
  durationMin: number;         // normal duration (minutes)
  minimumMin: number;          // minimum version (minutes), <= durationMin
  areaId?: ID;
  journeyId?: ID;
  kind: BlockKind;
  protected: boolean;
  checklist: ChecklistItem[];  // used by 'routine' blocks
  archived: boolean;
  reviews?: boolean;               // "Revisão espaçada neste bloco"; absent → kind === 'light'
}
export interface BlockSession extends BaseRecord {  // id = `bs-${blockId}-${day}`
  blockId: ID;
  day: DayKey;
  startedAt?: number;
  endedAt?: number;
  version: 'normal' | 'minimum';
  nextAction?: string;
  skipped?: boolean;           // "Pular hoje": ended (endedAt) without being started
}
export interface WeekObjective { id: ID; blockId: ID; text: string; done: boolean }
export interface WeekReview { worked: string; obstacle: string; adjustment: string; answeredAt: number }
export interface Week extends BaseRecord {           // id = Monday DayKey
  objectives: WeekObjective[];
  review?: WeekReview;
  experiment?: string;
}
export interface Checkin extends BaseRecord {
  at: number;
  kind: 'start' | 'escape';
  feelings: string[];
  thought?: string;
  experimentMin?: number;
  outcome?: 'continued' | 'stopped';
  escapedTo?: string;
  missionId?: ID;
  blockId?: ID;
}

// ------------------------------------------------------------------ study (Marco 3)

export type NoteType = 'basic' | 'reversible' | 'cloze' | 'code' | 'topic';
export type CodeLang = 'python' | 'sql' | 'javascript' | 'bash' | 'text';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';
/** 1 Errei · 2 Difícil · 3 Bom · 4 Fácil. */
export type Rating = 1 | 2 | 3 | 4;

export interface Deck extends BaseRecord {
  name: string;
  journeyId?: ID;
  areaId?: ID;          // absent → the journey's area → 'area-intelecto'
  order: number;
  archived: boolean;
  speechLang?: string;  // "Ouvir" (text to speech), BCP 47 tag such as 'en-US'; absent = no button
}

export interface Note extends BaseRecord {
  deckId?: ID;          // absent only on inbox drafts
  type: NoteType;
  front: string;        // Markdown · cloze: text with {{N::…}} · code: the prompt
  back: string;         // Markdown · cloze: '' · code: reference solution (plain code) · topic: key points, one per line
  extra?: string;       // "Por quê?": the explanation / intuition, shown after reveal
  language?: CodeLang;  // code notes
  draft: boolean;       // drafts have no cards
}

export interface CardSchedule {
  state: CardState;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  scheduledDays: number;
  lastReview?: number;
}

export interface Card extends BaseRecord, CardSchedule {  // id = `${noteId}-${ord}`
  noteId: ID;
  deckId?: ID;          // copy of note.deckId (indexed)
  ord: number;          // basic/code/topic 0 · reversible 0 front→back, 1 back→front · cloze: group N
  topic?: boolean;      // copy of note.type === 'topic': own time cost, no short steps
  suspended: boolean;
  introducedDay?: DayKey;
}

export interface Review extends BaseRecord {  // append-only: created or soft-deleted, never edited
  cardId: ID;
  noteId: ID;
  deckId?: ID;
  at: number;
  day: DayKey;
  rating: Rating;
  durationMs: number;   // capped at 5 min
  wrote: boolean;
  coverage?: { covered: number; total: number };  // topic cards: key points ticked
  drew?: boolean;       // "Desenhar antes": at least one stroke when the answer was revealed (only when true)
  spoke?: boolean;      // "Responder falando": a recording existed when the answer was revealed (only when true)
  before: CardSchedule;
  after: CardSchedule;
}

export interface StudySettings {
  budgetMin: number;
  maxNewPerDay: number;
  retention: number;
  restDays: number[];   // 0 = Sunday; at least one study day remains
}

export const DEFAULT_STUDY: StudySettings = { budgetMin: 15, maxNewPerDay: 10, retention: 0.9, restDays: [0, 6] };

/** `settings.study` with every missing field taken from DEFAULT_STUDY. */
export function studySettingsOf(s?: { study?: Partial<StudySettings> }): StudySettings {
  return { ...DEFAULT_STUDY, ...(s?.study ?? {}) };
}

// ------------------------------------------------------------------ lousa (Marco 3b)

/** 0 Branco · 1 Azul · 2 Verde · 3 Amarelo (theme colours, resolved when drawing). */
export type InkColor = 0 | 1 | 2 | 3;
/** 0 thin (2) · 1 thick (6), in world units. */
export type InkWidth = 0 | 1;

/** One pen stroke. Short keys: a lousa may hold thousands of them. */
export interface Stroke {
  c: InkColor;
  w: InkWidth;
  p: number[];          // [x0, y0, x1, y1, …] world units (1 = 1 CSS px at zoom 1), 0.1 precision, ≥ 1 point
}

export interface Sketch extends BaseRecord {  // a mission's lousa has id `sketch-m-${missionId}`
  title: string;        // '' → automatic name (sketchTitle)
  missionId?: ID;
  practiceId?: ID;      // a practice session's lousa; then id = `sketch-p-${practiceId}`
  strokes: Stroke[];
}

// ------------------------------------------------------------------ prática técnica (Marco 3d)

export type PracticeStatus = 'open' | 'done';
export type PracticeStep = 'problem' | 'basics' | 'plan' | 'design' | 'code' | 'test' | 'feedback' | 'rebuild' | 'close';
/** Self-rating 0–2. Entregue: 0 não · 1 parcial · 2 sim. */
export type PracticeScore = 0 | 1 | 2;
export type FeedbackSource = 'person' | 'ai' | 'tool';

export interface PracticeError {
  id: ID;
  at: number;
  what: string;         // o que deu errado (required)
  why: string;          // por quê
  fix: string;          // a ideia correta
  noteId?: ID;          // the card draft made from this entry
}

export interface PracticeFeedback {
  id: ID;
  at: number;
  source: FeedbackSource;  // Marco 7 may write 'ai' entries made by the app
  text: string;
  hint?: { step: PracticeStep; level: HintLevel };   // Marco 7: a hint asked in the app (source 'ai' only)
}

export interface PracticeRebuild {
  code: string;
  startedAt: number;
  comparedAt?: number;  // read-only from then on
  peeked?: boolean;     // "Mostrar mesmo assim" before comparing (only when true)
}

export interface PracticeRatings {
  delivered?: PracticeScore;
  understood?: PracticeScore;
  autonomous?: PracticeScore;
}

export interface PracticeSession extends BaseRecord {
  title: string;               // ≤ 80, required
  status: PracticeStatus;
  step: PracticeStep;          // where the session reopens
  journeyId?: ID;
  missionId?: ID;
  deckId?: ID;                 // where error drafts go; absent → inbox
  problem: string;
  inputs: string;
  outputs: string;
  basics: ChecklistItem[];     // concepts (done unused)
  plan: ChecklistItem[];       // decomposition steps, ticked while implementing
  alternatives: string;
  decision: string;
  language: CodeLang;
  code: string;
  tests: ChecklistItem[];      // done = passed
  feedback: PracticeFeedback[];
  rebuild?: PracticeRebuild;
  errors: PracticeError[];
  ratings: PracticeRatings;
  explanation: string;         // "Explique em 2 frases"
  nextAction?: string;         // open: where to resume · done: first action of the next session
  endedAt?: number;
}

// ------------------------------------------------------------------ corpo e casa (Marco 4)

/** One night, from noon to noon: `night` is the date of the evening it starts on (sleepNightOf). */
export interface SleepLog extends BaseRecord {  // id = `sleep-${night}`
  night: DayKey;
  bedAt?: number;       // "Deitei"
  wakeAt?: number;      // "Acordei"
}

export interface SleepSettings {
  agoraPrompt: boolean;       // "Deitei" / "Acordei" in the Agora (default true)
  windDownReminder: boolean;  // push at windDownAt, Monday to Friday (default false)
  windDownAt: HHmm;           // default '22:45', the Desaceleração block of the suggested routine
  noteDismissed: boolean;     // the one-time note about symptoms was dismissed
}

export const DEFAULT_SLEEP: SleepSettings = {
  agoraPrompt: true, windDownReminder: false, windDownAt: '22:45', noteDismissed: false,
};

/** `settings.sleep` with every missing field taken from DEFAULT_SLEEP. */
export function sleepSettingsOf(s?: { sleep?: Partial<SleepSettings> }): SleepSettings {
  return { ...DEFAULT_SLEEP, ...(s?.sleep ?? {}) };
}

export type MealKind = 'almoco' | 'jantar';

export interface Recipe extends BaseRecord {
  name: string;
  ingredients: string[];  // one line each, as typed ("frango 1 kg"); merged by ingredientKey
}

export interface MenuSlot { day: DayKey; meal: MealKind; recipeId: ID }

export interface Menu extends BaseRecord {          // id = `menu-${monday}`
  week: DayKey;                                     // Monday
  slots: MenuSlot[];                                // at most one per (day, meal), sorted
}

export interface ShoppingItem { id: ID; text: string }

export interface ShoppingList extends BaseRecord {  // id = `shop-${monday}`
  week: DayKey;
  manual: ShoppingItem[];
  checked: string[];    // row keys: `g:${ingredientKey}` (from the menu) or `m:${item.id}` (manual)
}

export type FreezerMoveKind = 'prep' | 'eat' | 'fix';

export interface FreezerMove extends BaseRecord {   // append-only: created or soft-deleted, never edited
  at: number;
  day: DayKey;          // logical day
  recipeId: ID;
  delta: number;        // portions in (+) or out (−)
  kind: FreezerMoveKind;
  meal?: MealKind;      // 'eat' from the Agora's meal line
}

export type WorkoutKind = 'musculacao' | 'cardio' | 'outro';

export interface Workout extends BaseRecord {       // append-only: created or soft-deleted, never edited
  at: number;
  day: DayKey;          // logical day
  kind: WorkoutKind;
  minutes: number;      // 1–300
  minimum?: boolean;    // "versão mínima do cardio" (only when true)
  blockId?: ID;         // logged from the body block's banner
}

// ------------------------------------------------------------------ padrões (Marco 5)

/** Numbers of the month, copied when its reflection is first saved (what was on screen). */
export interface MonthObserved {
  workdays: number;          // non-free days of the month
  activeWorkdays: number;    // of those, with some XP
  blocksPlanned: number;
  blocksStarted: number;
  minimumUsed: number;
  resumptions: number;
  reviews: number;
  accuracy?: number;         // 0–1, only with ≥ 20 reviews of learned cards
  practiceClosed: number;    // practice sessions closed (Marco 3d)
  workouts: number;          // Marco 4
  sleepAvgMin?: number;      // only with ≥ 3 complete nights (Marco 4)
  escapes: number;
}

export interface MonthAnswers {
  progress: string;          // "O que mostra que você avançou neste mês?"
  obstacle: string;          // "O que mais atrapalhou, e em que momentos?"
  next: string;              // "Que mudança pequena você quer levar para o próximo mês?"
}

export interface MonthReview extends BaseRecord {  // id = `month-${YYYY-MM}`
  month: string;             // 'YYYY-MM', the month reflected upon
  answers?: MonthAnswers;    // absent when skipped
  skipped?: boolean;         // "Pular este mês" (only when true)
  observed: MonthObserved;
  answeredAt: number;        // first save
}

export interface PatternSettings {
  watchDismissed: string[];  // dismissed weeks 5–8 notices (WatchNotice.key)
}

/** `settings.patterns` with defaults: a missing or broken list is empty. */
export function patternSettingsOf(s?: { patterns?: Partial<PatternSettings> }): PatternSettings {
  const list: unknown = s?.patterns?.watchDismissed;
  return { watchDismissed: Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [] };
}

// ------------------------------------------------------------------ inteligência opcional (Marco 7)

/** Pista graduada: 1 pergunta · 2 direção · 3 próximo passo. */
export type HintLevel = 1 | 2 | 3;
/** Ajudas de IA ligadas em Ajustes; ausente = tudo desligado (aiSettingsOf). */
export interface AiSettings { hints: boolean; cards: boolean; weekly: boolean }

export const SYNC_TABLES = [
  'missions', 'journeys', 'commitments', 'areas', 'focusSessions', 'energyLogs',
  'events', 'xpEvents', 'profile', 'settings', 'dayState',
  'blocks', 'blockSessions', 'weeks', 'checkins',
  'decks', 'notes', 'cards', 'reviews',
  'sketches',
  'practiceSessions',
  'sleepLogs', 'recipes', 'menus', 'shoppingLists', 'freezerMoves', 'workouts',
  'monthReviews',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export const APPEND_ONLY_TABLES: readonly SyncTable[] = ['events', 'xpEvents', 'reviews', 'freezerMoves', 'workouts'];

export interface SyncChange { table: SyncTable; record: BaseRecord & Record<string, unknown> }
export interface SyncRequest { deviceId: string; cursor: number; changes: SyncChange[] }
export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  /** The server is behind the device's cursor (restored backup): restart from 0 and resend everything. */
  reset?: boolean;
}
