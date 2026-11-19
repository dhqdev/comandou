import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { useRealtime } from '../../lib/realtime';
import { syncNow, type IfoodSyncState } from './ifood';
import './ifood.css';

const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * "Cardápio no iFood": última sincronização, o resumo dela e o botão para mandar agora.
 * Com o cardápio ativo, cada alteração já vai sozinha; o botão força o envio (e manda as fotos).
 */
export function IfoodSyncCard({
  menuId,
  active,
  canWrite,
  dirty,
}: {
  menuId: string;
  active: boolean;
  canWrite: boolean;
  /** Há alterações na tela que ainda não foram salvas (não vão até salvar). */
  dirty?: boolean;
}) {
  const toast = useToast();
  const [state, setState] = useState<IfoodSyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<IfoodSyncState>(`/ifood/menus/${menuId}/sync`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [menuId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'ifood.sync' && e.menuId === menuId) void load();
  }, load);

  async function sync() {
    setBusy(true);
    try {
      const r = await syncNow(menuId, state?.pendingImages ?? []);
      setState((s) => ({ ...s, ...r }));
      if (r.busy) toast('Já está enviando ao iFood. O resumo atualiza quando terminar.');
      else if (r.status === 'error') toast(r.summary?.errors[0]?.message ?? 'Falhou', 'danger');
      else toast('Cardápio enviado ao iFood', 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const s = state?.summary;
  const running = busy || state?.status === 'running';
  const tone =
    state?.status === 'error' ? 'danger' : state?.status === 'partial' ? 'warning' : 'success';
  const revoked = state?.connectionStatus === 'revoked';

  return (
    <section className="ifd-card" aria-label="Cardápio no iFood">
      <div className="ifd-card__head">
        <div>
          <h2>Cardápio no iFood</h2>
          <p className="cm-hint">
            {running
              ? 'Enviando ao iFood…'
              : state?.syncedAt
                ? `Última sincronização: ${when(state.syncedAt)}`
                : 'Ainda não sincronizado'}
            {state?.merchantName && <> · {state.merchantName}</>}
          </p>
        </div>
        {canWrite && (
          <Button
            loading={running}
            disabled={!state?.connectionId || revoked}
            icon={<RefreshCw size={16} aria-hidden />}
            onClick={sync}
          >
            Sincronizar com o iFood
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!state?.connectionId && state && (
        <Alert tone="warning">Escolha a loja do iFood que recebe este cardápio.</Alert>
      )}
      {revoked && (
        <Alert tone="danger">
          A loja do iFood tirou o acesso do Comandou. Autorize de novo no Portal do Parceiro e ligue
          a loja outra vez em Cardápios.
        </Alert>
      )}
      {(state?.text || dirty || state) && (
        <div className="ifd-card__body">
          {state?.text && <p className={`ifd-summary ifd-summary--${tone}`}>{state.text}</p>}
          {s && s.errors.length > 0 && (
            <>
              <button className="ifd-link" onClick={() => setShowErrors((v) => !v)}>
                {showErrors ? 'Esconder' : 'Ver'} o que não foi ({s.errors.length})
              </button>
              {showErrors && (
                <ul className="ifd-errors">
                  {s.errors.map((e, i) => (
                    <li key={i}>
                      <strong>{e.name}:</strong> {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {(state?.pendingImages?.length ?? 0) > 0 && (
            <p className="cm-hint">
              {state!.pendingImages!.length} foto(s) vão no próximo “Sincronizar com o iFood” (o
              iFood só aceita JPG, e a conversão é feita neste aparelho).
            </p>
          )}
          <p className="cm-hint">
            {dirty
              ? 'Salvando o cardápio; em seguida as alterações vão ao iFood.'
              : active
                ? 'Envio automático ligado: cada alteração em itens, preços, complementos e disponibilidade vai sozinha para o iFood em instantes.'
                : 'Envio automático pausado: só vai ao iFood quando você tocar em Sincronizar.'}
          </p>
        </div>
      )}
    </section>
  );
}
