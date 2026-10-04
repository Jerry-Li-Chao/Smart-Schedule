import { useEffect } from 'react';
import { S, useStore } from '../../store';
import { todayISO } from '../date';
import { buildDocs } from './docs';
import { syncIndex } from './vectors';

/** Keep the meaning index current in the background: a few seconds after the planner changes. */
export function useSemanticIndex() {
  const on = useStore((s) => s.settings.semanticSearch !== false && !!s.settings.llmUrl);
  const model = useStore((s) => s.settings.embedModel);
  const entities = useStore((s) => s.entities);
  useEffect(() => {
    if (!on) {
      S().setUI({ searchIndex: { state: 'off', done: 0, total: 0 } });
      return;
    }
    const t = setTimeout(() => void syncIndex(buildDocs(S().entities, todayISO())), 2500);
    return () => clearTimeout(t);
  }, [on, model, entities]);
}
