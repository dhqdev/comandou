import { useCallback, useMemo, useState } from 'react';
import {
  cleanFilters,
  fold,
  matchAll,
  sameFilters,
  serverFilters,
  type Filters,
  type ListField,
  type ListSort,
  type ListTab,
} from './list-view';

interface Stored {
  tab?: string;
  tabs?: ListTab[];
}

const storeKey = (id: string) => `cm-lv:${id}`;

function readStore(id: string): Stored {
  try {
    return JSON.parse(localStorage.getItem(storeKey(id)) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

/** Só grava quando a pessoa troca de aba ou salva uma: abrir a tela não deixa nada no navegador. */
function writeStore(id: string, s: Stored) {
  try {
    localStorage.setItem(storeKey(id), JSON.stringify(s));
  } catch {
    /* navegador sem armazenamento: as abas valem só nesta visita */
  }
}

export interface ListViewConfig<T> {
  /** Nome da lista (guarda as abas criadas e a última aba aberta). */
  id: string;
  rows: readonly T[] | null;
  fields: readonly ListField<T>[];
  /** Abas padrão da tela (a primeira é a inicial). */
  tabs: readonly ListTab[];
  /** Texto pesquisável da linha. */
  search?: (row: T) => string;
  sorts?: readonly ListSort<T>[];
  defaultSort?: { key: string; desc: boolean };
}

export type Sort = { key: string; desc: boolean };

export function useListView<T>(cfg: ListViewConfig<T>) {
  const { id, rows, fields, tabs: baseTabs, search, sorts = [], defaultSort } = cfg;
  const [customTabs, setCustomTabs] = useState<ListTab[]>(() => readStore(id).tabs ?? []);
  const tabs = useMemo(() => [...baseTabs, ...customTabs], [baseTabs, customTabs]);
  const [tabId, setTabId] = useState(() => {
    const saved = readStore(id).tab;
    return tabs.some((t) => t.id === saved) ? saved! : (tabs[0]?.id ?? '');
  });
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const [filters, setFilters] = useState<Filters>(() => ({ ...(tab?.filters ?? {}) }));
  const [added, setAdded] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(
    () => defaultSort ?? { key: sorts[0]?.key ?? '', desc: !sorts[0]?.asc },
  );

  const persist = useCallback(
    (next: Stored) => writeStore(id, { tab: tabId, tabs: customTabs, ...next }),
    [id, tabId, customTabs],
  );

  const selectTab = (t: ListTab) => {
    setTabId(t.id);
    setFilters({ ...t.filters });
    setAdded([]);
    persist({ tab: t.id });
  };

  const setField = (key: string, values: string[]) => setFilters((f) => ({ ...f, [key]: values }));
  const addField = (key: string) => setAdded((a) => (a.includes(key) ? a : [...a, key]));

  const clear = () => {
    // "Limpar" volta para a aba atual sem nada além dos filtros que vêm do servidor.
    setFilters((f) => cleanFilters(serverFilters(fields, f)));
    setAdded([]);
    setQuery('');
  };

  const saveTab = (label: string) => {
    const t: ListTab = {
      id: `c${Date.now().toString(36)}`,
      label: label.trim().slice(0, 40),
      filters: cleanFilters(filters),
      custom: true,
    };
    const next = [...customTabs, t];
    setCustomTabs(next);
    setTabId(t.id);
    setAdded([]);
    writeStore(id, { tab: t.id, tabs: next });
  };

  const deleteTab = (t: ListTab) => {
    const next = customTabs.filter((x) => x.id !== t.id);
    setCustomTabs(next);
    const first = baseTabs[0];
    if (tabId === t.id && first) {
      setTabId(first.id);
      setFilters({ ...first.filters });
    }
    writeStore(id, { tab: tabId === t.id ? first?.id : tabId, tabs: next });
  };

  const q = fold(query.trim());
  const searchOk = useCallback(
    (row: T) => !q || !search || fold(search(row)).includes(q),
    [q, search],
  );

  const visible = useMemo(() => {
    if (!rows) return null;
    const list = rows.filter((r) => matchAll(fields, r, filters) && searchOk(r));
    const s = sorts.find((x) => x.key === sort.key);
    if (!s) return list;
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = s.get(a);
      const y = s.get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, fields, filters, searchOk, sorts, sort]);

  // Contagem de cada aba sobre o que está carregado. Abas que pedem outro recorte do
  // servidor (ex.: outro período) ficam sem número, para não mostrar conta errada.
  const counts = useMemo(() => {
    const out: Record<string, number | null> = {};
    const server = serverFilters(fields, filters);
    for (const t of tabs) {
      out[t.id] =
        rows && sameFilters(serverFilters(fields, t.filters), server)
          ? rows.filter((r) => matchAll(fields, r, t.filters)).length
          : null;
    }
    return out;
  }, [tabs, rows, fields, filters]);

  const shown = fields
    .filter((f) => f.pinned || added.includes(f.key) || filters[f.key]?.length)
    .map((f) => f.key);
  const dirty = !!tab && !sameFilters(filters, tab.filters);
  const active = fields.filter((f) => !f.server && filters[f.key]?.length).length;

  return {
    rows,
    fields,
    tabs,
    tab,
    counts,
    selectTab,
    filters,
    setField,
    addField,
    shown,
    dirty,
    active,
    clear,
    saveTab,
    deleteTab,
    query,
    setQuery,
    sorts,
    sort,
    setSort,
    visible,
  };
}

export type ListView<T> = ReturnType<typeof useListView<T>>;
