import { waiterLevel } from '@comandou/shared';
import { Copy, ExternalLink, Plus, QrCode, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, EmptyState, Modal, Spinner, TextField, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { WAITER_PATH, waiterLink } from '../app/WaiterEntry';
import { SlideTabs } from '../features/SlideTabs';
import { api } from '../lib/api';
import { brl } from '../lib/money';
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
  todaySales: string;
}

type View = 'active' | 'revoked';

/**
 * Meus garçons (como no Anota AI): ativos e inativos, busca, criar garçom e o link do app para
 * compartilhar com a equipe. Cada garçom mostra o selo atual e os pedidos de hoje.
 */
export function WaitersModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const canTeam = useCan('users:manage');
  const [rows, setRows] = useState<WaiterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
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
            !error && <Spinner />
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
                return (
                  <li key={w.id} className="wt-admin__row">
                    <Seal seal={lv.seal} earned={w.status === 'active'} size={36} />
                    <span className="wt-admin__who">
                      <strong>{w.name}</strong>
                      <span>{w.email}</span>
                      <span>
                        {lv.seal.name} · {w.totalOrders} pedidos no total
                      </span>
                    </span>
                    <span className="wt-admin__today">
                      <strong>{w.todayOrders}</strong>
                      <span>hoje · {brl(w.todaySales)}</span>
                    </span>
                    {canTeam && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatus(w, w.status === 'active' ? 'revoked' : 'active')}
                      >
                        {w.status === 'active' ? 'Desativar' : 'Reativar'}
                      </Button>
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
                {qr ? <img src={qr} alt="QR Code do app do garçom" /> : <Spinner />}
                <figcaption>Aponte a câmera do celular</figcaption>
              </figure>
            )}
          </div>
        </div>
      </Modal>
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
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', password: '' });
      setError(null);
    }
  }, [open]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/users', { method: 'POST', json: { ...form, role: 'waiter' } });
      toast(`${form.name} já pode entrar no app do garçom`, 'success');
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid =
    form.name.trim().length >= 2 && form.email.includes('@') && form.password.length >= 8;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo garçom"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Criar garçom
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <TextField
          label="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          autoComplete="off"
        />
        <TextField
          label="E-mail (login)"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          maxLength={254}
          autoComplete="off"
        />
        <TextField
          label="Senha"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint="Mínimo de 8 caracteres. O garçom pode trocar depois."
          autoComplete="new-password"
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
