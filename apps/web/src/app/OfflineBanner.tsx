import { CloudOff, CloudUpload, RefreshCw, TriangleAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Modal } from '../design-system/components';
import { useToast } from '../design-system/toast';
import {
  discardOp,
  flushOutbox,
  OFFLINE_QUEUED_EVENT,
  OFFLINE_SYNCED_EVENT,
  retryOp,
  useOffline,
  type QueuedOp,
} from '../lib/offline';
import './offline-banner.css';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "de hoje às 14:32" ou "de 12/11 às 14:32", para dizer de quando são os dados na tela. */
function savedAt(t: number): string {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  const day = today ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${day} às ${hhmm(t)}`;
}

/**
 * Faixa do modo offline (lib/offline.ts), igual no painel, no garçom e na cozinha:
 *  - sem internet: avisa que o que for salvo fica só no aparelho até a conexão voltar;
 *  - com alterações na fila: quantas faltam subir (e o botão para ver a lista);
 *  - recusadas pelo servidor ao sincronizar: pede revisão.
 */
export function OfflineBanner({ className = 'offline-banner' }: { className?: string }) {
  const s = useOffline();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  // Um aviso por gravação guardada e um quando a fila sobe.
  useEffect(() => {
    const queued = () =>
      toast(
        'Sem internet: salvo neste aparelho. Vai para a nuvem quando a conexão voltar.',
        'neutral',
      );
    const synced = (e: Event) => {
      const n = (e as CustomEvent<{ sent: number }>).detail?.sent ?? 0;
      toast(
        `Conexão de volta: ${n} ${plural(n, 'alteração enviada', 'alterações enviadas')} para a nuvem.`,
        'success',
      );
    };
    window.addEventListener(OFFLINE_QUEUED_EVENT, queued);
    window.addEventListener(OFFLINE_SYNCED_EVENT, synced);
    return () => {
      window.removeEventListener(OFFLINE_QUEUED_EVENT, queued);
      window.removeEventListener(OFFLINE_SYNCED_EVENT, synced);
    };
  }, [toast]);

  const pending = s.pending.length;
  const failed = s.failed.length;
  if (s.online && !pending && !failed) return null;

  let icon = <CloudOff size={14} />;
  let text: string;
  if (!s.online) {
    const why = s.serverDown ? 'Sem conexão com o servidor.' : 'Sem internet.';
    const data = s.cachedAt ? ` Dados guardados ${savedAt(s.cachedAt)}.` : '';
    text = !s.enabled
      ? `${why} A tela volta a atualizar quando a conexão voltar.`
      : pending
        ? `${why} ${pending} ${plural(pending, 'alteração salva', 'alterações salvas')} só neste aparelho: ${plural(pending, 'vai', 'vão')} para a nuvem quando a conexão voltar.${data}`
        : `${why} Pode continuar usando: o que você salvar fica neste aparelho e vai para a nuvem quando a conexão voltar. Pagamentos, caixa e nota fiscal esperam a internet.${data}`;
  } else if (pending) {
    icon = <CloudUpload size={14} />;
    text = s.syncing
      ? `Enviando ${pending} ${plural(pending, 'alteração', 'alterações')} para a nuvem…`
      : `${pending} ${plural(pending, 'alteração salva', 'alterações salvas')} só neste aparelho, esperando o servidor.`;
  } else {
    icon = <TriangleAlert size={14} />;
    text = `${failed} ${plural(failed, 'alteração feita', 'alterações feitas')} sem internet ${plural(failed, 'foi recusada', 'foram recusadas')} pelo servidor. Confira.`;
  }

  return (
    <>
      <div className={`${className} offline-sync`} role="status" data-testid="offline-banner">
        <span className="offline-sync__text">
          {icon} {text}
        </span>
        {(pending > 0 || failed > 0) && (
          <button type="button" className="offline-sync__link" onClick={() => setOpen(true)}>
            Ver {plural(pending + failed, 'item', 'itens')}
          </button>
        )}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Salvo neste aparelho"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              icon={<RefreshCw size={16} />}
              disabled={!s.online || !pending}
              loading={s.syncing}
              onClick={() => void flushOutbox()}
            >
              Enviar agora
            </Button>
          </>
        }
      >
        <p className="offline-sync__hint">
          {s.online
            ? 'Estas alterações foram feitas sem internet e ainda não estão na nuvem.'
            : 'Sem internet agora. Estas alterações estão guardadas aqui e sobem sozinhas quando a conexão voltar. Não limpe os dados do navegador até lá.'}
          {s.lastSyncAt ? ` Último envio para a nuvem às ${hhmm(s.lastSyncAt)}.` : ''}
        </p>
        <ul className="offline-sync__list">
          {[...s.failed, ...s.pending].map((op) => (
            <OpRow key={op.id} op={op} />
          ))}
        </ul>
      </Modal>
    </>
  );
}

function OpRow({ op }: { op: QueuedOp }) {
  const when = hhmm(op.createdAt);
  return (
    <li className={`offline-sync__item ${op.status === 'failed' ? 'is-failed' : ''}`}>
      <div>
        <strong>{op.label}</strong> <span className="offline-sync__when">às {when}</span>
        {op.error && <div className="offline-sync__error">Recusada: {op.error}</div>}
      </div>
      {op.status === 'failed' && (
        <div className="offline-sync__actions">
          <Button size="sm" variant="ghost" onClick={() => void retryOp(op.id)}>
            Tentar de novo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} />}
            aria-label="Descartar"
            onClick={() => {
              if (window.confirm('Descartar esta alteração? Ela não vai para a nuvem.'))
                void discardOp(op.id);
            }}
          />
        </div>
      )}
    </li>
  );
}
