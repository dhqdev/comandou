import { useCallback, useMemo, useState } from 'react';
import {
  addToBar,
  barKeys,
  cleanFilters,
  countUse,
  fold,
  matchAll,
  removeFromBar,
  sameFilters,
  serverFilters,
  toggleBar,
  type FieldPrefs,
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

const prefsKey = (id: string) => `cm-lv-campos:${id}`;

function readPrefs(id: string): FieldPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(prefsKey(id)) ?? '{}') as FieldPrefs | null;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function writePrefs(id: string, p: FieldPrefs) {
  try {
    localStorage.setItem(prefsKey(id), JSON.stringify(p));
  } catch {
    /* navegador sem armazenamento: a barra vale só nesta visita */
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
  // Campos da barra escolhidos pela pessoa: ficam salvos no navegador, por lista, e não somem
  // ao trocar de aba, limpar os filtros ou recarregar a tela.
  const [prefs, setPrefs] = useState<FieldPrefs>(() => readPrefs(id));
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
    persist({ tab: t.id });
  };

  const setField = (key: string, values: string[]) => setFilters((f) => ({ ...f, [key]: values }));

  const changePrefs = (key: string, change: (f: ListField<T>, p: FieldPrefs) => FieldPrefs) => {
    const f = fields.find((x) => x.key === key);
    if (!f) return;
    setPrefs((p) => {
      const next = change(f, p);
      writePrefs(id, next);
      return next;
    });
  };
  /** "+ Filtro": o campo escolhido entra na barra e fica lá (conta um uso para "Mais usados"). */
  const addField = (key: string) => changePrefs(key, (f, p) => countUse(f.key, addToBar(f, p)));
  /** Tira o campo da barra e apaga o que estava escolhido nele. */
  const removeField = (key: string) => {
    changePrefs(key, removeFromBar);
    setFilters((f) => ({ ...f, [key]: [] }));
  };
  /** Alfinete do seletor: põe ou tira o campo da barra. */
  const pinField = (key: string) => changePrefs(key, toggleBar);

  const clear = () => {
    // Mexeu nos filtros da aba: "Limpar" volta para a aba como ela é. Só buscou: apaga a busca.
    // Já na aba, sem busca: tira tudo, menos os filtros que vêm do servidor (o período carregado).
    if (tab && !sameFilters(filters, tab.filters)) setFilters({ ...tab.filters });
    else if (!query) setFilters((f) => cleanFilters(serverFilters(fields, f)));
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

  const shown = barKeys(fields, prefs, filters);
  const dirty = !!tab && !sameFilters(filters, tab.filters);
  const active = fields.filter((f) => !f.server && filters[f.key]?.length).length;

  return {
    id,
    rows,
    fields,
    tabs,
    tab,
    counts,
    selectTab,
    filters,
    setField,
    prefs,
    addField,
    removeField,
    pinField,
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
