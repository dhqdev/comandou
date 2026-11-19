import {
  FREIGHT_MODES,
  IE_INDICATORS,
  NFE_PURPOSES,
  PRESENCE,
  formatDocument,
} from '@comandou/shared';
import {
  ArrowLeft,
  Download,
  FileText,
  Mail,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Spinner,
  TextField,
  useToast,
  HelpLabel,
  HelpScope,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { SelectField } from '../../features/forms';
import { StreetHits } from '../../features/StreetHits';
import { api } from '../../lib/api';
import { useCepAutofill } from '../../lib/cep';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type {
  FiscalDocumentDetail,
  FiscalOperation,
  FiscalRecipient,
  FiscalRule,
  FiscalRulesResponse,
} from '../../lib/types';
import {
  CHANNEL_LABEL,
  docTitle,
  FiscalHead,
  fmtDateTime,
  IssueList,
  KIND_LABEL,
  KV,
  PAYMENT_LABEL,
  StatusBadge,
} from './common';
import { DOC_HELP } from '../../features/help/fiscal-help';

const EDITABLE = ['draft', 'rejected', 'error'];
const SOURCE_LABEL: Record<string, string> = {
  product: 'do item',
  ncm: 'pelo NCM',
  default: 'padrão da empresa',
  line: 'escolhido aqui',
  legacy: 'códigos antigos do item',
};

interface CustomerHit {
  id: string;
  name: string;
  phone: string;
  document?: string | null;
}

/** Detalhe da nota: venda, motivo da recusa, destinatário, itens com o padrão fiscal e ações. */
export function DocumentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canEmit = useCan('fiscal:emit');
  const [doc, setDoc] = useState<FiscalDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<FiscalRecipient>({});
  const [op, setOp] = useState<FiscalOperation>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<FiscalRule[]>([]);
  const [modal, setModal] = useState<'cancel' | 'correction' | 'email' | 'discard' | null>(null);

  const apply = (d: FiscalDocumentDetail) => {
    setDoc(d);
    setRec(d.recipient ?? {});
    setOp({
      nature: d.operation?.nature ?? d.nature ?? '',
      purpose: d.operation?.purpose ?? '1',
      presence: d.operation?.presence ?? d.presence ?? '1',
      finalConsumer: d.operation?.finalConsumer ?? true,
      freight: d.operation?.freight ?? '9',
      info: d.operation?.info ?? '',
      referencedKey: d.operation?.referencedKey ?? '',
      lineRules: d.operation?.lineRules ?? {},
    });
    setDirty(false);
  };
  const load = useCallback(async () => {
    try {
      apply(await api<FiscalDocumentDetail>(`/fiscal/documents/${id}?full=1`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
    api<FiscalRulesResponse>('/fiscal/rules')
      .then((r) => setRules(r.rules.filter((x) => x.active)))
      .catch(() => setRules([]));
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    // Não atropela o que está sendo digitado: só recarrega sozinho sem edição pendente.
    if (e.type === 'fiscal.changed' && e.documentId === id && !dirty) reload();
  }, load);

  const editable = !!doc && canEmit && EDITABLE.includes(doc.status);
  const isNfe = doc?.kind === 'nfe';
  const setR = (k: keyof FiscalRecipient, v: string | number | null) => {
    setRec((r) => ({ ...r, [k]: v === '' ? null : v }));
    setDirty(true);
  };
  const setO = <K extends keyof FiscalOperation>(k: K, v: FiscalOperation[K]) => {
    setOp((o) => ({ ...o, [k]: v }));
    setDirty(true);
  };
  const recNumber = useRef<HTMLInputElement>(null);
  const cepFill = useCepAutofill(
    { cep: rec.cep ?? '', street: rec.street ?? '', city: rec.city ?? '', state: rec.state ?? '' },
    (a, from) => {
      setRec((r) => ({
        ...r,
        ...(from === 'street' ? { cep: a.cep } : {}),
        street: (a.street || r.street || null)?.slice(0, 60) ?? null,
        district: (a.district || r.district || null)?.slice(0, 60) ?? null,
        city: (a.city || r.city || null)?.slice(0, 60) ?? null,
        state: a.state || r.state || null,
      }));
      setDirty(true);
      if (a.street) recNumber.current?.focus();
    },
  );

  const patchBody = useMemo(() => {
    const clean = Object.fromEntries(
      Object.entries(rec).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    );
    const operation: FiscalOperation = { lineRules: op.lineRules ?? {} };
    if (isNfe)
      Object.assign(operation, {
        nature: op.nature?.trim() || undefined,
        purpose: op.purpose,
        presence: op.presence,
        finalConsumer: op.finalConsumer,
        freight: op.freight,
        info: op.info?.trim() || null,
        referencedKey: op.referencedKey?.replace(/\D/g, '') || null,
      });
    return { recipient: clean, operation };
  }, [rec, op, isNfe]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  const save = () =>
    run('save', async () => {
      apply(
        await api<FiscalDocumentDetail>(`/fiscal/documents/${id}`, {
          method: 'PATCH',
          json: patchBody,
        }),
      );
      toast('Nota salva', 'success');
    });
  const reissue = () =>
    run('reissue', async () => {
      if (dirty) await api(`/fiscal/documents/${id}`, { method: 'PATCH', json: patchBody });
      const d = await api<FiscalDocumentDetail>(`/fiscal/documents/${id}/reissue`, {
        method: 'POST',
      });
      apply(d);
      if (d.status === 'error') toast('Ainda há o que corrigir: veja os motivos', 'danger');
      else toast(`${KIND_LABEL[d.kind]} enviada para a SEFAZ`, 'success');
    });
  const sync = () =>
    run('sync', async () => {
      await api(`/fiscal/documents/${id}/sync`, { method: 'POST' });
      toast('Consultando a nota', 'success');
      await load();
    });
  const printReceipt = () =>
    run('print', async () => {
      await api(`/fiscal/documents/${id}/print`, { method: 'POST' });
      toast('Cupom enviado para a impressora do caixa', 'success');
    });
  const pickCustomer = (c: CustomerHit) =>
    run('customer', async () => {
      apply(
        await api<FiscalDocumentDetail>(`/fiscal/documents/${id}`, {
          method: 'PATCH',
          json: { customerId: c.id },
        }),
      );
      toast(`Cliente ${c.name} na nota`, 'success');
    });

  if (!doc)
    return error ? (
      <div className="fi-page">
        <Alert tone="danger">{error}</Alert>
      </div>
    ) : (
      <Spinner />
    );

  const listPath = isNfe ? '/fiscal/nfe' : '/fiscal/nfce';
  const o = doc.order;
  const showIssues =
    doc.status !== 'authorized' && doc.status !== 'cancelled' && doc.issues.length > 0;

  return (
    <HelpScope dict={DOC_HELP}>
      <div className="fi-page">
        <FiscalHead
          back={
            <Link to={listPath} className="fi-back">
              <ArrowLeft size={14} /> {KIND_LABEL[doc.kind]}
            </Link>
          }
          title={
            <span className="fi-title">
              {docTitle(doc)} <StatusBadge status={doc.status} />
              {doc.environment === 'homologacao' && <Badge tone="warning">homologação</Badge>}
            </span>
          }
          error={error}
          actions={
            canEmit && (
              <>
                {editable && (
                  <Button
                    variant="secondary"
                    loading={busy === 'save'}
                    disabled={!dirty}
                    onClick={save}
                  >
                    Salvar
                  </Button>
                )}
                {editable && (
                  <Button icon={<Send size={16} />} loading={busy === 'reissue'} onClick={reissue}>
                    {doc.status === 'draft' ? 'Emitir' : 'Reemitir'}
                  </Button>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={16} />}
                    onClick={() => setModal('discard')}
                  >
                    Apagar nota
                  </Button>
                )}
                {(['pending', 'processing', 'cancelling'].includes(doc.status) ||
                  (doc.status === 'authorized' &&
                    doc.contingency &&
                    !doc.contingencySettledAt)) && (
                  <Button
                    variant="ghost"
                    icon={<RefreshCw size={16} />}
                    loading={busy === 'sync'}
                    onClick={sync}
                  >
                    Atualizar
                  </Button>
                )}
                {doc.danfeUrl && ['authorized', 'cancelled'].includes(doc.status) && (
                  <a
                    className="cm-btn cm-btn--secondary"
                    href={doc.danfeUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <FileText size={16} /> {isNfe ? 'DANFE' : 'Cupom (DANFE)'}
                  </a>
                )}
                {!isNfe && canEmit && doc.status === 'authorized' && (
                  <Button
                    variant="ghost"
                    icon={<Printer size={16} />}
                    loading={busy === 'print'}
                    onClick={printReceipt}
                  >
                    Imprimir cupom
                  </Button>
                )}
                {doc.xmlUrl && (
                  <a
                    className="cm-btn cm-btn--ghost"
                    href={doc.xmlUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <Download size={16} /> XML
                  </a>
                )}
                {doc.status === 'authorized' && (
                  <Button
                    variant="ghost"
                    icon={<Mail size={16} />}
                    onClick={() => setModal('email')}
                  >
                    Enviar por e-mail
                  </Button>
                )}
                {doc.status === 'authorized' && isNfe && (
                  <Button variant="ghost" onClick={() => setModal('correction')}>
                    Carta de correção
                  </Button>
                )}
                {doc.status === 'authorized' && !(doc.contingency && !doc.contingencySettledAt) && (
                  <Button
                    variant="ghost"
                    icon={<XCircle size={16} />}
                    onClick={() => setModal('cancel')}
                  >
                    Cancelar nota
                  </Button>
                )}
              </>
            )
          }
        />

        <div className="fi-grid">
          <Card title="Venda">
            {o ? (
              <div className="fi-kvs">
                <KV label="Quando">{fmtDateTime(o.createdAt)}</KV>
                <KV label="Tipo">{CHANNEL_LABEL[o.channel] ?? o.channel}</KV>
                <KV label="Pedido">
                  <Link to={`/pedidos?pedido=${o.id}`}>#{o.number}</Link>
                </KV>
                <KV label="Valor bruto">{brl(o.subtotal)}</KV>
                <KV label="Taxa de entrega">{brl(o.deliveryFee)}</KV>
                <KV label="Taxa de serviço">{brl(o.surcharge)}</KV>
                <KV label="Desconto">{brl(o.discount)}</KV>
                <KV label="Total">{brl(o.total)}</KV>
                <KV label="Recebido">{brl(o.paid)}</KV>
                <KV label="Troco">{brl(o.change)}</KV>
              </div>
            ) : (
              <p className="cm-hint">Pedido não encontrado.</p>
            )}
          </Card>
          <Card title="Nota">
            <div className="fi-kvs">
              <KV label="Modelo">{isNfe ? 'NF-e (55)' : 'NFC-e (65)'}</KV>
              <KV label="Número">
                {doc.number ? `${doc.number} · série ${doc.series ?? '1'}` : '—'}
              </KV>
              <KV label="Ambiente">
                {doc.environment === 'producao' ? 'Produção' : 'Homologação (teste)'}
              </KV>
              <KV label="Tentativas">{doc.attempts}</KV>
              <KV label="Criada">{fmtDateTime(doc.createdAt)}</KV>
              {doc.authorizedAt && <KV label="Autorizada">{fmtDateTime(doc.authorizedAt)}</KV>}
              {doc.protocol && <KV label="Protocolo">{doc.protocol}</KV>}
              {doc.cancelledAt && <KV label="Cancelada">{fmtDateTime(doc.cancelledAt)}</KV>}
              {doc.cancelReason && <KV label="Motivo do cancelamento">{doc.cancelReason}</KV>}
              {doc.discardReason && <KV label="Motivo">{doc.discardReason}</KV>}
            </div>
            {doc.accessKey && (
              <p className="fi-key">
                <span>Chave de acesso</span>
                <code>{doc.accessKey.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')}</code>
              </p>
            )}
            {doc.qrcodeUrl && (
              <a href={doc.qrcodeUrl} target="_blank" rel="noreferrer noopener">
                Consultar na SEFAZ (QR Code)
              </a>
            )}
            {doc.status === 'authorized' && doc.contingency && !doc.contingencySettledAt && (
              <Alert tone="warning">
                Emitida em contingência: a SEFAZ estava fora do ar na hora da venda. O cupom vale
                para o cliente e a Focus NFe envia a nota sozinha quando a SEFAZ voltar (prazo de 24
                horas). Até lá, não dá para cancelar.
              </Alert>
            )}
            {doc.status === 'authorized' && doc.contingency && doc.contingencySettledAt && (
              <Alert tone="info">Emitida em contingência e já recebida pela SEFAZ.</Alert>
            )}
            {doc.lastError && doc.status === 'authorized' && (
              <Alert tone="warning">{doc.lastError}</Alert>
            )}
          </Card>
        </div>

        {showIssues && (
          <IssueList
            issues={doc.issues}
            title={doc.status === 'draft' ? 'O que falta para emitir' : 'Por que foi recusada'}
          />
        )}

        {isNfe && (
          <Card title="Operação">
            <div className="fi-fields">
              <TextField
                label="Natureza da operação"
                value={op.nature ?? ''}
                disabled={!editable}
                maxLength={60}
                onChange={(e) => setO('nature', e.target.value.toUpperCase())}
              />
              <SelectField
                label="Finalidade"
                value={op.purpose ?? '1'}
                disabled={!editable}
                onChange={(e) => setO('purpose', e.target.value as FiscalOperation['purpose'])}
              >
                {NFE_PURPOSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Presença do comprador"
                value={op.presence ?? '1'}
                disabled={!editable}
                onChange={(e) => setO('presence', e.target.value)}
              >
                {/* "4" (entrega a domicílio) é só da NFC-e: a NF-e recusa (rejeição 794). */}
                {PRESENCE.filter(([v]) => v !== '4' || op.presence === '4').map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Consumidor final"
                value={op.finalConsumer === false ? 'no' : 'yes'}
                disabled={!editable}
                onChange={(e) => setO('finalConsumer', e.target.value === 'yes')}
              >
                <option value="yes">Sim (usa o produto)</option>
                <option value="no">Não (revende ou industrializa)</option>
              </SelectField>
              <SelectField
                label="Frete"
                value={op.freight ?? '9'}
                disabled={!editable}
                onChange={(e) => setO('freight', e.target.value)}
              >
                {FREIGHT_MODES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
              <div className="fi-static">
                <HelpLabel as="span">Destino</HelpLabel>
                <strong>{doc.localDestino === '2' ? 'Outro estado' : 'Dentro do estado'}</strong>
              </div>
              {op.purpose && op.purpose !== '1' && (
                <TextField
                  label="Chave da nota referenciada"
                  inputMode="numeric"
                  value={op.referencedKey ?? ''}
                  disabled={!editable}
                  maxLength={54}
                  hint="44 dígitos da nota original (complementar, ajuste ou devolução)."
                  onChange={(e) => setO('referencedKey', e.target.value)}
                />
              )}
            </div>
            <label className="cm-field fi-textarea">
              <HelpLabel as="span">Informações complementares</HelpLabel>
              <textarea
                className="cm-input"
                rows={2}
                maxLength={2000}
                value={op.info ?? ''}
                disabled={!editable}
                onChange={(e) => setO('info', e.target.value)}
                placeholder="Aparece no DANFE (o texto padrão da Configuração vai junto)."
              />
            </label>
          </Card>
        )}

        <Card title="Destinatário">
          {isNfe && editable && <CustomerPicker busy={busy === 'customer'} onPick={pickCustomer} />}
          {!isNfe && (
            <p className="cm-hint fi-note">
              Na NFC-e o CPF é opcional ("CPF na nota?"), mas no delivery a SEFAZ exige CPF/CNPJ e o
              endereço de entrega.
            </p>
          )}
          <div className="fi-fields">
            <TextField
              label="Nome"
              value={rec.name ?? ''}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => setR('name', e.target.value)}
            />
            <TextField
              label="CPF"
              inputMode="numeric"
              value={rec.cpf ? formatDocument(rec.cpf) : ''}
              disabled={!editable || !!rec.cnpj}
              onChange={(e) => setR('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
            />
            <TextField
              label="CNPJ"
              inputMode="numeric"
              value={rec.cnpj ? formatDocument(rec.cnpj) : ''}
              disabled={!editable || !!rec.cpf}
              onChange={(e) => setR('cnpj', e.target.value.replace(/\D/g, '').slice(0, 14))}
            />
            {isNfe && (
              <SelectField
                label="Inscrição estadual"
                value={String(rec.ieIndicator ?? 9)}
                disabled={!editable}
                onChange={(e) => setR('ieIndicator', Number(e.target.value))}
              >
                {IE_INDICATORS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
            )}
            {isNfe && rec.ieIndicator === 1 && (
              <TextField
                label="Número da IE"
                inputMode="numeric"
                value={rec.ie ?? ''}
                disabled={!editable}
                onChange={(e) => setR('ie', e.target.value)}
              />
            )}
            <TextField
              label="CEP"
              inputMode="numeric"
              value={rec.cep ?? ''}
              disabled={!editable}
              hint={editable ? cepFill.cepHint : undefined}
              onChange={(e) => {
                cepFill.cepTyped();
                setR('cep', e.target.value.replace(/\D/g, '').slice(0, 8));
              }}
            />
            <div className="street-field">
              <TextField
                label="Logradouro"
                value={rec.street ?? ''}
                disabled={!editable}
                maxLength={60}
                hint={editable ? cepFill.streetHint : undefined}
                role="combobox"
                aria-expanded={cepFill.open}
                aria-controls="rec-street-hits"
                aria-autocomplete="list"
                onChange={(e) => {
                  cepFill.streetTyped();
                  setR('street', e.target.value);
                }}
                onFocus={() => cepFill.hits.length && cepFill.setOpen(true)}
                onBlur={cepFill.streetLeft}
                onKeyDown={(e) => e.key === 'Escape' && cepFill.setOpen(false)}
              />
              {cepFill.open && editable && (
                <StreetHits id="rec-street-hits" hits={cepFill.hits} onPick={cepFill.pick} />
              )}
            </div>
            <TextField
              ref={recNumber}
              label="Número"
              value={rec.number ?? ''}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => setR('number', e.target.value)}
            />
            <TextField
              label="Complemento"
              value={rec.complement ?? ''}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => setR('complement', e.target.value)}
            />
            <TextField
              label="Bairro"
              value={rec.district ?? ''}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => setR('district', e.target.value)}
            />
            <TextField
              label="Município"
              value={rec.city ?? ''}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => setR('city', e.target.value)}
            />
            <TextField
              label="UF"
              value={rec.state ?? ''}
              disabled={!editable}
              maxLength={2}
              onChange={(e) => setR('state', e.target.value.toUpperCase())}
            />
            {isNfe && (
              <TextField
                label="E-mail"
                type="email"
                value={rec.email ?? ''}
                disabled={!editable}
                onChange={(e) => setR('email', e.target.value)}
              />
            )}
            {isNfe && (
              <TextField
                label="Telefone"
                inputMode="tel"
                value={rec.phone ?? ''}
                disabled={!editable}
                onChange={(e) => setR('phone', e.target.value)}
              />
            )}
          </div>
        </Card>

        <Card title="Itens" bodyless>
          <div className="lv-scroll">
            <table className="cm-table fi-items">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="cm-num">Qtd</th>
                  <th className="cm-num">Unitário</th>
                  <th className="cm-num">Total</th>
                  <th>Padrão fiscal</th>
                  <th>NCM</th>
                  <th>CFOP</th>
                  <th>CST</th>
                  <th className="cm-num">ICMS / IPI / IBS+CBS</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((it) => (
                  <tr key={it.number}>
                    <td>{it.name}</td>
                    <td className="cm-num">{Number(it.quantity).toLocaleString('pt-BR')}</td>
                    <td className="cm-num">{brl(it.unitPrice)}</td>
                    <td className="cm-num">{brl(it.total)}</td>
                    <td>
                      {editable && it.itemId && rules.length > 0 ? (
                        <select
                          className="cm-input fi-rule-select"
                          aria-label={`Padrão fiscal de ${it.name}`}
                          value={op.lineRules?.[it.itemId] ?? ''}
                          onChange={(e) => {
                            const next = { ...(op.lineRules ?? {}) };
                            if (e.target.value) next[it.itemId!] = e.target.value;
                            else delete next[it.itemId!];
                            setO('lineRules', next);
                          }}
                        >
                          <option value="">
                            {it.ruleCode && it.ruleSource !== 'line'
                              ? `Sugerido: ${it.ruleName} (${SOURCE_LABEL[it.ruleSource ?? ''] ?? ''})`
                              : 'Automático'}
                          </option>
                          {rules.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.code} · {r.name}
                            </option>
                          ))}
                        </select>
                      ) : it.ruleCode ? (
                        <span>
                          {it.ruleName}{' '}
                          <span className="cm-hint">
                            ({SOURCE_LABEL[it.ruleSource ?? ''] ?? ''})
                          </span>
                        </span>
                      ) : (
                        <span className="cm-hint">
                          {it.ruleSource === 'legacy' ? 'códigos do item' : 'sem padrão'}
                        </span>
                      )}
                    </td>
                    <td>{it.ncm ?? '—'}</td>
                    <td>{it.cfop}</td>
                    <td>{it.cst}</td>
                    <td className="cm-num fi-taxes">
                      {brl(it.icmsValue)} / {brl(it.ipiValue)} /{' '}
                      {brl(String(Number(it.ibsValue ?? 0) + Number(it.cbsValue ?? 0)))}
                      {it.approxTaxes && (
                        <div className="cm-hint">tributos aprox. {brl(it.approxTaxes)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cm-hint fi-note">
            Impostos vêm do Padrão Fiscal de cada linha e são calculados pelo servidor ao salvar.
          </p>
        </Card>

        <Card title="Totais e pagamento">
          <div className="fi-kvs">
            <KV label="Produtos">{brl(o?.subtotal ?? doc.total)}</KV>
            <KV label="Total da nota">{brl(doc.total)}</KV>
          </div>
          <ul className="fi-pays">
            {doc.payments.map((p, n) => (
              <li key={n}>
                {PAYMENT_LABEL[p.code] ?? `Forma ${p.code}`} — {brl(p.amount)}
              </li>
            ))}
          </ul>
        </Card>

        {doc.events.length > 0 && (
          <Card title="Eventos">
            <ul className="fi-events">
              {doc.events.map((e) => (
                <li key={e.id}>
                  <strong>
                    {e.kind === 'correction' ? `Carta de correção ${e.sequence ?? ''}` : 'E-mail'}
                  </strong>{' '}
                  <Badge
                    tone={e.status === 'authorized' || e.status === 'sent' ? 'success' : 'danger'}
                  >
                    {e.status === 'authorized'
                      ? 'registrada'
                      : e.status === 'sent'
                        ? 'enviado'
                        : 'recusada'}
                  </Badge>{' '}
                  <span className="cm-hint">{fmtDateTime(e.createdAt)}</span>
                  <div>{e.text}</div>
                  {e.sefazMessage && <div className="cm-hint">{e.sefazMessage}</div>}
                  {e.pdfUrl && (
                    <a href={e.pdfUrl} target="_blank" rel="noreferrer noopener">
                      PDF da carta
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {modal === 'cancel' && (
          <TextModal
            title={`Cancelar ${KIND_LABEL[doc.kind]}`}
            label="Justificativa do cancelamento"
            hint={
              isNfe
                ? 'De 15 a 255 caracteres. A NF-e costuma poder ser cancelada em até 24 horas.'
                : 'De 15 a 255 caracteres. A SEFAZ aceita cancelar a NFC-e em até 30 minutos.'
            }
            min={15}
            max={255}
            confirm="Cancelar nota"
            danger
            onClose={() => setModal(null)}
            onConfirm={async (reason) => {
              await api(`/fiscal/documents/${id}/cancel`, { method: 'POST', json: { reason } });
              toast('Nota cancelada', 'success');
              setModal(null);
              await load();
            }}
          />
        )}
        {modal === 'correction' && (
          <TextModal
            title="Carta de correção (CC-e)"
            label="O que corrigir"
            hint="De 15 a 1000 caracteres. Não serve para valores, impostos, quem vende/compra nem datas. Só a última carta vale (até 20 por nota)."
            min={15}
            max={1000}
            multiline
            confirm="Enviar carta"
            onClose={() => setModal(null)}
            onConfirm={async (text) => {
              apply(
                await api<FiscalDocumentDetail>(`/fiscal/documents/${id}/correction`, {
                  method: 'POST',
                  json: { text },
                }),
              );
              toast('Carta de correção registrada', 'success');
              setModal(null);
            }}
          />
        )}
        {modal === 'email' && (
          <TextModal
            title="Enviar DANFE e XML por e-mail"
            label="E-mail"
            initial={rec.email ?? ''}
            min={5}
            max={120}
            confirm="Enviar"
            onClose={() => setModal(null)}
            onConfirm={async (email) => {
              await api(`/fiscal/documents/${id}/email`, {
                method: 'POST',
                json: { emails: email.split(/[,;\s]+/).filter(Boolean) },
              });
              toast('E-mail enviado pela Focus NFe', 'success');
              setModal(null);
              await load();
            }}
          />
        )}
        {modal === 'discard' && (
          <TextModal
            title="Apagar esta nota?"
            label="Motivo (opcional)"
            hint={
              doc.number
                ? `A nota tinha o número ${doc.number}. Se ele não for reaproveitado, inutilize-o em Fiscal → Inutilização.`
                : 'A nota some da lista e a venda fica livre para emitir de novo.'
            }
            min={0}
            max={255}
            confirm="Apagar nota"
            danger
            onClose={() => setModal(null)}
            onConfirm={async (reason) => {
              await api(`/fiscal/documents/${id}/discard`, {
                method: 'POST',
                json: { reason: reason || null },
              });
              toast('Nota apagada', 'success');
              navigate(listPath);
            }}
          />
        )}
      </div>
    </HelpScope>
  );
}

/** Busca o cliente pelo nome, telefone ou CPF/CNPJ e põe na NF-e. */
function CustomerPicker({ onPick, busy }: { onPick: (c: CustomerHit) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ customers: CustomerHit[] }>(`/customers?search=${encodeURIComponent(term)}`)
        .then((r) => setHits(r.customers.slice(0, 6)))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="fi-picker">
      <TextField
        label="Trocar cliente"
        placeholder="Nome, telefone ou CPF/CNPJ"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        hint="Os dados vêm do cadastro do cliente (CPF/CNPJ, IE e endereço)."
      />
      {hits.length > 0 && (
        <ul className="fi-picker__list">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={busy} onClick={() => onPick(c)}>
                <strong>{c.name}</strong>
                <span className="cm-hint">
                  {c.phone}
                  {c.document ? ` · ${formatDocument(c.document)}` : ' · sem CPF/CNPJ'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Modal com um campo de texto e confirmação (cancelar, CC-e, e-mail, apagar). */
function TextModal({
  title,
  label,
  hint,
  min,
  max,
  confirm,
  danger,
  multiline,
  initial = '',
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  confirm: string;
  danger?: boolean;
  multiline?: boolean;
  initial?: string;
  onClose(): void;
  onConfirm(text: string): Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = text.trim().length >= min && text.trim().length <= max;
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={!ok}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(text.trim());
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {multiline ? (
        <label className="cm-field">
          <span className="cm-label">{label}</span>
          <textarea
            className="cm-input"
            rows={4}
            maxLength={max}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {hint && <span className="cm-hint">{hint}</span>}
        </label>
      ) : (
        <TextField
          label={label}
          value={text}
          maxLength={max}
          hint={hint}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
