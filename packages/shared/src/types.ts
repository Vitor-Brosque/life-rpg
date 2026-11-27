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
  cueBlockId?: ID;        // "Quando?" of an if-then plan: the block where this mission starts (research P5)
  recurrence?: Recurrence;
  startedAt?: number;
  completedAt?: number;
  dropReason?: string;
  blockId?: ID;           // explicit block assignment (wins over area/journey link)
  assessment?: AssessmentKind; // Acompanhamento E: a prova or trabalho of a subject; `date` = `deadline` = its day
}

export type JourneyStatus = 'active' | 'done' | 'archived';
export interface Journey extends BaseRecord {
  title: string;
  outcome?: string;
  areaId?: ID;
  status: JourneyStatus;
  order: number;
  subject?: boolean;      // Acompanhamento E: a college subject ("disciplina"), only when true
  goalId?: ID;            // Objetivos (2026-11-23): the objective it serves; absent = "Sem objetivo"
  chatUrl?: string;       // Estudo pelos chats (2026-11-25): subjects only, the https:// link of its chat; never sent to assistants
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
  correctedAt?: number;   // Acompanhamento C: minutes corrected afterwards
}

export interface EnergyLog extends BaseRecord { at: number; level: EnergyLevel }

export type EventType =
  | 'created' | 'started' | 'completed' | 'uncompleted' | 'skipped' | 'shrunk'
  | 'snoozed' | 'dropped' | 'rescheduled' | 'split' | 'focus' | 'review' | 'hardDay'
  | 'partial' | 'result';   // Acompanhamento B: "Parcial" and "O que saiu?" of a concluded mission
export interface LifeEvent extends BaseRecord {
  at: number;
  type: EventType;
  missionId?: ID;
  data?: Record<string, unknown>;
}

export type XpReason = 'complete' | 'start' | 'strategy' | 'focus' | 'review' | 'journey' | 'resilience'
  | 'block' | 'resumption' | 'checkin' | 'objective' | 'study' | 'practice'
  | 'sleep' | 'mealprep' | 'workout' | 'speech';
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
  studyProfile?: string;  // Caderno da disciplina (2026-11-26): how they learn best, read by every subject chat (≤ 3.000)
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
  observation?: ObservationSettings; // Observação de 14 dias; absent = none (see observationOf)
  speech?: SpeechSettings;           // Comunicação oral; absent = the vocal health note still shows
  nutrition?: NutritionSettings;     // Nutrição; absent = every meal on (see nutritionSettingsOf)
}
export interface DayState extends BaseRecord {  // id = DayKey
  hardDay: boolean;
  reviewDone: boolean;
  mode?: DayMode;
  startedAt?: number;   // when the day actually started
  closedAt?: number;          // Acompanhamento C: "Fechar o dia"
  tiredness?: Tiredness;      // "Cansaço durante o dia" (optional)
  mood?: Mood;                // "Humor" (optional)
  load?: Load;                // "Sobrecarga" (optional)
  concentration?: Concentration;  // "Concentração" (optional)
  closeNote?: string;         // until Dexie v10 the day's note; now the `fechamento` diary entry (no longer written)
  closeDismissed?: boolean;   // "Agora não" on the evening card (only when true)
  subjectPicks?: Record<ID, ID>;  // Acompanhamento E: block id → subject journey id chosen with "Usar"
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
  outcome?: BlockOutcome;      // Acompanhamento B: "Como foi?" when ending (optional)
  result?: string;             // "O que saiu?" (optional, one line)
  retro?: boolean;             // Acompanhamento C: "Fiz, mas não registrei" (only when true; never XP)
  correctedAt?: number;        // start/end corrected afterwards
}
export interface WeekObjective { id: ID; blockId: ID; text: string; done: boolean }
export interface WeekReview {
  worked: string;
  obstacle: string;
  adjustment: string;
  answeredAt: number;
  goals?: Record<ID, GoalProgress>;   // "Avançou?" per objective (2026-11-23): only the ones tapped
}
export interface Week extends BaseRecord {           // id = Monday DayKey
  objectives: WeekObjective[];
  review?: WeekReview;
  experiment?: string;
  atypical?: WeekAtypical; // exams, travel...: kept out of comparisons (research P3)
}
/** A week marked as atypical: why, and when the usual rhythm comes back. */
export interface WeekAtypical { reason: string; returnDay?: DayKey }
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
  blocker?: Blocker;   // Acompanhamento B: "O que trava?" (optional)
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
  source?: NoteSource;  // PDFs da aula (2026-11-26): made from a PDF page ("Ver no PDF, p. N" in the review)
}

/** Where a card came from: a page of a PDF of Materiais (StudyFile). */
export interface NoteSource { fileId: ID; page: number }

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
  reminderAt?: HHmm;    // "Lembrete de estudo" time; absent = off
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
  retestOf?: ID;               // a later rebuild of that session (research P2)
  availableFrom?: DayKey;      // retest: the day it is meant for
}

// ------------------------------------------------------------------ corpo e casa (Marco 4)

/** One night, from noon to noon: `night` is the date of the evening it starts on (sleepNightOf). */
export interface SleepLog extends BaseRecord {  // id = `sleep-${night}`
  night: DayKey;
  bedAt?: number;       // "Deitei"
  wakeAt?: number;      // "Acordei"
  quality?: SleepQuality;  // Acompanhamento C: "Como foi o sono?" 1–5 (optional)
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

// ------------------------------------------------------------------ acompanhamento diário (2026-11-14)

// A — treino do dia
/**
 * What the plan asks of one exercise (treino detalhado, 2026-11-25). Everything but the name is optional. Records
 * saved before it hold a plain string per exercise: `planDaysOf` reads those as `{ name }`.
 */
export interface PlannedExercise {
  name: string;
  sets?: number;          // 1–10
  repsMin?: number;       // 1–100
  repsMax?: number;       // 1–100, ≥ repsMin
  restMinSec?: number;    // 15–600
  restMaxSec?: number;    // 15–600, ≥ restMinSec
  note?: string;          // up to 120
}
/** The plan's request for an exercise, copied into the day log (the history keeps what was asked that day). */
export type PlannedDetail = Omit<PlannedExercise, 'name'>;
/** One weekday of the training plan (0 = Sunday). A weekday without an entry is a rest day. */
export interface TrainingDay { weekday: number; name: string; exercises: PlannedExercise[] }
/** One week of a training block: the RIR range and, optionally, the cardio minutes. */
export interface BlockWeek { rirMin: number; rirMax: number; cardioMin?: number; cardioMax?: number }
/** A training block (mesocycle) from `startDay`, one entry per week (1–8). */
export interface TrainingBlock { startDay: DayKey; weeks: BlockWeek[] }
export interface TrainingPlan extends BaseRecord {   // id = 'plan' (TRAINING_PLAN_ID): a single record
  days: TrainingDay[];                                // sorted by weekday, at most one per weekday
  block?: TrainingBlock;                              // treino detalhado: the current block, if any
}
export type ExerciseStatus = 'feito' | 'pulado' | 'trocado';
/** `rir`: reps in reserve, 0–5 (5 = "5 or more"), optional. */
export interface ExerciseSet { reps: number; kg?: number; rir?: number }
export type DiscomfortSpot = 'ombro' | 'cotovelo' | 'punho' | 'lombar' | 'joelho' | 'canela' | 'outro';
export interface Discomfort { spot: DiscomfortSpot; note?: string }
export interface TrainingExercise {
  id: ID;                  // `p${index}` for the plan's exercises, `x-${ulid}` for extras
  name: string;            // as in the plan when the log was created (or typed, for an extra)
  status?: ExerciseStatus; // absent = not done yet
  replacedBy?: string;     // 'trocado': what was done instead (the sets are of the replacement)
  sets: ExerciseSet[];
  extra?: boolean;         // added that day (only when true)
  planned?: PlannedDetail; // what the plan asked that day (copied when the log was created)
  discomfort?: Discomfort; // "Senti desconforto"
}
/** The block week of a day, copied into its log when the log is created. */
export interface TrainingTarget { week: number; weeks: number; rirMin: number; rirMax: number; cardioMin?: number; cardioMax?: number }
export type CardioModality = 'bicicleta' | 'esteira' | 'caminhada' | 'outro';
export interface TrainingCardio { modality: CardioModality; minutes: number; intensity?: number }  // intensity 1–10
export interface TrainingLog extends BaseRecord {    // id = `training-${day}`: one editable record per logical day
  day: DayKey;
  planName?: string;       // the day's plan name, copied when the log was created (absent on a rest day)
  exercises: TrainingExercise[];
  cardio?: TrainingCardio;
  effort?: number;         // 1–5 (optional)
  recovery?: number;       // 1–5 (optional)
  finishedAt?: number;     // "Terminei o treino"
  strengthWorkoutId?: ID;  // the 'musculacao' Workout it produced or adopted
  cardioWorkoutId?: ID;    // the 'cardio' Workout made from `cardio`
  target?: TrainingTarget; // the block week of that day, if the plan had a block covering it
}

// B — fechar a atividade
export type BlockOutcome = 'feito' | 'parcial' | 'investiguei' | 'nao-deu';   // 'investiguei' since 2026-11-23
export type SnoozeReason = 'sem-tempo' | 'sem-energia' | 'nao-sei-comecar' | 'falta-algo' | 'outra-prioridade';
export type Blocker = 'nao-sei-comecar' | 'falta-informacao' | 'grande-demais' | 'medo-de-errar' | 'chato';

// C — encerramento do dia
export type Tiredness = 'pouco' | 'medio' | 'muito';
export type SleepQuality = 1 | 2 | 3 | 4 | 5;

// D — foto do plano
export interface PlannedBlock {
  blockId: ID; name: string; kind: BlockKind; areaId?: ID; journeyId?: ID;
  targetStart: HHmm; durationMin: number; minimumMin: number; protected: boolean;
  order: number; createdAt: number;
}
export interface PlannedCommitment { commitmentId: ID; title: string; start: HHmm; end: HHmm }
export interface DayPlan extends BaseRecord {   // id = DayKey
  day: DayKey;
  mode: DayMode;
  takenAt: number;
  blocks: PlannedBlock[];           // the weekday's live, unarchived blocks when taken (any kind, any mode)
  commitments: PlannedCommitment[]; // the day's commitment occurrences when taken
}

// E — faculdade
export type AssessmentKind = 'prova' | 'trabalho';
export interface ProblemSet extends BaseRecord {  // "Lista / exercícios": editable (LWW), soft delete
  journeyId: ID;
  day: DayKey;
  title: string;
  done: number;
  total?: number;
  unaided?: number;      // "sem ajuda", ≤ done
}
export type TopicLevel = 'nenhum' | 'vi' | 'entendi' | 'resolvo';
export interface TopicMark { at: number; level: TopicLevel }
export interface SubjectTopic extends BaseRecord {
  journeyId: ID;
  name: string;
  marks: TopicMark[];    // level history, oldest first: only appended (current level = last mark)
}

// Caderno da disciplina (2026-11-26): the memory a subject's chats share through the app, and the study materials
// (apostilas) they write. Assistants write them only through reviewed proposals.
export type BibKind = 'basica' | 'complementar' | 'outra';
export interface BibItem {
  title: string;         // ≤ 200; the merge key (accents, case and extra spaces ignored)
  authors?: string;      // ≤ 200
  kind: BibKind;
  url?: string;          // https:// only, ≤ 500
  note?: string;         // ≤ 200
}
export interface SubjectNotebook extends BaseRecord {  // id = `notebook-${journeyId}` (notebookId): one per subject
  journeyId: ID;
  plan?: string;         // Plano de ensino (≤ 8.000); an empty section is an absent field
  studied?: string;      // O que já foi estudado (≤ 4.000)
  difficulties?: string; // Dificuldades (≤ 2.000)
  nextChat?: string;     // Para o próximo chat (≤ 4.000)
  bibliography: BibItem[]; // ≤ 40, in the order they were added
}
export interface StudyDoc extends BaseRecord {   // id: ulid; "Apagar" is a soft delete with "Desfazer"
  journeyId: ID;
  title: string;         // ≤ 120; a proposal with the same title in the subject replaces the text
  markdown: string;      // ≤ 40.000
  source: string;        // the assistant's name, "Colada de um chat" or "Você"
}

// PDFs da aula (2026-11-26, fase 2): a PDF (slides, plano de ensino, chapters) read in the app. The bytes are media
// (content-addressed, uploaded through the queue, downloaded only when the reader opens); the extracted text is a media
// file too, read only by the server (ler_material). Assistants see only the PDFs linked to a subject.
export interface StudyFile extends BaseRecord {   // id: ulid; "Apagar" is a soft delete with "Desfazer"
  journeyId?: ID;        // the subject; absent = "Sem disciplina" (never read by assistants)
  title: string;         // ≤ 120
  fileHash: string;      // the PDF's media hash
  bytes: number;
  pages: number;
  textHash?: string;     // the extracted text's media hash (absent when hasText is false)
  textChars?: number;    // characters of the extracted text
  hasText: boolean;      // false: only scanned images (no OCR)
}

// Where she stopped in a PDF, a record of its own (id = the StudyFile's id): reading never rewrites the StudyFile, so
// moving or deleting a PDF on another device is never undone by a reader left open here (record-level LWW).
export interface StudyFileProgress extends BaseRecord {   // id: the StudyFile's id
  lastPage?: number;     // where she stopped (written at most every 5 s and on leaving the reader)
  lastReadAt?: number;   // the last time she read it for real (counts as contact with the subject)
}

// ------------------------------------------------------------------ diário (2026-11-16)

export type DiaryKind = 'livre' | 'fechamento';
export type DiaryTheme = 'faculdade' | 'carreira' | 'projetos' | 'estudo' | 'saude' | 'treino' | 'sono'
  | 'relacionamentos' | 'familia' | 'lazer' | 'sentimentos' | 'ideias' | 'comunicacao';
export interface DiaryLink { kind: 'mission' | 'journey'; id: ID }
export interface DiaryEntry extends BaseRecord {   // id: ulid; fechamento: `diary-close-${day}` (diaryCloseId)
  day: DayKey;           // logical day
  at: number;            // the moment (the time shown)
  kind: DiaryKind;
  text: string;          // exactly as written ('' only after "Apagar de vez")
  themes: DiaryTheme[];
  links: DiaryLink[];    // at most DIARY_LINKS_MAX
  private: boolean;      // out of exports unless included in that export
  trashedAt?: number;    // in "Apagadas recentemente"
  editedAt?: number;     // last edit after the editing session that created it
}

// ------------------------------------------------------------------ estratégias e estado do dia (2026-11-23)

export type StrategySource = 'ia' | 'pesquisa' | 'ideia' | 'padroes';
export type StrategyStatus = 'testando' | 'mantida' | 'ajustada' | 'descartada';
export interface StrategyLink { kind: 'block' | 'journey'; id: ID }
export interface Strategy extends BaseRecord {   // id: ulid (editable, LWW; "Apagar" = trashedAt, "Apagar de vez" = soft delete)
  title: string;            // what is tested, one line ('' only after "Apagar de vez")
  source: StrategySource;   // "De onde veio?"
  sourceNote?: string;      // "Qual conversa ou fonte?" (only for 'ia' and 'pesquisa')
  why?: string;             // "Por quê?" (one line)
  observe?: string;         // "O que observar?" (one line)
  link?: StrategyLink;      // a block (any block of the same name counts) or a journey
  startDay: DayKey;         // "Desde" (logical day, up to today)
  reviewDay: DayKey;        // "Decidir em" (after startDay; "Hora de decidir" from this day on)
  status: StrategyStatus;
  decidedDay?: DayKey;      // the day of the decision (absent while 'testando')
  decisionNote?: string;    // his words when deciding (absent while 'testando')
  trashedAt?: number;       // in "Apagadas recentemente"
}
export type Mood = 'baixo' | 'ok' | 'bem';
export type Load = 'leve' | 'media' | 'pesada';
export type Concentration = 'dificil' | 'ok' | 'boa';
/** The 14-day observation (one at a time): started on `startDay` (day 1); `endedDay` when ended early. */
export interface ObservationSettings { startDay: DayKey; endedDay?: DayKey }

// ------------------------------------------------------------------ objetivos e temporadas (2026-11-23)

export type GoalStatus = 'ativo' | 'pausado' | 'concluido' | 'arquivado';
/** "Objetivo" on screen: the why above the journeys. Named Goal in code, apart from WeekObjective (a block's objective of the week). */
export interface Goal extends BaseRecord {   // id: ulid (editable, LWW; put away by archiving, never deleted by the app)
  title: string;            // one line, up to GOAL_TITLE_MAX
  why?: string;             // "Por que importa?" (one line)
  horizon?: string;         // "Horizonte", free text ("2027", "julho de 2027")
  status: GoalStatus;
  order: number;            // creation order (the list shows the goals of a status by it)
}
/** "Avançou?" of the Nova semana, per objective: Sim · Um pouco · Não desta vez. */
export type GoalProgress = 'sim' | 'um-pouco' | 'nao';

export type SeasonStatus = 'ativa' | 'encerrada';
export interface SeasonLink { kind: 'goal' | 'strategy'; id: ID }
/** One focus line of a season: his words and/or a link to an objective or a strategy (at least one of the two). */
export interface SeasonFocus { text?: string; link?: SeasonLink }
/** The end review's answers ('' when left blank) and when they were saved. */
export interface SeasonReview { progress: string; obstacle: string; next: string; answeredAt: number }
export interface Season extends BaseRecord {   // id: ulid (editable, LWW); one active at a time
  title: string;            // one line, up to SEASON_TITLE_MAX
  focus: SeasonFocus[];     // 0–2
  startDay: DayKey;         // logical day it started, up to today; its week (Monday) is week 1
  plannedWeeks: number;     // 6, 7 or 8 usual weeks: atypical weeks do not count
  status: SeasonStatus;
  endedDay?: DayKey;        // "Encerrar temporada"
  review?: SeasonReview;    // only when some answer was typed
}

// ------------------------------------------------------------------ comunicação oral (2026-11-23)

/** The session's size: a label he picks (5, 15 or 25–30 minutes), never a timer or a target. */
export type SpeechSize = 5 | 15 | 30;
export type SpeechKind = 'leitura' | 'explicacao' | 'exercicio' | 'simulacao';
export type SpeechExercise = 'pausas' | 'ritmo' | 'enfase' | 'articulacao';
export type SpeechSimulation = 'entrevista' | 'apresentacao' | 'pergunta';
/** Self-assessment, 1 to 5: how close it felt to what he wanted (a perception, never a measure). */
export type SpeechScore = 1 | 2 | 3 | 4 | 5;
export type SpeechRatingKey = 'clareza' | 'ritmo' | 'pausas' | 'conforto';
/** "Consegui explicar?" (content, apart from the delivery). */
export type SpeechContent = 'sim' | 'em-parte' | 'nao';
/** A recording of a session: the bytes live in the media tables under `hash` (never in the synced record). */
export interface SpeechRecording {
  hash: string;             // sha256 of the audio file (media pipeline)
  durationMs: number;       // from tapping Gravar to Parar (or to the 3-minute cap)
  at: number;               // when it was saved
  capped?: boolean;         // stopped by the 3-minute cap
  keep?: boolean;           // "Guardar": never offered to leave this device
}
export interface SpeechSession extends BaseRecord {   // id: ulid (editable, LWW)
  day: DayKey;              // logical day it was created
  kind: SpeechKind;
  size?: SpeechSize;
  exercise?: SpeechExercise;     // used when kind is 'exercicio'
  simulation?: SpeechSimulation; // used when kind is 'simulacao'
  passage?: string;              // a SPEECH_READINGS id, used when kind is 'leitura'
  topic?: string;                // "Tema" (one line, his words)
  recordings: SpeechRecording[];
  ratings: Partial<Record<SpeechRatingKey, SpeechScore>>;
  content?: SpeechContent;       // used when kind is 'explicacao' or 'simulacao'
  notes?: string;                // "Notas" (his words)
  done?: boolean;                // "Fiz a atividade" (without recording)
  closedAt?: number;             // "Encerrar sessão"
}
export type SituationContext = 'aula' | 'conversa' | 'entrevista' | 'apresentacao' | 'outra';
/** "Pediram para repetir?": 0, 1, 2, or 3 meaning "3 ou mais". */
export type SituationRepeats = 0 | 1 | 2 | 3;
export interface SpeechSituation extends BaseRecord {   // id: ulid (append-only: created or soft-deleted, never edited)
  day: DayKey;
  at: number;
  context: SituationContext;
  repeats?: SituationRepeats;
  clarity?: SpeechScore;    // perceived
  comfort?: SpeechScore;    // perceived
  note?: string;            // one optional sentence
}
export type SpeechProgramStatus = 'ativo' | 'encerrado';
export type SpeechPhase = 1 | 2 | 3 | 4;
/** "O que mudou nas situações reais?" at the end of a phase, and the logical day it was saved. */
export interface SpeechPhaseNote { text: string; day: DayKey; answeredAt: number }
export interface SpeechProgram extends BaseRecord {   // id: ulid (editable, LWW); one active at a time
  startDay: DayKey;
  week: number;             // 1–12, chosen by him (never advanced by the calendar)
  status: SpeechProgramStatus;
  endedDay?: DayKey;
  phaseNotes: Partial<Record<SpeechPhase, SpeechPhaseNote>>;
}
/** settings.speech; absent = the vocal health note was not dismissed. */
export interface SpeechSettings { noteDismissed?: boolean }

// ------------------------------------------------------------------ nutrição (2026-11-25)

/** The six meals of the day, in order: café da manhã, lanche da manhã, almoço, café da tarde, jantar, ceia. */
export type NutritionMeal = 'cafe' | 'lanche' | 'almoco' | 'tarde' | 'jantar' | 'ceia';
/** Nutrients of an amount of food: kcal and grams (per 100 g on a food). `fiber` only when known. */
export interface Nutrients { kcal: number; protein: number; carbs: number; fat: number; fiber?: number }
/** The three macros of a target, in grams (the calories come from them: 4/4/9 kcal per gram). */
export interface MacroTarget { protein: number; carbs: number; fat: number }
/** Whether a food's values (and its weights) are of the food ready to eat or raw. */
export type FoodBasis = 'pronto' | 'cru';
/** Where the values came from: the label, a recognised table, or an estimate (shown as "estimado"). */
export type FoodSource = 'rotulo' | 'tabela' | 'estimativa';
export type FoodGroup = 'proteina' | 'carboidrato' | 'gordura' | 'fruta' | 'verdura' | 'laticinio' | 'outro';
/** gosto · normal · pouco (at most one meal a day) · nunca (never suggested; can still be logged). */
export type FoodLike = 'gosto' | 'normal' | 'pouco' | 'nunca';
/** A natural unit of the food, such as "1 fatia = 25 g". */
export interface FoodUnit { name: string; grams: number }
export interface RecipeIngredient { foodId: ID; grams: number }
/** A recipe: its ingredients (the cooking fat included) and the final weight once ready. */
export interface FoodRecipe { ingredients: RecipeIngredient[]; yieldGrams: number }
export interface Food extends BaseRecord {   // id: ulid (editable, LWW; soft delete never touches the food logs)
  name: string;
  per100: Nutrients;        // a recipe's is computed when saved (recipePer100)
  basis: FoodBasis;
  source: FoodSource;       // a recipe's is 'estimativa' when any ingredient is
  group: FoodGroup;
  like: FoodLike;
  unit?: FoodUnit;
  maxPortion?: number;      // grams per meal the generator never goes over
  meals?: NutritionMeal[];  // "Bom para": the meals the generator may use it in (absent or empty = every meal)
  recipe?: FoodRecipe;
}
export interface NutritionTarget extends BaseRecord {   // id = `ntarget-${from}` (nutritionTargetId): saving again the same day replaces it
  from: DayKey;             // in force from this day; each day uses the target with the greatest `from` ≤ day
  byWeekday: MacroTarget[]; // 7 entries, 0 = Sunday
}
export type FoodLogStatus = 'comido' | 'planejado';
export interface FoodLog extends BaseRecord {   // id: ulid; one item of one meal
  day: DayKey;
  meal: NutritionMeal;
  foodId: ID;
  name: string;             // copied from the food when logged: the history never changes with the food
  per100: Nutrients;        // copied
  basis: FoodBasis;         // copied
  estimate: boolean;        // copied (the food's source was 'estimativa')
  grams: number;
  status: FoodLogStatus;    // 'planejado' items are replaced by "Montar o resto do dia"; 'comido' never are
  order: number;            // order inside the meal
  eatenAt?: number;         // ms when it became 'comido' (the stock follows it only while not counted again since)
  stockTaken?: number;      // grams of it taken from the counted stock (what a correction or deletion may give back)
}
export interface PantryItem extends BaseRecord {   // id = `pantry-${foodId}` (pantryId): one per food
  foodId: ID;
  confirmedDay: DayKey;     // available only on this day ("Tinha em 24/11 · Confirmar" afterwards)
  grams?: number;           // what is left, in the food's basis; absent = "tem, sem contar"
  countedAt?: number;       // ms when the grams were typed (eaten items from before it no longer move the stock)
}
export interface WeighIn extends BaseRecord {   // id: ulid (append-only: created or soft-deleted, never edited)
  day: DayKey;
  kg: number;               // 30–300, one decimal
}
/** How hungry he is when building the rest of the day. */
export type Hunger = 'pouca' | 'normal' | 'muita';
/**
 * The last "Montar o resto do dia" of this device (kept in the local meta, never synced): the day, the hunger and the
 * meal right after training (it becomes pós-treino; the meal switched on before it, pré-treino).
 */
export interface NutritionBuild { day: DayKey; hunger: Hunger; afterTraining?: NutritionMeal }
/** settings.nutrition; absent = every meal on (see nutritionSettingsOf). */
export interface NutritionSettings {
  meals: NutritionMeal[];   // the meals switched on, in day order (at least one)
}

export const SYNC_TABLES = [
  'missions', 'journeys', 'commitments', 'areas', 'focusSessions', 'energyLogs',
  'events', 'xpEvents', 'profile', 'settings', 'dayState',
  'blocks', 'blockSessions', 'weeks', 'checkins',
  'decks', 'notes', 'cards', 'reviews',
  'sketches',
  'practiceSessions',
  'sleepLogs', 'recipes', 'menus', 'shoppingLists', 'freezerMoves', 'workouts',
  'monthReviews', 'trainingPlans', 'trainingLogs', 'dayPlans', 'problemSets', 'subjectTopics',
  'diaryEntries',
  'strategies',
  'goals', 'seasons',
  'speechSessions', 'speechSituations', 'speechPrograms',
  'proposals',
  'foods', 'nutritionTargets', 'foodLogs', 'pantry', 'weighIns',
  'subjectNotebooks', 'studyDocs',
  'studyFiles', 'studyFileProgress',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export const APPEND_ONLY_TABLES: readonly SyncTable[] = [
  'events', 'xpEvents', 'reviews', 'freezerMoves', 'workouts', 'speechSituations', 'weighIns',
];

export interface SyncChange { table: SyncTable; record: BaseRecord & Record<string, unknown> }
export interface SyncRequest { deviceId: string; cursor: number; changes: SyncChange[] }
export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  /** The server is behind the device's cursor (restored backup): restart from 0 and resend everything. */
  reset?: boolean;
}
