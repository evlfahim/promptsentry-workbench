import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StoreProvider, useStore } from './store';
import { Navigation } from './components/Navigation';
import { Dashboard } from './views/Dashboard';
import { PromptsList } from './views/PromptsList';
import { PromptDetail } from './views/PromptDetail';
import { ApiConfig } from './views/ApiConfig';
import { Runs } from './views/Runs';
import { ComparisonView } from './views/ComparisonView';
import { TestSets } from './views/TestSets';
import { useTheme } from './theme';
import { useKeyboardShortcuts, usePlatformShortcuts } from './hooks/useKeyboardShortcuts';

function ErrorBanner() {
  const { state } = useStore();
  const { colors } = useTheme();
  if (!state.error) return null;
  return (
    <div style={{
      backgroundColor: colors.bgError,
      borderBottom: `1px solid ${colors.textError}`,
      color: colors.textError,
      padding: '10px 24px',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      {state.error}
      <button
        onClick={() => {
          window.dispatchEvent(new CustomEvent('promptsentry:clear-error'));
        }}
        style={{
          background: 'none',
          border: 'none',
          color: colors.textError,
          fontSize: '18px',
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >×</button>
    </div>
  );
}

export function App() {
  const { colors, toggle } = useTheme();
  const { meta, ctrl, shift } = usePlatformShortcuts();

  // Register keyboard shortcuts
  useKeyboardShortcuts([
    { combo: `${meta}+n`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:new-prompt')) },
    { combo: `${meta}+k`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:focus-search')) },
    { combo: `${meta}+shift+r`, action: () => window.location.reload() },
    { combo: 'escape', action: () => window.dispatchEvent(new CustomEvent('promptsentry:close-modal')) },
    { combo: `${meta}+t`, action: toggle },
    { combo: `${meta}+h`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:show-help')) },
  ]);

  return (
    <StoreProvider>
      <BrowserRouter>
        <div style={{
          minHeight: '100vh',
          backgroundColor: colors.bg,
          color: colors.text,
          transition: 'background-color 0.2s, color 0.2s',
        }}>
          <Navigation />
          <ErrorBanner />
          <main style={{
            minHeight: 'calc(100vh - 57px)',
          }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/prompts" element={<PromptsList />} />
              <Route path="/prompts/:id" element={<PromptDetail />} />
              <Route path="/api-config" element={<ApiConfig />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/prompts/:id/compare" element={<ComparisonView />} />
              <Route path="/test-sets" element={<TestSets />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </StoreProvider>
  );
}
