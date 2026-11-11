import { Route, Switch } from 'wouter';
import { AgoraScreen } from '../features/agora/AgoraScreen';
import { CaptureFab, CaptureHost } from '../features/capture/CaptureBar';
import { MissionSheetHost } from '../features/mission/MissionSheet';
import { PainelScreen } from '../features/painel/PainelScreen';
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
          <Route path="/planejar"><Placeholder title="Planejar" /></Route>
          <Route path="/jornadas"><Placeholder title="Jornadas" /></Route>
          <Route path="/jornadas/:id"><Placeholder title="Jornada" /></Route>
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
