import React, { type ReactNode, createContext, useReducer, useContext, useEffect } from 'react';
import type { Prompt, PromptVersion, PromptRun, APIConfig, TestSet } from '@sentry-prompt/core';
import { api } from './services/coreService';

// ─── Service instance ────────────────────────────────────────────────────────

// All persistence goes through the local API server (see server/index.ts).
export const service = api;

// ─── Store State ──────────────────────────────────────────────────────────────

export interface StoreState {
  prompts: Prompt[];
  versions: PromptVersion[];
  runs: PromptRun[];
  testSets: TestSet[];
  apiConfig: APIConfig | undefined;
  selectedPromptId: string | null;
  selectedVersionId: string | null;
  selectedRunId: string | null;
  isLoading: boolean;
  error: string | null;
}

export type StoreAction =
  | { type: 'SET_PROMPTS'; payload: Prompt[] }
  | { type: 'ADD_PROMPT'; payload: Prompt }
  | { type: 'UPDATE_PROMPT'; payload: Prompt }
  | { type: 'DELETE_PROMPT'; payload: string }
  | { type: 'SET_VERSIONS'; payload: PromptVersion[] }
  | { type: 'ADD_VERSION'; payload: PromptVersion }
  | { type: 'SET_RUNS'; payload: PromptRun[] }
  | { type: 'ADD_RUN'; payload: PromptRun }
  | { type: 'DELETE_RUN'; payload: string }
  | { type: 'SET_TEST_SETS'; payload: TestSet[] }
  | { type: 'SET_API_CONFIG'; payload: APIConfig | undefined }
  | { type: 'SET_SELECTED_PROMPT'; payload: string | null }
  | { type: 'SET_SELECTED_VERSION'; payload: string | null }
  | { type: 'SET_SELECTED_RUN'; payload: string | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: StoreState = {
  prompts: [],
  versions: [],
  runs: [],
  testSets: [],
  apiConfig: undefined,
  selectedPromptId: null,
  selectedVersionId: null,
  selectedRunId: null,
  isLoading: false,
  error: null,
};

function storeReducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'SET_PROMPTS':
      return { ...state, prompts: action.payload };
    case 'ADD_PROMPT':
      return { ...state, prompts: [action.payload, ...state.prompts] };
    case 'UPDATE_PROMPT':
      return {
        ...state,
        prompts: state.prompts.map(p => (p.id === action.payload.id ? action.payload : p)),
      };
    case 'DELETE_PROMPT':
      return {
        ...state,
        prompts: state.prompts.filter(p => p.id !== action.payload),
        versions: state.versions.filter(v => v.promptId !== action.payload),
        runs: state.runs.filter(r => r.promptId !== action.payload),
      };
    case 'SET_VERSIONS':
      return { ...state, versions: action.payload };
    case 'ADD_VERSION':
      return {
        ...state,
        versions: [action.payload, ...state.versions.filter(v => v.id !== action.payload.id)],
      };
    case 'SET_RUNS':
      return { ...state, runs: action.payload };
    case 'ADD_RUN':
      return {
        ...state,
        runs: [action.payload, ...state.runs.filter(r => r.id !== action.payload.id)],
      };
    case 'DELETE_RUN':
      return { ...state, runs: state.runs.filter(r => r.id !== action.payload) };
    case 'SET_TEST_SETS':
      return { ...state, testSets: action.payload };
    case 'SET_API_CONFIG':
      return { ...state, apiConfig: action.payload };
    case 'SET_SELECTED_PROMPT':
      return { ...state, selectedPromptId: action.payload };
    case 'SET_SELECTED_VERSION':
      return { ...state, selectedVersionId: action.payload };
    case 'SET_SELECTED_RUN':
      return { ...state, selectedRunId: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface StoreContextType {
  state: StoreState;
  dispatch: React.Dispatch<StoreAction>;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(storeReducer, initialState);

  // Load data from the API server on mount
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const [prompts, versions, runs, apiConfig] = await Promise.all([
          service.listPrompts(),
          service.listVersions(),
          service.listRuns(),
          service.getAPIConfig(),
        ]);
        if (!cancelled) {
          dispatch({ type: 'SET_PROMPTS', payload: prompts });
          dispatch({ type: 'SET_VERSIONS', payload: versions });
          dispatch({ type: 'SET_RUNS', payload: runs });
          dispatch({ type: 'SET_API_CONFIG', payload: apiConfig ?? undefined });
          dispatch({ type: 'SET_ERROR', payload: null });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Failed to load data' });
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextType {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
