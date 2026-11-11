import { Route, Switch } from 'wouter';
import { AgoraScreen } from '../features/agora/AgoraScreen';
import { CaptureFab, CaptureHost } from '../features/capture/CaptureBar';
import { JourneyDetail } from '../features/journeys/JourneyDetail';
import { JourneysScreen } from '../features/journeys/JourneysScreen';
import { MissionSheetHost } from '../features/mission/MissionSheet';
import { PainelScreen } from '../features/painel/PainelScreen';
import { PlanScreen } from '../features/plan/PlanScreen';
import { TimerBar } from '../timer/TimerBar';
import { TimerHost } from '../timer/TimerSheet';
import { Panel } from '../ui/Panel';
import { ToastHost } from '../ui/Toast';
import { Layout } from './Layout';

/** Temporary screen until the feature tasks replace it. */
function Placeholder({ title }: { title: string }) {
  return (
    <section className="screen stack">
      <h1>{title}</h1>
      <Panel variant="stone">
        <p className="muted">Em construção.</p>
      </Panel>
    </section>
  );
}

export function App() {
  return (
    <>
      <Layout floating={<CaptureFab />} aboveNav={<TimerBar />}>
        <Switch>
          <Route path="/"><AgoraScreen /></Route>
          <Route path="/planejar"><PlanScreen /></Route>
          <Route path="/jornadas"><JourneysScreen /></Route>
          <Route path="/jornadas/:id">{(params) => <JourneyDetail id={params.id} />}</Route>
          <Route path="/personagem"><Placeholder title="Personagem" /></Route>
          <Route path="/ajustes"><Placeholder title="Ajustes" /></Route>
          <Route path="/painel"><PainelScreen /></Route>
          <Route><Placeholder title="Página não encontrada" /></Route>
        </Switch>
      </Layout>
      <CaptureHost />
      <MissionSheetHost />
      <TimerHost />
      <ToastHost />
    </>
  );
}
