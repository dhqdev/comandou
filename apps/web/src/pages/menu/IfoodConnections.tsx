import { ExternalLink, Plug, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Modal, TextField, useToast } from '../../design-system';
import { useCan } from '../../app/auth';
import { api } from '../../lib/api';
import { SelectField } from '../../features/forms';
import { ifoodLabel, type IfoodConnection, type IfoodStatus } from './ifood';
import type { MenuDef } from './menu-data';
import './ifood.css';

/** Lojas do iFood do restaurante (e o carregamento usado pelo modal de novo cardápio). */
export function useIfoodConnections() {
  const [status, setStatus] = useState<IfoodStatus | null>(null);
  const [list, setList] = useState<IfoodConnection[]>([]);
  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        api<IfoodStatus>('/ifood/status'),
        api<IfoodConnection[]>('/ifood/connections'),
      ]);
      setStatus(s);
      setList(l);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { status, list, reload: load };
}

/** Faixa em Cardápios: lojas do iFood ligadas e o botão para ligar outra. */
export function IfoodConnectionsBar({
  status,
  list,
  reload,
}: ReturnType<typeof useIfoodConnections>) {
  const canManage = useCan('settings:manage');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!status) return null;

  async function remove(c: IfoodConnection) {
    if (
      !window.confirm(
        `Desligar ${c.merchantName}? O cardápio do iFood para de enviar (nada é apagado no iFood).`,
      )
    )
      return;
    try {
      await api(`/ifood/connections/${c.id}`, { method: 'DELETE' });
      toast('Loja do iFood desligada', 'success');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="ifd-bar">
      <div className="ifd-bar__text">
        <strong>Integração com o iFood</strong>
        {!status.configured ? (
          <span className="cm-hint">
            Ainda não está liberada neste servidor. Fale com o suporte do Comandou para ativar.
          </span>
        ) : list.length ? (
          <span className="ifd-bar__list">
            {list.map((c) => (
              <span key={c.id} className="ifd-chip">
                {c.merchantName}
                {c.status === 'revoked' ? (
                  <Badge tone="danger">Sem acesso</Badge>
                ) : c.menuId ? (
                  <Badge tone="success">Com cardápio</Badge>
                ) : (
                  <Badge>Sem cardápio</Badge>
                )}
                {canManage && (
                  <button
                    className="ifd-chip__x"
                    aria-label={`Desligar ${c.merchantName}`}
                    onClick={() => remove(c)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </span>
            ))}
          </span>
        ) : (
          <span className="cm-hint">
            Ligue a sua loja do iFood e crie um cardápio do tipo Integração: o Comandou manda itens,
            preços, complementos e disponibilidade para o iFood conforme você edita.
          </span>
        )}
      </div>
      {status.configured && canManage && (
        <Button
          variant="secondary"
          icon={<Plug size={16} aria-hidden />}
          onClick={() => setOpen(true)}
        >
          Ligar loja do iFood
        </Button>
      )}
      <ConnectModal
        open={open}
        mode={status.mode}
        onClose={() => setOpen(false)}
        onDone={async () => {
          setOpen(false);
          await reload();
        }}
      />
    </div>
  );
}

function ConnectModal({
  open,
  mode,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: IfoodStatus['mode'];
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [merchantId, setMerchantId] = useState('');
  const [code, setCode] = useState<{ userCode: string; verificationUrl: string } | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMerchantId('');
    setAuthCode('');
    setCode(null);
    setError(null);
  }, [open]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const connect = () =>
    run(async () => {
      const c = await api<{ merchantName: string }>('/ifood/connections', {
        method: 'POST',
        json: { merchantId: merchantId.trim() },
      });
      toast(`${c.merchantName} ligada`, 'success');
      onDone();
    });
  const startCode = () =>
    run(async () => {
      setCode(
        await api<{ userCode: string; verificationUrl: string }>('/ifood/connections/authorize', {
          method: 'POST',
        }),
      );
    });
  const confirm = () =>
    run(async () => {
      await api('/ifood/connections/confirm', {
        method: 'POST',
        json: { authorizationCode: authCode.trim() },
      });
      toast('Loja do iFood ligada', 'success');
      onDone();
    });

  const footer =
    mode === 'centralized' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button loading={busy} disabled={merchantId.trim().length < 8} onClick={connect}>
          Ligar loja
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        {code ? (
          <Button loading={busy} disabled={authCode.trim().length < 4} onClick={confirm}>
            Ligar loja
          </Button>
        ) : (
          <Button loading={busy} onClick={startCode}>
            Gerar código
          </Button>
        )}
      </>
    );

  return (
    <Modal open={open} onClose={onClose} title="Ligar loja do iFood" footer={footer}>
      <div className="cm-form">
        {mode === 'centralized' ? (
          <>
            <ol className="ifd-steps cm-form__wide">
              <li>
                No{' '}
                <a href="https://portal.ifood.com.br" target="_blank" rel="noreferrer">
                  Portal do Parceiro <ExternalLink size={12} aria-hidden />
                </a>
                , autorize o aplicativo do Comandou para a sua loja.
              </li>
              <li>Copie o id da loja (aparece em Perfil da loja ou no link da loja no iFood).</li>
              <li>Cole aqui e toque em Ligar loja.</li>
            </ol>
            <TextField
              label="Id da loja no iFood"
              wrapClass="cm-form__wide"
              placeholder="Ex.: 1a2b3c4d-1234-5678-9abc-def012345678"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
          </>
        ) : code ? (
          <>
            <p className="cm-form__wide" style={{ margin: 0 }}>
              Abra o{' '}
              <a href={code.verificationUrl} target="_blank" rel="noreferrer">
                Portal do Parceiro <ExternalLink size={12} aria-hidden />
              </a>
              , entre com a conta da loja e digite o código:
            </p>
            <p className="ifd-code cm-form__wide">{code.userCode}</p>
            <TextField
              label="Código de autorização que o iFood mostrou"
              wrapClass="cm-form__wide"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
            />
            <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
              O código vale 10 minutos. Se vencer, feche e gere outro.
            </p>
          </>
        ) : (
          <p className="cm-form__wide" style={{ margin: 0 }}>
            O Comandou gera um código; você autoriza a loja no Portal do Parceiro do iFood e cola
            aqui o código de autorização que o iFood mostrar.
          </p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Campo "Integração" do cardápio do iFood: qual loja recebe (trocar recomeça o envio). */
export function IfoodConnectionField({
  menu,
  disabled,
  onChange,
}: {
  menu: MenuDef;
  disabled?: boolean;
  onChange(c: Pick<MenuDef, 'ifoodConnectionId' | 'ifoodMerchantName'>): void;
}) {
  const { list } = useIfoodConnections();
  const toast = useToast();
  const free = list.filter((c) => !c.menuId || c.menuId === menu.id);
  async function pick(id: string) {
    if (
      menu.ifoodConnectionId &&
      !window.confirm('Trocar a loja do iFood? O cardápio será enviado inteiro para a nova loja.')
    )
      return;
    try {
      await api(`/menus/${menu.id}`, { method: 'PATCH', json: { ifoodConnectionId: id } });
      const c = list.find((x) => x.id === id);
      onChange({ ifoodConnectionId: id, ifoodMerchantName: c?.merchantName ?? null });
      toast('Loja do iFood trocada', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  return (
    <SelectField
      label="Integração"
      value={menu.ifoodConnectionId ?? ''}
      disabled={disabled}
      onChange={(e) => void pick(e.target.value)}
    >
      {!menu.ifoodConnectionId && <option value="">Escolha a loja do iFood</option>}
      {free.map((c) => (
        <option key={c.id} value={c.id}>
          {ifoodLabel(c)}
        </option>
      ))}
    </SelectField>
  );
}
