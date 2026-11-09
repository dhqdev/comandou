import { Plus, Search, UserPlus, X } from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useCan } from '../app/auth';
import { Alert, Button, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { isOfflineResult } from '../lib/offline';
import type { CustomerList, CustomerRow } from '../lib/types';
import './customer-picker.css';

/** Cliente do pedido: escolhido da lista (com id) ou só um nome digitado (sem id). */
export interface OrderCustomer {
  id: string | null;
  name: string;
  phone: string;
}

/** Quantos clientes aparecem na lista (recentes ou da busca). */
const LIMIT = 8;

/** Só dígitos, sem o 55 do Brasil (o servidor faz igual). */
function phoneDigits(v: string) {
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** (11) 98888-7777 enquanto digita. */
export function maskPhone(v: string) {
  const d = phoneDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/**
 * Campo "Cliente" do pedido: ao tocar, já mostra os clientes recentes; digitando, busca pelo
 * nome ou telefone. No fim da lista, "Cadastrar novo cliente" abre nome e telefone ali mesmo.
 * O texto digitado sem escolher ninguém continua valendo como nome do cliente no pedido.
 */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: OrderCustomer;
  onChange(c: OrderCustomer): void;
}) {
  const toast = useToast();
  const canRead = useCan('customers:read');
  const canCreate = useCan('customers:create');
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Linha marcada pelo teclado; rows.length é o "Cadastrar novo cliente". */
  const [active, setActive] = useState(-1);
  const [form, setForm] = useState<{ name: string; phone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const query = value.id ? '' : value.name.trim();
  const searching = query.length >= 2;

  // Recentes ao abrir; busca no servidor depois de 2 letras (com uma pausa curta na digitação).
  useEffect(() => {
    if (!open || !canRead) return;
    let alive = true;
    const url = searching
      ? `/customers?search=${encodeURIComponent(query)}&limit=${LIMIT}`
      : `/customers?limit=${LIMIT}`;
    const t = window.setTimeout(
      () => {
        api<CustomerList>(url)
          .then((d) => {
            if (!alive) return;
            setRows(d.customers.filter((c) => !c.blocked));
            setFailed(false);
          })
          .catch(() => {
            if (!alive) return;
            setRows([]);
            setFailed(true);
          });
      },
      searching ? 250 : 0,
    );
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, canRead, searching, query]);

  // Clique fora fecha a lista.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => setActive(-1), [rows]);

  function pick(c: CustomerRow) {
    onChange({ id: c.id, name: c.name, phone: c.phone });
    setOpen(false);
  }

  function startNew() {
    // O que já foi digitado vira o nome (ou o telefone, se for número).
    const typed = value.id ? '' : value.name.trim();
    const isPhone = /^[\d\s()+-]{8,}$/.test(typed);
    setForm({ name: isPhone ? '' : typed, phone: isPhone ? maskPhone(typed) : '' });
    setFormError(null);
    setOpen(false);
  }

  function clear() {
    onChange({ id: null, name: '', phone: '' });
    setRows(null);
    setOpen(true);
    window.setTimeout(() => input.current?.focus(), 0);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    const name = form.name.trim();
    const phone = phoneDigits(form.phone);
    if (!name) return setFormError('Informe o nome do cliente.');
    if (!/^[0-9]{10,11}$/.test(phone))
      return setFormError('Telefone com DDD, ex.: (11) 98888-7777.');
    setSaving(true);
    setFormError(null);
    try {
      const r = await api<CustomerRow & { existing?: boolean }>('/customers', {
        method: 'POST',
        json: { name, phone },
      });
      if (isOfflineResult(r)) {
        // Sem internet o cadastro fica na fila; o pedido leva nome e telefone.
        onChange({ id: null, name, phone });
      } else {
        onChange({ id: r.id, name: r.name, phone: r.phone });
        toast(
          r.existing
            ? `Este telefone já era de ${r.name}: cliente escolhido`
            : 'Cliente cadastrado',
          r.existing ? 'neutral' : 'success',
        );
      }
      setForm(null);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    const count = (rows?.length ?? 0) + (canCreate ? 1 : 0);
    if (e.key === 'Escape' && open) {
      // Fecha só a lista, não a janela do pedido.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!count) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + count) % count);
    } else if (e.key === 'Enter' && open && active >= 0 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (rows && active < rows.length) pick(rows[active]!);
      else startNew();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  if (form)
    return (
      <form className="cpick__new" onSubmit={save} aria-label="Cadastrar novo cliente">
        <strong className="cpick__new-title">
          <UserPlus size={16} aria-hidden /> Novo cliente
        </strong>
        <TextField
          label="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          autoComplete="off"
          autoFocus={!form.name}
        />
        <TextField
          label="Telefone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
          inputMode="tel"
          autoComplete="off"
          placeholder="(11) 98888-7777"
          autoFocus={!!form.name}
        />
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="cpick__new-actions">
          <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Cadastrar
          </Button>
        </div>
      </form>
    );

  if (value.id)
    return (
      <div className="cpick__chosen">
        <span className="cpick__avatar" aria-hidden>
          {initial(value.name)}
        </span>
        <span className="cpick__who">
          <strong>{value.name}</strong>
          <span>{maskPhone(value.phone)}</span>
        </span>
        <button
          type="button"
          className="cpick__clear"
          aria-label="Trocar cliente"
          title="Trocar cliente"
          onClick={clear}
        >
          <X size={16} />
        </button>
      </div>
    );

  const showList = open && canRead;
  return (
    <div className="cpick" ref={wrap}>
      <div className="cpick__row">
        <label className="cpick__search">
          <Search size={18} aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-label="Cliente"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            placeholder={canRead ? 'Buscar cliente…' : 'Nome do cliente'}
            value={value.name}
            maxLength={80}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              onChange({ id: null, name: e.target.value, phone: value.phone });
              setOpen(true);
            }}
            onKeyDown={onKey}
          />
        </label>
        {canCreate && (
          <button
            type="button"
            className="cpick__add"
            aria-label="Cadastrar novo cliente"
            title="Cadastrar novo cliente"
            onClick={startNew}
          >
            <Plus size={20} />
          </button>
        )}
      </div>

      {showList && (
        <div className="cpick__pop">
          <div className="cpick__scroll">
            <p className="cpick__head">
              {searching ? 'Clientes encontrados' : 'Clientes recentes'}
            </p>
            {rows === null ? (
              <div className="cpick__status">
                <Spinner />
              </div>
            ) : rows.length === 0 ? (
              <p className="cpick__status">
                {failed
                  ? 'Não deu para carregar os clientes.'
                  : searching
                    ? `Nenhum cliente com "${query}".`
                    : 'Nenhum cliente cadastrado ainda.'}
              </p>
            ) : (
              <ul id={listId} role="listbox" aria-label="Clientes" className="cpick__list">
                {rows.map((c, i) => (
                  <li
                    key={c.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="cpick__item"
                    // Escolhe antes do campo perder o foco.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                    onPointerEnter={() => setActive(i)}
                  >
                    <span className="cpick__avatar" aria-hidden>
                      {initial(c.name)}
                    </span>
                    <span className="cpick__who">
                      <strong>{c.name}</strong>
                      <span>{maskPhone(c.phone)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canCreate && (
            <button
              type="button"
              id={`${listId}-${rows?.length ?? 0}`}
              className="cpick__create"
              data-active={active === (rows?.length ?? 0) || undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={startNew}
            >
              <Plus size={18} aria-hidden /> Cadastrar novo cliente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
