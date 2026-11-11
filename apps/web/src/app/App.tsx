import { Route, Switch } from 'wouter';
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
      <Layout>
        <Switch>
          <Route path="/"><Placeholder title="Agora" /></Route>
          <Route path="/planejar"><Placeholder title="Planejar" /></Route>
          <Route path="/jornadas"><Placeholder title="Jornadas" /></Route>
          <Route path="/jornadas/:id"><Placeholder title="Jornada" /></Route>
          <Route path="/personagem"><Placeholder title="Personagem" /></Route>
          <Route path="/ajustes"><Placeholder title="Ajustes" /></Route>
          <Route path="/painel"><Placeholder title="Painel" /></Route>
          <Route><Placeholder title="Página não encontrada" /></Route>
        </Switch>
      </Layout>
      <ToastHost />
    </>
  );
}
