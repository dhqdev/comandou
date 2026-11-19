import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, useToast } from '../../design-system';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import './ifood.css';

type Field = 'price' | 'status' | 'name' | 'missing';
interface DriftItem {
  localId: string;
  name: string;
  changes: { field: Field; remote: string | null; local: string | null }[];
}
interface RemoteItem {
  id: string;
  name: string;
  categoryName: string;
  price: string;
  available: boolean;
  groups: { id: string; options: unknown[] }[];
}
interface Drift {
  checkedAt: string | null;
  error: string | null;
  changed: DriftItem[];
  onlyRemote: RemoteItem[];
  remoteCount: number;
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('pt-BR', {
    ...(today ? {} : { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** "Preço no iFood R$ 99,90 (aqui R$ 31,00)" e afins. */
function changeText(c: DriftItem['changes'][number]) {
  switch (c.field) {
    case 'price':
      return `Preço no iFood ${brl(c.remote ?? '0')} (aqui ${brl(c.local ?? '0')})`;
    case 'status':
      return c.remote === 'unavailable'
        ? 'Pausado no iFood (aqui está à venda)'
        : 'À venda no iFood (aqui está pausado)';
    case 'name':
      return `Nome no iFood: ${c.remote}`;
    case 'missing':
      return 'Apagado no portal do iFood';
  }
}

/**
 * Conferência do cardápio do iFood: o que mudaram no portal (preço, pausa, nome, item apagado),
 * com "Mandar o do Comandou", e os itens que só existem lá, com "Trazer para o Comandou".
 */
export function IfoodDriftCard({ menuId, canWrite }: { menuId: string; canWrite: boolean }) {
  const toast = useToast();
  const [d, setD] = useState<Drift | null>(null);
  const [busy, setBusy] = useState<null | 'check' | 'resend' | 'import'>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setD(await api<Drift>(`/ifood/menus/${menuId}/drift`));
    } catch {
      /* sem loja ou sem acesso: o cartão do envio já avisa */
    }
  }, [menuId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'ifood.sync' && e.menuId === menuId) void load();
  }, load);

  async function run(kind: 'check' | 'resend' | 'import', fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  const check = () =>
    run('check', async () => {
      setD(await api<Drift>(`/ifood/menus/${menuId}/drift/check`, { method: 'POST', json: {} }));
    });
  const resend = () =>
    run('resend', async () => {
      const r = await api<{ resent: number }>(`/ifood/menus/${menuId}/drift/resend`, {
        method: 'POST',
        json: {},
      });
      toast(
        r.resent === 1
          ? '1 item mandado de novo ao iFood'
          : `${r.resent} itens mandados de novo ao iFood`,
        'success',
      );
      await load();
    });
  const bring = () =>
    run('import', async () => {
      const r = await api<{ imported: number }>(`/ifood/menus/${menuId}/import`, {
        method: 'POST',
        json: { itemIds: [...picked] },
      });
      setPicked(new Set());
      toast(
        `${r.imported === 1 ? '1 item trazido' : `${r.imported} itens trazidos`} para o Comandou. Confira a cozinha de cada um.`,
        'success',
      );
      await load();
    });

  if (!d) return null;
  const only = d.onlyRemote;
  const allPicked = only.length > 0 && only.every((r) => picked.has(r.id));

  return (
    <section className="ifd-card" aria-label="Conferência com o iFood">
      <div className="ifd-card__head">
        <div>
          <h2>Conferência com o portal do iFood</h2>
          <p className="cm-hint">
            {d.checkedAt
              ? `Conferido às ${hhmm(d.checkedAt)} · ${d.remoteCount} itens no iFood`
              : 'Ainda não conferido'}
          </p>
        </div>
        {canWrite && (
          <Button variant="secondary" loading={busy === 'check'} onClick={() => void check()}>
            Conferir agora
          </Button>
        )}
      </div>
      {d.error && <Alert tone="warning">{d.error}</Alert>}
      <div className="ifd-card__body">
        {d.changed.length === 0 ? (
          d.checkedAt &&
          !d.error && (
            <p className="ifd-drift__ok">Nada mudou no portal: o iFood está igual ao Comandou.</p>
          )
        ) : (
          <>
            <p className="ifd-drift__title">
              {d.changed.length === 1
                ? '1 item foi mudado no portal do iFood'
                : `${d.changed.length} itens foram mudados no portal do iFood`}
            </p>
            <ul className="ifd-drift">
              {d.changed.map((c) => (
                <li key={c.localId}>
                  <strong>{c.name}</strong>
                  <span>{c.changes.map(changeText).join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="cm-hint">
              O Comandou manda no cardápio: mude preço, nome e pausa aqui. "Mandar o do Comandou"
              põe de volta no iFood o que está aqui.
            </p>
            {canWrite && (
              <div className="ifd-drift__actions">
                <Button loading={busy === 'resend'} onClick={() => void resend()}>
                  Mandar o do Comandou
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {only.length > 0 && (
        <div className="ifd-card__body">
          <p className="ifd-drift__title">
            {only.length === 1
              ? '1 item só existe no iFood'
              : `${only.length} itens só existem no iFood`}
          </p>
          <p className="cm-hint">
            Foram criados direto no portal. Traga para o Comandou para vender no PDV e receber os
            pedidos já ligados ao cardápio. Vêm com o preço do iFood e os complementos.
          </p>
          {canWrite && (
            <CheckField
              label="Selecionar todos"
              checked={allPicked}
              onChange={(v) => setPicked(v ? new Set(only.map((r) => r.id)) : new Set())}
            />
          )}
          <ul className="ifd-only">
            {only.map((r) => {
              const extras = r.groups.reduce((n, g) => n + g.options.length, 0);
              const desc = [
                r.categoryName,
                brl(r.price),
                extras ? `${extras} complemento${extras > 1 ? 's' : ''}` : null,
                r.available ? null : 'pausado no iFood',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={r.id}>
                  {canWrite ? (
                    <CheckField
                      label={r.name}
                      description={desc}
                      checked={picked.has(r.id)}
                      onChange={(v) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (v) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  ) : (
                    <span>
                      <strong>{r.name}</strong> <span className="cm-hint">{desc}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {canWrite && (
            <div className="ifd-drift__actions">
              <Button
                variant="secondary"
                loading={busy === 'import'}
                disabled={!picked.size}
                onClick={() => void bring()}
              >
                {picked.size ? `Trazer para o Comandou (${picked.size})` : 'Trazer para o Comandou'}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
