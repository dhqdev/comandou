import {
  challengeProgress,
  isPinOnlyEmail,
  WAITER_DAILY_CHALLENGES,
  waiterLevel,
} from '@comandou/shared';
import {
  BarChart3,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  Plus,
  QrCode,
  Search,
  Target,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, EmptyState, Modal, TextField, useToast, Skeleton } from '../design-system';
import { useCan } from '../app/auth';
import { WAITER_PATH, waiterLink } from '../app/WaiterEntry';
import { SlideTabs } from '../features/SlideTabs';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { PinField, PinModal, PinReveal, pinFieldError } from '../features/StaffPin';
import { Seal } from './common';
import './waiter.css';

interface WaiterRow {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'revoked';
  lastSeenAt: string | null;
  totalOrders: number;
  todayOrders: number;
  todayTables: number;
  todaySales: string;
  hasPin?: boolean;
}

type View = 'active' | 'revoked';

/**
 * Meus garçons (como no Anota AI): ativos e inativos, busca, criar garçom e o link do app para
 * compartilhar com a equipe. Cada garçom mostra o selo atual e os pedidos de hoje.
 */
export function WaitersModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const canTeam = useCan('users:manage');
  const canReports = useCan('reports:read');
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<WaiterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pinFor, setPinFor] = useState<WaiterRow | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const link = waiterLink();

  const load = useCallback(async () => {
    try {
      setRows(await api<WaiterRow[]>('/waiters'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(() => {
    if (!showQr || qr) return;
    let alive = true;
    void import('qrcode').then(async ({ default: QRCode }) => {
      const url = await QRCode.toDataURL(link, { margin: 1, width: 320 });
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [showQr, qr, link]);

  const copy = () =>
    navigator.clipboard
      ?.writeText(link)
      .then(() => toast('Link do app copiado', 'success'))
      .catch(() => toast(link));

  async function setStatus(w: WaiterRow, status: View) {
    try {
      await api(`/users/${w.id}`, { method: 'PATCH', json: { status } });
      toast(status === 'active' ? `${w.name} reativado` : `${w.name} desativado`, 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const all = rows ?? [];
  const q = search.trim().toLowerCase();
  const shown = all.filter(
    (w) => w.status === view && (!q || w.name.toLowerCase().includes(q) || w.email.includes(q)),
  );
  const count = (s: View) => all.filter((w) => w.status === s).length;

  return (
    <>
      <Modal
        open={open && !creating}
        onClose={onClose}
        title="Meus garçons"
        size="lg"
        footer={
          <>
            {canReports && (
              <Button
                variant="secondary"
                icon={<BarChart3 size={16} />}
                onClick={() => {
                  onClose();
                  navigate('/relatorios?relatorio=garcons');
                }}
              >
                Ranking
              </Button>
            )}
            <a
              className="cm-btn cm-btn--secondary"
              href={WAITER_PATH}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} /> Abrir o app
            </a>
            {canTeam && (
              <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                Garçom
              </Button>
            )}
          </>
        }
      >
        <div className="wt-admin">
          <SlideTabs<View>
            label="Garçons ativos ou inativos"
            value={view}
            onChange={setView}
            tabs={[
              { value: 'active', label: 'Ativos', count: count('active') },
              { value: 'revoked', label: 'Inativos', count: count('revoked') },
            ]}
          />
          <label className="wt-search">
            <Search size={18} aria-hidden />
            <input
              placeholder="Busque por nome ou e-mail"
              aria-label="Buscar garçom"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          {rows === null ? (
            !error && <Skeleton />
          ) : shown.length === 0 ? (
            <EmptyState
              mascot="joy"
              title={
                all.length === 0
                  ? 'Crie seus garçons para que eles tenham acesso ao sistema'
                  : 'Nenhum garçom aqui'
              }
              description={
                all.length === 0
                  ? 'Cada garçom entra no app com o próprio e-mail e senha e só vê mesas, comandas e o cardápio.'
                  : undefined
              }
              action={
                all.length === 0 &&
                canTeam && (
                  <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                    Criar garçom
                  </Button>
                )
              }
            />
          ) : (
            <ul className="wt-admin__list">
              {shown.map((w) => {
                const lv = waiterLevel(w.totalOrders);
                const day = { orders: w.todayOrders, tables: w.todayTables, sales: w.todaySales };
                const done = WAITER_DAILY_CHALLENGES.filter(
                  (c) => challengeProgress(c, day) >= 1,
                ).length;
                const expanded = openId === w.id;
                return (
                  <li key={w.id} className="wt-admin__item" data-open={expanded || undefined}>
                    <div className="wt-admin__row">
                      <Seal seal={lv.seal} earned={w.status === 'active'} size={36} />
                      <button
                        type="button"
                        className="wt-admin__who"
                        aria-expanded={expanded}
                        aria-controls={`wt-score-${w.id}`}
                        onClick={() => setOpenId(expanded ? null : w.id)}
                      >
                        <strong>{w.name}</strong>
                        <span>{isPinOnlyEmail(w.email) ? 'Entra com PIN' : w.email}</span>
                        <span>
                          {lv.seal.name} · {w.totalOrders} pedidos · desafios hoje {done}/
                          {WAITER_DAILY_CHALLENGES.length}
                        </span>
                      </button>
                      <span className="wt-admin__today">
                        <strong>{w.todayOrders}</strong>
                        <span>hoje · {brl(w.todaySales)}</span>
                      </span>
                      <button
                        type="button"
                        className="wt-admin__toggle"
                        aria-label={expanded ? 'Fechar pontuação' : 'Ver pontuação e desafios'}
                        aria-expanded={expanded}
                        onClick={() => setOpenId(expanded ? null : w.id)}
                      >
                        <ChevronDown size={18} aria-hidden />
                      </button>
                      {canTeam && w.status === 'active' && (
                        <Button variant="ghost" size="sm" onClick={() => setPinFor(w)}>
                          PIN
                        </Button>
                      )}
                      {canTeam && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus(w, w.status === 'active' ? 'revoked' : 'active')}
                        >
                          {w.status === 'active' ? 'Desativar' : 'Reativar'}
                        </Button>
                      )}
                    </div>
                    {expanded && (
                      <div className="wt-admin__score" id={`wt-score-${w.id}`}>
                        <p className="wt-admin__next">
                          {lv.next ? (
                            <>
                              Selo <strong>{lv.seal.name}</strong>. Faltam{' '}
                              <strong>{lv.missing}</strong>{' '}
                              {lv.missing === 1 ? 'pedido' : 'pedidos'} para{' '}
                              <strong>{lv.next.name}</strong>.
                            </>
                          ) : (
                            'Conquistou todos os selos.'
                          )}
                        </p>
                        <span className="wt-bar" aria-hidden>
                          <span style={{ width: `${Math.round(lv.progress * 100)}%` }} />
                        </span>
                        <div className="wt-challenges">
                          {WAITER_DAILY_CHALLENGES.map((c) => {
                            const p = challengeProgress(c, day);
                            const value =
                              c.metric === 'sales'
                                ? `${brl(day.sales)} de ${brl(c.target.toFixed(2))}`
                                : `${day[c.metric]} de ${c.target}`;
                            return (
                              <article
                                key={c.id}
                                className="wt-challenge"
                                data-done={p >= 1 || undefined}
                              >
                                <span className="wt-challenge__icon" aria-hidden>
                                  {p >= 1 ? <CircleCheck size={20} /> : <Target size={20} />}
                                </span>
                                <div className="wt-challenge__body">
                                  <strong>{c.title}</strong>
                                  <span className="wt-bar" aria-hidden>
                                    <span style={{ width: `${Math.round(p * 100)}%` }} />
                                  </span>
                                </div>
                                <span className="wt-challenge__value">{value}</span>
                              </article>
                            );
                          })}
                        </div>
                        <p className="cm-hint">
                          Desafios de hoje. O histórico por período e o ranking ficam em Relatórios
                          › Pontuação e desafios dos garçons.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="wt-share">
            <div>
              <strong>Compartilhe o app</strong>
              <span>Copie o link do app para compartilhar com sua equipe.</span>
              <code>{link}</code>
            </div>
            <div className="wt-share__actions">
              <Button
                variant="secondary"
                icon={<QrCode size={16} />}
                aria-pressed={showQr}
                onClick={() => setShowQr((s) => !s)}
              >
                QR
              </Button>
              <Button icon={<Copy size={16} />} onClick={copy}>
                Copiar
              </Button>
            </div>
            {showQr && (
              <figure className="qr-card wt-share__qr">
                {qr ? <img src={qr} alt="QR Code do app do garçom" /> : <Skeleton variant="qr" />}
                <figcaption>Aponte a câmera do celular</figcaption>
              </figure>
            )}
          </div>
        </div>
      </Modal>
      <PinModal person={pinFor} onClose={() => setPinFor(null)} />
      <NewWaiterModal
        open={open && creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setView('active');
          void load();
        }}
      />
    </>
  );
}

function NewWaiterModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; pin: string } | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setPin('');
      setError(null);
      setCreated(null);
    }
  }, [open]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pin: string }>('/users', {
        method: 'POST',
        json: { name, role: 'waiter', ...(pin ? { pin } : {}) },
      });
      toast(`${name} já pode entrar no app do garçom`, 'success');
      setCreated({ name, pin: r.pin });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid = name.trim().length >= 2 && (!pin || (pin.length === 4 && !pinFieldError(pin)));
  return (
    <Modal
      open={open}
      onClose={created ? onCreated : onClose}
      title={created ? 'Garçom criado' : 'Novo garçom'}
      footer={
        created ? (
          <Button onClick={onCreated}>Pronto</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Voltar
            </Button>
            <Button loading={busy} disabled={!valid} onClick={save}>
              Criar garçom
            </Button>
          </>
        )
      }
    >
      {created ? (
        <PinReveal name={created.name} pin={created.pin} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
          />
          <PinField value={pin} onChange={setPin} />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}
