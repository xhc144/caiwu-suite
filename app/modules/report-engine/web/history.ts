import { useReducer, type SetStateAction } from 'react';
import type { ReportTemplate } from '../shared';

type History = { draft: ReportTemplate; past: ReportTemplate[]; future: ReportTemplate[] };
type Action =
  | { type: 'edit'; next: SetStateAction<ReportTemplate> }
  | { type: 'reset'; next: ReportTemplate }
  | { type: 'undo' | 'redo' };

function reduce(state: History, action: Action): History {
  if (action.type === 'reset') return { draft: action.next, past: [], future: [] };
  if (action.type === 'edit') {
    const draft = typeof action.next === 'function' ? action.next(state.draft) : action.next;
    if (JSON.stringify(draft) === JSON.stringify(state.draft)) return state;
    return { draft, past: [...state.past, state.draft].slice(-20), future: [] };
  }
  if (action.type === 'undo') {
    const draft = state.past.at(-1);
    return draft
      ? { draft, past: state.past.slice(0, -1), future: [state.draft, ...state.future] }
      : state;
  }
  const draft = state.future[0];
  return draft
    ? { draft, past: [...state.past, state.draft], future: state.future.slice(1) }
    : state;
}

/** 历史仅保存在本次打开的页面中；保存、切表或恢复草稿后重新开始。 */
export function useDefinitionHistory(initial: () => ReportTemplate) {
  const [state, dispatch] = useReducer(reduce, undefined, () => ({
    draft: initial(),
    past: [],
    future: [],
  }));
  return {
    draft: state.draft,
    edit: (next: SetStateAction<ReportTemplate>) => dispatch({ type: 'edit', next }),
    reset: (next: ReportTemplate) => dispatch({ type: 'reset', next }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
