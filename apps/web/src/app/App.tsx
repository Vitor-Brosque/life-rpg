import { PracticeScreen } from '../features/practice/PracticeScreen';
import { PracticeListScreen } from '../features/practice/PracticeListScreen';
import { useLiveQuery } from 'dexie-react-hooks';
import { Route, Switch, useLocation } from 'wouter';
import { db } from '../db/db';
import { AgoraScreen } from '../features/agora/AgoraScreen';
import { CheckinCardHost } from '../features/agora/CheckinCard';
import { ResumePromptHost } from '../features/agora/ResumePrompt';
import { CaptureFab, CaptureHost } from '../features/capture/CaptureBar';
import { CharacterScreen } from '../features/character/CharacterScreen';
import { JourneyDetail } from '../features/journeys/JourneyDetail';
import { JourneysScreen } from '../features/journeys/JourneysScreen';
import { SketchListScreen } from '../features/sketch/SketchListScreen';
import { SketchScreen } from '../features/sketch/SketchScreen';
import { CorpoScreen } from '../features/corpo/CorpoScreen';
import { SleepSheetHost } from '../features/corpo/SleepSheet';
import { WorkoutSheetHost } from '../features/corpo/WorkoutSheet';
import { MissionSheetHost } from '../features/mission/MissionSheet';
import { Onboarding } from '../features/onboarding/Onboarding';
import { PainelScreen } from '../features/painel/PainelScreen';
import { PlanScreen } from '../features/plan/PlanScreen';
import { DeckScreen } from '../features/study/DeckScreen';
import { NoteEditor } from '../features/study/NoteEditor';
import { ReviewSession } from '../features/study/ReviewSession';
import { StudyScreen } from '../features/study/StudyScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
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
      <Layout floating={location.startsWith('/estudo/revisar') || location.startsWith('/lousa/') ? undefined : <CaptureFab />} aboveNav={<TimerBar />}>
        <Switch>
          <Route path="/"><AgoraScreen /></Route>
          <Route path="/planejar"><PlanScreen /></Route>
          <Route path="/estudo"><StudyScreen /></Route>
          <Route path="/estudo/baralho/:id">{(params) => <DeckScreen id={params.id} />}</Route>
          <Route path="/estudo/revisar"><ReviewSession /></Route>
          <Route path="/estudo/lousas"><SketchListScreen /></Route>
          <Route path="/estudo/praticas"><PracticeListScreen /></Route>
          <Route path="/lousa/:id">{(params) => <SketchScreen key={params.id} id={params.id} />}</Route>
          <Route path="/pratica/:id">{(params) => <PracticeScreen key={params.id} id={params.id} />}</Route>
          <Route path="/estudo/nota/nova"><NoteEditor /></Route>
          <Route path="/estudo/nota/:id">{(params) => <NoteEditor key={params.id} id={params.id} />}</Route>
          <Route path="/jornadas"><JourneysScreen /></Route>
          <Route path="/jornadas/:id">{(params) => <JourneyDetail id={params.id} />}</Route>
          <Route path="/personagem"><CharacterScreen /></Route>
          <Route path="/corpo"><CorpoScreen /></Route>
          <Route path="/ajustes"><SettingsScreen /></Route>
          <Route path="/painel"><PainelScreen /></Route>
          <Route><NotFound /></Route>
        </Switch>
      </Layout>
      <CaptureHost />
      <MissionSheetHost />
      <SleepSheetHost />
      <WorkoutSheetHost />
      <TimerHost />
      <ResumePromptHost />
      <CheckinCardHost />
      <ToastHost />
    </>
  );
}
