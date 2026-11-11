import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Companion } from '../art/Companion';
import { downloadExport } from '../db/exportData';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';

interface State { error?: Error; exportFailed?: boolean }

export class ErrorBoundary extends Component<{ children?: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LIFE RPG crashed', error, info.componentStack);
  }

  private exportData = async () => {
    try {
      await downloadExport();
    } catch (e) {
      console.error('export failed', e);
      this.setState({ exportFailed: true });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-screen">
        <Panel variant="parchment">
          <div className="stack" style={{ alignItems: 'center' }}>
            <Companion scale={4} />
            <h1>Algo deu errado</h1>
            <p>Seus dados continuam salvos neste aparelho. Recarregar costuma resolver.</p>
            {this.state.exportFailed && <p role="alert">Não foi possível exportar os dados.</p>}
          </div>
          <div className="cluster">
            <Button variant="primary" onClick={() => window.location.reload()}>Recarregar</Button>
            <Button variant="secondary" onClick={() => { void this.exportData(); }}>Exportar dados</Button>
          </div>
        </Panel>
      </main>
    );
  }
}
