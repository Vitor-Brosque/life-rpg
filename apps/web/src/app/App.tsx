import { PracticeScreen } from '../features/practice/PracticeScreen';
import { PracticeListScreen } from '../features/practice/PracticeListScreen';
import { SpeechScreen } from '../features/speech/SpeechScreen';
import { useLiveQuery } from 'dexie-react-hooks';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { db } from '../db/db';
import { AgoraScreen } from '../features/agora/AgoraScreen';
import { CheckinCardHost } from '../features/agora/CheckinCard';
import { ResumePromptHost } from '../features/agora/ResumePrompt';
import { CaptureFab, CaptureHost } from '../features/capture/CaptureBar';
import { CharacterScreen } from '../features/character/CharacterScreen';
import { DiaryScreen } from '../features/diary/DiaryScreen';
import { DiaryEditorScreen } from '../features/diary/DiaryEditor';
import { DiaryTrashScreen } from '../features/diary/DiaryTrash';
import { ReportScreen } from '../features/diary/ReportScreen';
import { ObservationScreen } from '../features/diary/ObservationScreen';
import { StrategiesScreen } from '../features/diary/StrategiesScreen';
import { JourneyDetail } from '../features/journeys/JourneyDetail';
import { SketchListScreen } from '../features/sketch/SketchListScreen';
import { SketchScreen } from '../features/sketch/SketchScreen';
import { RecipesScreen } from '../features/casa/RecipesScreen';
import { ShoppingScreen } from '../features/casa/ShoppingScreen';
import { MapScreen } from '../features/world/MapScreen';
import { CorpoScreen } from '../features/corpo/CorpoScreen';
import { TrainingPlanScreen } from '../features/corpo/TrainingPlanScreen';
import { TrainingScreen } from '../features/corpo/TrainingScreen';
import { FoodsScreen } from '../features/nutrition/FoodsScreen';
import { NutritionScreen } from '../features/nutrition/NutritionScreen';
import { NutritionTargetsScreen } from '../features/nutrition/NutritionTargetsScreen';
import { PatternsScreen } from '../features/patterns/PatternsScreen';
import { DayCloseSheetHost } from '../features/dayClose/DayCloseSheet';
import { SituationSheetHost } from '../features/speech/SituationSheet';
import { SleepSheetHost } from '../features/corpo/SleepSheet';
import { WorkoutSheetHost } from '../features/corpo/WorkoutSheet';
import { MissionSheetHost } from '../features/mission/MissionSheet';
import { PartialSheetHost } from '../features/mission/PartialSheet';
import { Onboarding } from '../features/onboarding/Onboarding';
import { PainelScreen } from '../features/painel/PainelScreen';
import { PlanScreen } from '../features/plan/PlanScreen';
import { DeckScreen } from '../features/study/DeckScreen';
import { NoteEditor } from '../features/study/NoteEditor';
import { ReviewSession } from '../features/study/ReviewSession';
import { StudyScreen } from '../features/study/StudyScreen';
import { ProblemSetSheetHost } from '../features/faculty/ProblemSetSheet';
import { SubjectDetailScreen } from '../features/faculty/SubjectDetailScreen';
import { SubjectsScreen } from '../features/study/SubjectsScreen';
import { StudyDocScreen } from '../features/study/StudyDocScreen';
import { MaterialsScreen } from '../features/pdf/MaterialsScreen';
import { PdfReaderScreen } from '../features/pdf/PdfReaderScreen';
import { RecallSheetHost } from '../features/pdf/RecallSheet';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ProposalScreen } from '../features/assist/ProposalScreen';
import { WorldWatcher } from '../features/world/WorldWatcher';
import { TimerBar } from '../timer/TimerBar';
import { TimerHost } from '../timer/TimerSheet';
import { Panel } from '../ui/Panel';
import { ToastHost } from '../ui/Toast';
import { Layout } from './Layout';

function NotFound() {
  return (
    <section className="screen stack">
      <h1>Página não encontrada</h1>
      <Panel variant="stone">
        <p className="muted">Este caminho não existe. Use o menu para voltar.</p>
      </Panel>
    </section>
  );
}

/** undefined while loading; true without a profile (the seed failed), so the app still runs. */
function useOnboarded(): boolean | undefined {
  return useLiveQuery(async () => {
    const p = await db.profile.get('me');
    return !p || p.deleted ? true : p.onboarded;
  });
}

export function App() {
  const onboarded = useOnboarded();
  const [location] = useLocation();
  // Render nothing until the profile is read, so the first access never flashes for an onboarded user.
  if (onboarded === undefined) return null;
  if (!onboarded) {
    return (
      <>
        <Onboarding />
        <ToastHost />
      </>
    );
  }
  return (
    <>
      <Layout floating={location.startsWith('/estudo/revisar') || location.startsWith('/estudo/pdf/') || location.startsWith('/lousa/') || location.startsWith('/diario/') || location.startsWith('/casa/compras') ? undefined : <CaptureFab />} aboveNav={<TimerBar />}>
        <Switch>
          <Route path="/"><AgoraScreen /></Route>
          <Route path="/planejar"><PlanScreen /></Route>
          <Route path="/casa/compras"><ShoppingScreen /></Route>
          <Route path="/casa/receitas"><RecipesScreen /></Route>
          <Route path="/estudo"><StudyScreen /></Route>
          <Route path="/estudo/baralho/:id">{(params) => <DeckScreen id={params.id} />}</Route>
          <Route path="/estudo/revisar"><ReviewSession /></Route>
          <Route path="/estudo/materias"><SubjectsScreen /></Route>
          <Route path="/estudo/materias/:id">{(p) => <SubjectDetailScreen key={p.id} id={p.id} />}</Route>
          <Route path="/estudo/apostila/:id">{(p) => <StudyDocScreen key={p.id} id={p.id} />}</Route>
          <Route path="/estudo/materiais"><MaterialsScreen /></Route>
          <Route path="/estudo/pdf/:id">{(p) => <PdfReaderScreen key={p.id} id={p.id} />}</Route>
          <Route path="/estudo/lousas"><SketchListScreen /></Route>
          <Route path="/estudo/praticas"><PracticeListScreen /></Route>
          <Route path="/estudo/fala"><SpeechScreen /></Route>
          <Route path="/lousa/:id">{(params) => <SketchScreen key={params.id} id={params.id} />}</Route>
          <Route path="/pratica/:id">{(params) => <PracticeScreen key={params.id} id={params.id} />}</Route>
          <Route path="/estudo/nota/nova"><NoteEditor /></Route>
          <Route path="/estudo/nota/:id">{(params) => <NoteEditor key={params.id} id={params.id} />}</Route>
          <Route path="/jornadas"><Redirect to="/planejar?aba=jornadas" replace /></Route>
          <Route path="/jornadas/:id">{(params) => <JourneyDetail id={params.id} />}</Route>
          <Route path="/diario"><DiaryScreen /></Route>
          <Route path="/diario/apagadas"><DiaryTrashScreen /></Route>
          <Route path="/diario/relatorios"><ReportScreen /></Route>
          <Route path="/diario/estrategias"><StrategiesScreen /></Route>
          <Route path="/diario/observacao"><ObservationScreen /></Route>
          <Route path="/diario/:id">{(params) => <DiaryEditorScreen key={params.id} id={params.id} />}</Route>
          <Route path="/personagem"><CharacterScreen /></Route>
          <Route path="/mapa"><MapScreen /></Route>
          <Route path="/corpo/nutricao/alimentos"><FoodsScreen /></Route>
          <Route path="/corpo/nutricao/metas"><NutritionTargetsScreen /></Route>
          <Route path="/corpo/nutricao"><NutritionScreen /></Route>
          <Route path="/corpo/treino"><TrainingScreen /></Route>
          <Route path="/corpo/plano"><TrainingPlanScreen /></Route>
          <Route path="/corpo"><CorpoScreen /></Route>
          <Route path="/padroes"><PatternsScreen /></Route>
          <Route path="/ajustes"><SettingsScreen /></Route>
          <Route path="/propostas/:id">{(params) => <ProposalScreen key={params.id} id={params.id} />}</Route>
          <Route path="/painel"><PainelScreen /></Route>
          <Route><NotFound /></Route>
        </Switch>
      </Layout>
      <CaptureHost />
      <MissionSheetHost />
      <PartialSheetHost />
      <SleepSheetHost />
      <DayCloseSheetHost />
      <SituationSheetHost />
      <WorkoutSheetHost />
      <ProblemSetSheetHost />
      <RecallSheetHost />
      <TimerHost />
      <ResumePromptHost />
      <CheckinCardHost />
      <WorldWatcher />
      <ToastHost />
    </>
  );
}
