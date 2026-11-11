import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StoreProvider, useStore } from './store';
import { Navigation } from './components/Navigation';
import { Dashboard } from './views/Dashboard';
import { PromptsList } from './views/PromptsList';
import { PromptDetail } from './views/PromptDetail';
import { ApiConfig } from './views/ApiConfig';
import { Runs } from './views/Runs';

function ErrorBanner() {
  const { state } = useStore();
  if (!state.error) return null;
  return <div style={styles.errorBanner}>{state.error}</div>;
}

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <div style={styles.app}>
          <Navigation />
          <ErrorBanner />
          <main style={styles.main}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/prompts" element={<PromptsList />} />
              <Route path="/prompts/:id" element={<PromptDetail />} />
              <Route path="/api-config" element={<ApiConfig />} />
              <Route path="/runs" element={<Runs />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </StoreProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#0d0d1a',
    color: '#e0e0e0',
  },
  main: {
    minHeight: 'calc(100vh - 57px)',
  },
  errorBanner: {
    backgroundColor: '#2d1a1a',
    borderBottom: '1px solid #ef4444',
    color: '#ef4444',
    padding: '10px 24px',
    fontSize: '14px',
  },
};
