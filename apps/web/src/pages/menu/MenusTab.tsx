import type { MenuKind } from '@comandou/shared';
import { BookMarked, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Skeleton,
  TextField,
  useToast,
  HelpScope,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { rowClick } from '../../features/list-view';
import { SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import { useRealtime } from '../../lib/realtime';
import { kindWhere, MENU_KIND, type MenuDef } from './menu-data';
import { IfoodConnectionsBar, useIfoodConnections } from './IfoodConnections';
import { ifoodLabel } from './ifood';
import { MENUS_HELP } from '../../features/help/menu-help';

/** Cardápios do restaurante: o ativo de cada tipo vale nos canais dele. */
export function MenusTab() {
  const canWrite = useCan('catalog:write');
  const toast = useToast();
  const navigate = useNavigate();
  const [menus, setMenus] = useState<MenuDef[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ifood = useIfoodConnections();
  const load = useCallback(async () => {
    try {
      setMenus(await api<MenuDef[]>('/menus'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'menu.changed') void load();
  });

  async function activate(m: MenuDef) {
    try {
      await api(`/menus/${m.id}`, { method: 'PATCH', json: { active: true } });
      toast(
        m.kind === 'ifood'
          ? `${m.name}: envio automático ao iFood ligado`
          : `${m.name} agora vale em ${MENU_KIND[m.kind].where.toLowerCase()}`,
        'success',
      );
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <Card
      title="Cardápios"
      bodyless
      actions={
        canWrite && (
          <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Novo cardápio
          </Button>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="mn-banner">
        O cardápio <strong>Principal</strong> vale no balcão, no salão, no garçom e na mesa. O{' '}
        <strong>Delivery</strong> vale na entrega, na retirada e no cardápio online. Cada um tem os
        seus itens e pode ter preços próprios; sem preço próprio, vale o preço do item. O de{' '}
        <strong>Integração</strong> vai para a sua loja no iFood.
      </p>
      <IfoodConnectionsBar {...ifood} />
      {menus === null ? (
        <div style={{ padding: 16 }}>
          <Skeleton height={100} />
        </div>
      ) : (
        <div className="mn-table-wrap">
          <table className="cm-table cm-table--click">
            <thead>
              <tr>
                <th>Cardápio</th>
                <th className="mn-hide-sm">Vale em</th>
                <th className="cm-num">Itens</th>
                <th>Situação</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {menus.map((m) => (
                <tr
                  key={m.id}
                  {...rowClick(
                    () => navigate(`/cardapio/cardapios/${m.id}`),
                    `/cardapio/cardapios/${m.id}`,
                  )}
                >
                  <td>
                    <button
                      className="mn-item-link"
                      onClick={() => navigate(`/cardapio/cardapios/${m.id}`)}
                    >
                      {m.name}
                    </button>
                    <div className="mn-item-meta">
                      <span>{MENU_KIND[m.kind].label}</span>
                      {m.kind === 'ifood' && m.ifoodMerchantName && (
                        <span>{ifoodLabel({ merchantName: m.ifoodMerchantName })}</span>
                      )}
                      {m.customPrices > 0 && (
                        <span>
                          {m.customPrices}{' '}
                          {m.customPrices === 1 ? 'preço próprio' : 'preços próprios'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="mn-hide-sm">{MENU_KIND[m.kind].where}</td>
                  <td className="cm-num">{m.items}</td>
                  <td>{m.active ? <Badge tone="success">Ativo</Badge> : <Badge>Pausado</Badge>}</td>
                  {canWrite && (
                    <td className="cm-num" style={{ whiteSpace: 'nowrap' }}>
                      {!m.active && (
                        <Button variant="secondary" onClick={() => activate(m)}>
                          Ativar
                        </Button>
                      )}{' '}
                      <Button
                        variant="ghost"
                        onClick={() => navigate(`/cardapio/cardapios/${m.id}`)}
                      >
                        Editar
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewMenuModal
        open={creating}
        menus={menus ?? []}
        ifood={ifood}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          navigate(`/cardapio/cardapios/${id}`);
        }}
      />
    </Card>
  );
}

function NewMenuModal({
  open,
  menus,
  ifood,
  onClose,
  onSaved,
}: {
  open: boolean;
  menus: MenuDef[];
  ifood: ReturnType<typeof useIfoodConnections>;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MenuKind>('delivery');
  const [copyFrom, setCopyFrom] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const freeStores = ifood.list.filter((c) => !c.menuId && c.status === 'connected');
  const kinds = (Object.keys(MENU_KIND) as MenuKind[]).filter(
    (k) => k !== 'ifood' || !!ifood.status?.configured,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName('');
    setCopyFrom('');
    setConnectionId('');
    setError(null);
  }, [open]);
  const isIfood = kind === 'ifood';
  const willPause = !isIfood && menus.some((m) => m.kind === kind && m.active);
  async function save() {
    setBusy(true);
    try {
      const m = await api<{ id: string }>('/menus', {
        method: 'POST',
        json: {
          name: name.trim(),
          kind,
          copyFromId: copyFrom || undefined,
          ifoodConnectionId: isIfood ? connectionId : undefined,
        },
      });
      onSaved(m.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <HelpScope dict={MENUS_HELP}>
      <Modal
        open={open}
        onClose={onClose}
        title="Novo cardápio"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={busy}
              disabled={!name.trim() || (isIfood && !connectionId)}
              onClick={save}
            >
              Criar cardápio
            </Button>
          </>
        }
      >
        <div className="cm-form">
          <TextField
            label="Nome"
            wrapClass="cm-form__wide"
            placeholder="Ex.: Delivery fim de semana"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label="Tipo"
            value={kind}
            onChange={(e) => setKind(e.target.value as MenuKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {MENU_KIND[k].label} ({kindWhere(k)})
              </option>
            ))}
          </SelectField>
          {isIfood && (
            <SelectField
              label="Integração"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
            >
              <option value="">
                {freeStores.length ? 'Escolha a loja do iFood' : 'Ligue uma loja do iFood antes'}
              </option>
              {freeStores.map((c) => (
                <option key={c.id} value={c.id}>
                  {ifoodLabel(c)}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField
            label="Começar com"
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
          >
            <option value="">Todos os itens, no preço do item</option>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                Uma cópia de {m.name}
              </option>
            ))}
          </SelectField>
          {isIfood && (
            <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
              Itens, preços, complementos e disponibilidade deste cardápio vão para o iFood
              sozinhos, a cada alteração. Item que sai do cardápio fica indisponível no iFood.
            </p>
          )}
          {willPause && (
            <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
              <BookMarked size={14} aria-hidden /> Já existe um cardápio {MENU_KIND[kind].label}{' '}
              ativo. O novo começa pausado: quando estiver pronto, toque em Ativar e ele substitui o
              atual.
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </HelpScope>
  );
}
