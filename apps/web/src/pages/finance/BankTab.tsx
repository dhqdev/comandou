import {
  bankName,
  dreGroupOf,
  DRE_GROUP_LABELS,
  suggestCategory,
  FINANCE_CATEGORIES,
  fromCents,
  parseOfx,
  toCents,
  type Statement,
} from '@comandou/shared';
import { Check, FileUp, Landmark, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { PAYMENT_METHOD_LABELS } from '../../features/format';
import { fmtDate, SelectField, Tabs, todayIso } from '../../features/forms';
import { api } from '../../lib/api';
import { brl, parseBrlInput } from '../../lib/money';
import { useLiveData } from '../../lib/realtime';
import type { FinanceEntry } from '../../lib/types';
import { KpiStrip } from './charts';
import { SignedBrl } from './ClosingsTab';
import type {
  BankAccount,
  BankLine,
  BankLines,
  Candidates,
  Proposal,
  Settlement,
  SettlementList,
} from './types';

const MAX_FILE = 5 * 1024 * 1024;

/** Lê o arquivo do banco no navegador (OFX em UTF-8 ou Windows-1252, como a maioria exporta). */
async function readStatement(file: File): Promise<Statement> {
  const buf = await file.arrayBuffer();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 800));
  const latin = /CHARSET:\s*(1252|8859)|encoding="?(windows-1252|iso-8859-1)/i.test(head);
  let text = new TextDecoder(latin ? 'windows-1252' : 'utf-8').decode(buf);
  if (!latin && text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return parseOfx(text);
}

const KIND_LABEL: Record<NonNullable<BankLine['reconciliation']>['kind'], string> = {
  settlement: 'Recebível do caixa',
  manual: 'Recebível do caixa',
  entry: 'Conta do financeiro',
  transfer: 'Transferência',
  ignored: 'Ignorada',
};

/**
 * Conciliação bancária: o extrato do banco de um lado, o que o Comandou esperava do outro. O que
 * bate exatamente já vem conciliado; o resto aparece com sugestão para confirmar.
 */
export function BankTab() {
  const canWrite = useCan('finance:write');
  const toast = useToast();
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [data, setData] = useState<BankLines | null>(null);
  const [pending, setPending] = useState<SettlementList | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState(false);
  const [preview, setPreview] = useState<{ file: string; st: Statement } | null>(null);
  const [lineModal, setLineModal] = useState<BankLine | null>(null);
  const [stModal, setStModal] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ status: filter });
      if (accountId) qs.set('accountId', accountId);
      const [a, l, p, e] = await Promise.all([
        api<BankAccount[]>('/finance/bank/accounts'),
        api<BankLines>(`/finance/bank/lines?${qs}`),
        api<SettlementList>('/finance/settlements'),
        api<FinanceEntry[]>('/finance/entries'),
      ]);
      setAccounts(a);
      setData(l);
      setPending(p);
      setEntries(e);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [accountId, filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveData(['finance'], () => void load(), ['cash.changed', 'channels.finance']);

  const stById = useMemo(() => new Map((pending?.rows ?? []).map((s) => [s.id, s])), [pending]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE) return toast('Arquivo grande demais (até 5 MB)', 'danger');
    try {
      const st = await readStatement(f);
      if (!st.lines.length)
        return toast(
          'Não achei lançamentos neste arquivo. Use o extrato em OFX do banco.',
          'danger',
        );
      setPreview({ file: f.name, st });
    } catch {
      toast('Não consegui ler este arquivo. Use o extrato em OFX do banco.', 'danger');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirm(p: Proposal) {
    setBusy(p.lineIds[0]!);
    try {
      await api('/finance/bank/reconcile', {
        method: 'POST',
        json:
          p.kind === 'settlement'
            ? { kind: 'settlement', lineIds: p.lineIds, settlementIds: p.settlementIds }
            : { kind: 'entry', lineIds: p.lineIds, entryId: p.entryId },
      });
      toast('Conciliado', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function undo(l: BankLine) {
    setBusy(l.id);
    try {
      await api(`/finance/bank/reconciliations/${l.reconciliationId}`, { method: 'DELETE' });
      toast('Conciliação desfeita', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function runAuto() {
    setBusy('auto');
    try {
      const r = await api<{ autoMatched: number }>('/finance/bank/auto', { method: 'POST' });
      toast(
        r.autoMatched
          ? `${r.autoMatched} ${r.autoMatched === 1 ? 'linha conciliada' : 'linhas conciliadas'}`
          : 'Nada novo para conciliar sozinho',
        'success',
      );
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const describe = (p: Proposal) => {
    if (p.kind === 'entry') {
      const e = entryById.get(p.entryId);
      return e
        ? `${p.settle ? 'Baixar' : 'Ligar a'} ${e.description} (${brl(e.amount)}, ${fmtDate(p.settle ? e.dueDate : (e.paidAt ?? e.dueDate))})`
        : 'Conta do financeiro';
    }
    const ss = (p.settlementIds.map((id) => stById.get(id)).filter(Boolean) as Settlement[]).sort(
      (a, b) => a.day.localeCompare(b.day),
    );
    const total = ss.reduce((a, s) => a + toCents(s.net), 0);
    const methods = [...new Set(ss.map((s) => PAYMENT_METHOD_LABELS[s.method]))].join(', ');
    const from =
      ss.length === 1
        ? `do caixa de ${fmtDate(ss[0]!.day)}`
        : `de ${ss.length} caixas (${fmtDate(ss[0]!.day)} a ${fmtDate(ss[ss.length - 1]!.day)})`;
    return ss.length ? `${methods} ${from} · ${brl(fromCents(total))}` : 'Recebíveis dos caixas';
  };

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="fin-toolbar">
        <SelectField
          label="Conta do banco"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Todas as contas</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.openLines ? ` (${a.openLines} para conciliar)` : ''}
            </option>
          ))}
        </SelectField>
        {canWrite && (
          <div className="actions-row">
            <Button
              variant="secondary"
              icon={<Plus size={16} />}
              onClick={() => setNewAccount(true)}
            >
              Nova conta
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw size={16} />}
              loading={busy === 'auto'}
              disabled={!hasAccounts}
              onClick={runAuto}
            >
              Conciliar sozinho
            </Button>
            <Button icon={<FileUp size={16} />} onClick={() => fileRef.current?.click()}>
              Importar extrato
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.OFX,application/x-ofx,text/plain"
              hidden
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
          </div>
        )}
      </div>

      {data && pending && (
        <KpiStrip
          items={[
            {
              key: 'open',
              label: 'Linhas do extrato para conciliar',
              value: String(data.summary.open),
              sub: `entradas ${brl(data.summary.openIn)} · saídas ${brl(data.summary.openOut)}`,
            },
            {
              key: 'pending',
              label: 'A receber das maquininhas',
              value: brl(pending.totals.pending),
              sub:
                toCents(pending.totals.next7) > 0
                  ? `${brl(pending.totals.next7)} caem nos próximos 7 dias`
                  : `${pending.totals.count} ${pending.totals.count === 1 ? 'repasse' : 'repasses'}`,
            },
            {
              key: 'late',
              label: 'Repasses atrasados',
              value: brl(pending.totals.late),
              danger: toCents(pending.totals.late) > 0,
              sub: toCents(pending.totals.late) > 0 ? 'passaram da data prevista' : 'tudo no prazo',
            },
          ]}
        />
      )}

      <div className="fin-bank">
        <Card title="Extrato do banco" bodyless>
          <div className="cm-card__body">
            <Tabs<typeof filter>
              value={filter}
              onChange={setFilter}
              items={[
                ['open', 'Para conciliar'],
                ['done', 'Conciliadas'],
                ['all', 'Todas'],
              ]}
            />
          </div>
          {!data ? (
            <div className="cm-card__body">
              <Spinner />
            </div>
          ) : data.lines.length === 0 ? (
            <EmptyState
              icon={<Landmark size={20} />}
              title={
                !hasAccounts
                  ? 'Cadastre a conta do banco'
                  : filter === 'open'
                    ? 'Tudo conciliado'
                    : 'Nenhuma linha'
              }
              description={
                !hasAccounts
                  ? 'Depois importe o extrato em OFX (no app ou no site do banco, em Extrato › Exportar › OFX).'
                  : filter === 'open'
                    ? 'Importe o extrato mais recente para conferir o que caiu na conta.'
                    : undefined
              }
            />
          ) : (
            <ul className="fin-lines">
              {data.lines.map((l) => {
                const r = l.reconciliation;
                return (
                  <li key={l.id} className="fin-line">
                    <div className="fin-line__main">
                      <span className="cm-hint">
                        {fmtDate(l.date)}
                        {!accountId && ` · ${l.accountName}`}
                      </span>
                      <strong className="fin-line__desc">{l.description}</strong>
                      {r ? (
                        <span className="cm-hint">
                          <Badge tone={r.kind === 'ignored' ? 'neutral' : 'success'}>
                            {KIND_LABEL[r.kind]}
                          </Badge>{' '}
                          {r.entryDescription ??
                            (r.settlements
                              ?.map(
                                (s) => `${PAYMENT_METHOD_LABELS[s.method]} de ${fmtDate(s.day)}`,
                              )
                              .join(', ') ||
                              r.note ||
                              '')}
                          {r.auto && ' · sozinho'}
                          {toCents(r.difference) !== 0 && (
                            <>
                              {' · diferença '}
                              <SignedBrl value={r.difference} />
                            </>
                          )}
                        </span>
                      ) : l.suggestion ? (
                        <span className="cm-hint">Sugestão: {describe(l.suggestion)}</span>
                      ) : null}
                    </div>
                    <span className="fin-line__amount">
                      <SignedBrl value={l.amount} />
                    </span>
                    {canWrite && (
                      <div className="actions-row fin-line__actions">
                        {r ? (
                          !r.entrySettled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Undo2 size={14} />}
                              loading={busy === l.id}
                              onClick={() => undo(l)}
                            >
                              Desfazer
                            </Button>
                          )
                        ) : (
                          <>
                            {l.suggestion && (
                              <Button
                                size="sm"
                                icon={<Check size={14} />}
                                loading={busy === l.id}
                                onClick={() => confirm(l.suggestion!)}
                              >
                                Confirmar
                              </Button>
                            )}
                            <Button variant="secondary" size="sm" onClick={() => setLineModal(l)}>
                              Conciliar
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="A receber dos caixas" bodyless>
          {!pending ? (
            <div className="cm-card__body">
              <Spinner />
            </div>
          ) : pending.rows.filter((s) => s.method !== 'cash').length === 0 ? (
            <EmptyState
              icon={<Check size={20} />}
              title="Nada a receber"
              description="Cartão, PIX e vale dos caixas fechados aparecem aqui até caírem na conta."
            />
          ) : (
            <ul className="fin-lines">
              {pending.rows
                .filter((s) => s.method !== 'cash')
                .map((s) => (
                  <li key={s.id} className="fin-line">
                    <div className="fin-line__main">
                      <span className="cm-hint">
                        Cai em {fmtDate(s.expectedDate)}
                        {s.late && (
                          <>
                            {' '}
                            <Badge tone="danger">Atrasado</Badge>
                          </>
                        )}
                      </span>
                      <strong>{PAYMENT_METHOD_LABELS[s.method]}</strong>
                      <span className="cm-hint">
                        {s.registerName} · sessão {s.sessionNumber} de {fmtDate(s.day)} · vendido{' '}
                        {brl(s.gross)}, taxa {brl(s.fee)}
                      </span>
                    </div>
                    <span className="fin-line__amount">{brl(s.net)}</span>
                    {canWrite && (
                      <div className="actions-row fin-line__actions">
                        <Button variant="secondary" size="sm" onClick={() => setStModal(s)}>
                          Recebi
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      {newAccount && (
        <AccountModal
          onClose={() => setNewAccount(false)}
          onDone={(a) => {
            setNewAccount(false);
            setAccountId(a.id);
            void load();
          }}
        />
      )}
      {preview && accounts && (
        <ImportModal
          file={preview.file}
          st={preview.st}
          accounts={accounts}
          onClose={() => setPreview(null)}
          onDone={(accId) => {
            setPreview(null);
            setAccountId(accId);
            setFilter('open');
            void load();
          }}
        />
      )}
      {lineModal && (
        <LineModal
          line={lineModal}
          onClose={() => setLineModal(null)}
          onDone={() => {
            setLineModal(null);
            void load();
          }}
        />
      )}
      {stModal && (
        <SettlementModal
          settlement={stModal}
          onClose={() => setStModal(null)}
          onDone={() => {
            setStModal(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function AccountModal({
  onClose,
  onDone,
  initial,
}: {
  onClose(): void;
  onDone(a: BankAccount): void;
  initial?: { name: string; bankId?: string | null; accountRef?: string | null };
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api<BankAccount>('/finance/bank/accounts', {
          method: 'POST',
          json: {
            name: name.trim(),
            bankId: initial?.bankId ?? undefined,
            accountRef: initial?.accountRef ?? undefined,
          },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Nova conta do banco"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Nome da conta"
        placeholder="Ex.: Itaú PJ, Stone, Nubank"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  );
}

function ImportModal({
  file,
  st,
  accounts,
  onClose,
  onDone,
}: {
  file: string;
  st: Statement;
  accounts: BankAccount[];
  onClose(): void;
  onDone(accountId: string): void;
}) {
  const toast = useToast();
  const suggestedName =
    [bankName(st.bankId), st.accountId].filter(Boolean).join(' ') || 'Conta principal';
  const match = accounts.find((a) => a.active && st.accountId && a.accountRef === st.accountId);
  const [accountId, setAccountId] = useState(
    match?.id ?? accounts.find((a) => a.active)?.id ?? 'new',
  );
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = st.lines.map((l) => l.date).sort();
  const sumIn = st.lines.reduce((a, l) => a + Math.max(0, toCents(l.amount)), 0);
  const sumOut = st.lines.reduce((a, l) => a + Math.min(0, toCents(l.amount)), 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let id = accountId;
      if (id === 'new') {
        const a = await api<BankAccount>('/finance/bank/accounts', {
          method: 'POST',
          json: {
            name: name.trim(),
            bankId: st.bankId ?? undefined,
            accountRef: st.accountId ?? undefined,
          },
        });
        id = a.id;
      }
      const r = await api<{ imported: number; duplicates: number; autoMatched: number }>(
        `/finance/bank/accounts/${id}/import`,
        { method: 'POST', json: { lines: st.lines } },
      );
      toast(
        `${r.imported} ${r.imported === 1 ? 'linha importada' : 'linhas importadas'}` +
          (r.duplicates ? `, ${r.duplicates} já estavam` : '') +
          (r.autoMatched ? `; ${r.autoMatched} conciliadas sozinhas` : ''),
        'success',
      );
      onDone(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Importar extrato"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={accountId === 'new' && !name.trim()} onClick={save}>
            Importar {st.lines.length} {st.lines.length === 1 ? 'linha' : 'linhas'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Alert tone="info">
        {file}: de {fmtDate(dates[0]!)} a {fmtDate(dates[dates.length - 1]!)}, entradas{' '}
        {brl(fromCents(sumIn))} e saídas {brl(fromCents(-sumOut))}.
        {st.balance && ` Saldo no banco: ${brl(st.balance.amount)}.`}
      </Alert>
      <SelectField label="Conta" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts
          .filter((a) => a.active)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        <option value="new">Nova conta…</option>
      </SelectField>
      {accountId === 'new' && (
        <TextField
          label="Nome da nova conta"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <p className="cm-hint" style={{ margin: 0 }}>
        Linhas que já foram importadas antes são puladas. Depois de importar, o que bater exatamente
        com os caixas e as contas é conciliado sozinho.
      </p>
    </Modal>
  );
}

type LineMode = 'settlement' | 'entry' | 'create' | 'transfer' | 'ignored';

/** Conciliar uma linha do extrato à mão. */
function LineModal({ line, onClose, onDone }: { line: BankLine; onClose(): void; onDone(): void }) {
  const credit = toCents(line.amount) > 0;
  const [mode, setMode] = useState<LineMode>(
    line.suggestion?.kind === 'entry' ? 'entry' : credit ? 'settlement' : 'create',
  );
  const [c, setC] = useState<Candidates | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    new Set(line.suggestion?.kind === 'settlement' ? line.suggestion.settlementIds : []),
  );
  const [entryId, setEntryId] = useState(
    line.suggestion?.kind === 'entry' ? line.suggestion.entryId : '',
  );
  const [description, setDescription] = useState(line.description.slice(0, 200));
  const [category, setCategory] = useState(
    () =>
      suggestCategory(line.description, toCents(line.amount) < 0 ? 'payable' : 'receivable') ?? '',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Candidates>(`/finance/bank/candidates?day=${line.date}`)
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [line.date]);

  const kind = credit ? 'receivable' : 'payable';
  const entries = (c?.entries ?? []).filter((e) => e.kind === kind);
  const target = (c?.settlements ?? [])
    .filter((s) => picked.has(s.id))
    .reduce((a, s) => a + toCents(s.net), 0);
  const diff = toCents(line.amount) - target;
  const cats = FINANCE_CATEGORIES.filter((x) => x.kind === kind);

  async function save() {
    setBusy(true);
    setError(null);
    const base = { lineIds: [line.id] };
    const json =
      mode === 'settlement'
        ? { ...base, kind: mode, settlementIds: [...picked], note: note.trim() || undefined }
        : mode === 'entry'
          ? { ...base, kind: mode, entryId }
          : mode === 'create'
            ? {
                ...base,
                kind: mode,
                description: description.trim(),
                category: category.trim() || undefined,
              }
            : { ...base, kind: mode, note: note.trim() || undefined };
    try {
      await api('/finance/bank/reconcile', { method: 'POST', json });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ready =
    mode === 'settlement'
      ? picked.size > 0
      : mode === 'entry'
        ? !!entryId
        : mode === 'create'
          ? !!description.trim()
          : note.trim().length === 0 || note.trim().length >= 3;

  return (
    <Modal
      open
      size="lg"
      title={`Conciliar ${fmtDate(line.date)} · ${toCents(line.amount) < 0 ? '−' : '+'}${brl(fromCents(Math.abs(toCents(line.amount))))}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!ready} onClick={save}>
            {mode === 'create' ? 'Criar e conciliar' : 'Conciliar'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="cm-hint" style={{ margin: 0 }}>
        {line.description}
      </p>
      <div className="cm-form__wide">
        <SelectField
          label="O que é esta linha?"
          value={mode}
          onChange={(e) => setMode(e.target.value as LineMode)}
        >
          <option value="settlement">Recebimento de vendas do caixa (cartão, PIX, vale)</option>
          <option value="entry">Uma conta já lançada no financeiro</option>
          <option value="create">Uma despesa ou receita nova (criar o lançamento)</option>
          <option value="transfer">Transferência entre contas ou depósito do caixa</option>
          <option value="ignored">Ignorar (não entra no financeiro)</option>
        </SelectField>
      </div>
      {!c ? (
        <Spinner />
      ) : mode === 'settlement' ? (
        <>
          {c.settlements.length === 0 ? (
            <Alert tone="info">Nenhum recebível dos caixas perto desta data.</Alert>
          ) : (
            <ul className="fin-pick">
              {c.settlements.map((s) => (
                <li key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                    <span>
                      <strong>{PAYMENT_METHOD_LABELS[s.method]}</strong> · {s.registerName} sessão{' '}
                      {s.sessionNumber} de {fmtDate(s.day)}
                      <span className="cm-hint"> · cai em {fmtDate(s.expectedDate)}</span>
                    </span>
                    <span className="fin-pick__amount">{brl(s.net)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {picked.size > 0 && (
            <Alert tone={diff === 0 ? 'info' : 'warning'}>
              Selecionado {brl(fromCents(target))}.{' '}
              {diff === 0 ? (
                'Bate certinho.'
              ) : (
                <>
                  Diferença <SignedBrl value={fromCents(diff)} />: entra no DRE como acerto da taxa
                  da maquininha.
                </>
              )}
            </Alert>
          )}
          {picked.size > 0 && diff !== 0 && (
            <TextField
              label="Observação (opcional)"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </>
      ) : mode === 'entry' ? (
        entries.length === 0 ? (
          <Alert tone="info">
            Nenhuma conta {credit ? 'a receber' : 'a pagar'} perto desta data. Crie o lançamento.
          </Alert>
        ) : (
          <ul className="fin-pick">
            {entries.map((e) => (
              <li key={e.id}>
                <label>
                  <input
                    type="radio"
                    name="entry"
                    checked={entryId === e.id}
                    onChange={() => setEntryId(e.id)}
                  />
                  <span>
                    <strong>{e.description}</strong>
                    <span className="cm-hint">
                      {' · '}
                      {e.status === 'open'
                        ? `vence ${fmtDate(e.dueDate)} (será baixada)`
                        : `paga em ${fmtDate(e.paidAt!)}`}
                    </span>
                  </span>
                  <span
                    className="fin-pick__amount"
                    data-match={toCents(e.amount) === Math.abs(toCents(line.amount)) || undefined}
                  >
                    {brl(e.amount)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )
      ) : mode === 'create' ? (
        <>
          <TextField
            label="Descrição"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField
            label="Categoria"
            list="fin-cats-line"
            value={category}
            maxLength={60}
            hint={`Entra no DRE em: ${DRE_GROUP_LABELS[dreGroupOf(category, kind)]}`}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="fin-cats-line">
            {cats.map((x) => (
              <option key={x.name} value={x.name} />
            ))}
          </datalist>
          <p className="cm-hint" style={{ margin: 0 }}>
            O lançamento nasce {credit ? 'recebido' : 'pago'} em {fmtDate(line.date)}, no valor de{' '}
            {brl(fromCents(Math.abs(toCents(line.amount))))}.
          </p>
        </>
      ) : (
        <TextField
          label="Observação (opcional)"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </Modal>
  );
}

/** Recebível de um caixa: escolher as linhas do extrato em que caiu, ou marcar como recebido. */
function SettlementModal({
  settlement: s,
  onClose,
  onDone,
}: {
  settlement: Settlement;
  onClose(): void;
  onDone(): void;
}) {
  const [c, setC] = useState<Candidates | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(false);
  const [day, setDay] = useState(s.expectedDate > todayIso() ? todayIso() : s.expectedDate);
  const [amount, setAmount] = useState(s.net.replace('.', ','));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Candidates>(`/finance/bank/candidates?day=${s.expectedDate}`)
      .then((r) => {
        setC(r);
        if (!r.lines.some((l) => toCents(l.amount) > 0)) setManual(true);
      })
      .catch((e: Error) => setError(e.message));
  }, [s.expectedDate]);
  const lines = (c?.lines ?? []).filter((l) => toCents(l.amount) > 0);
  const total = lines.filter((l) => picked.has(l.id)).reduce((a, l) => a + toCents(l.amount), 0);
  const parsed = parseBrlInput(amount);
  const diff = manual ? (parsed ? toCents(parsed) - toCents(s.net) : 0) : total - toCents(s.net);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/finance/bank/reconcile', {
        method: 'POST',
        json: manual
          ? { kind: 'manual', settlementIds: [s.id], day, amount: parsed }
          : { kind: 'settlement', settlementIds: [s.id], lineIds: [...picked] },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      size="lg"
      title={`${PAYMENT_METHOD_LABELS[s.method]} · ${brl(s.net)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            disabled={manual ? !parsed || !day : picked.size === 0}
            onClick={save}
          >
            Marcar como recebido
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="cm-hint" style={{ margin: 0 }}>
        {s.registerName} · sessão {s.sessionNumber} de {fmtDate(s.day)}: vendido {brl(s.gross)},
        taxa {brl(s.fee)} ({s.feePercent.replace('.', ',')}%), previsto para{' '}
        {fmtDate(s.expectedDate)}.
      </p>
      <Tabs<'lines' | 'manual'>
        value={manual ? 'manual' : 'lines'}
        onChange={(v) => setManual(v === 'manual')}
        items={[
          ['lines', 'Pelo extrato'],
          ['manual', 'Sem extrato'],
        ]}
      />
      {!c ? (
        <Spinner />
      ) : manual ? (
        <>
          <TextField
            label="Dia em que caiu"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <TextField
            label="Valor que caiu (R$)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amount && !parsed ? 'Valor inválido' : undefined}
          />
        </>
      ) : lines.length === 0 ? (
        <Alert tone="info">Nenhuma entrada do extrato perto desta data. Importe o extrato.</Alert>
      ) : (
        <ul className="fin-pick">
          {lines.map((l) => (
            <li key={l.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(l.id)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(l.id);
                      else n.delete(l.id);
                      return n;
                    })
                  }
                />
                <span>
                  <strong>{l.description}</strong>
                  <span className="cm-hint">
                    {' · '}
                    {fmtDate(l.date)} · {l.accountName}
                  </span>
                </span>
                <span
                  className="fin-pick__amount"
                  data-match={toCents(l.amount) === toCents(s.net) || undefined}
                >
                  {brl(l.amount)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {(manual ? !!parsed : picked.size > 0) && diff !== 0 && (
        <Alert tone="warning">
          Diferença de <SignedBrl value={fromCents(diff)} /> em relação ao previsto: entra no DRE
          como acerto da taxa da maquininha.
        </Alert>
      )}
    </Modal>
  );
}
