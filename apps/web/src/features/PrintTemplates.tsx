import { Eye, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Alert, Badge, Button, Card, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { Tabs } from './forms';

type Kind = 'receipt' | 'delivery_slip' | 'kitchen_ticket' | 'fiscal_footer';
interface Template {
  kind: Kind;
  body: string | null;
  updatedAt: string | null;
  default: string;
}

const LABEL: Record<Kind, string> = {
  receipt: 'Conferência de conta',
  delivery_slip: 'Via de entrega',
  kitchen_ticket: 'Comanda da cozinha',
  fiscal_footer: 'Rodapé do cupom fiscal',
};

const HELP: Record<Kind, string> = {
  receipt:
    'Papel que o cliente confere antes de pagar. Não é documento fiscal: você pode mudar tudo.',
  delivery_slip:
    'Vai com o motoboy: cliente, telefone, endereço, itens, quanto cobrar na porta e o troco. Sai pelo botão "Imprimir via de entrega" do pedido.',
  kitchen_ticket: 'Sai em cada setor (cozinha, bar) quando o pedido entra.',
  fiscal_footer:
    'Só o final do cupom da NFC-e é seu (agradecimento, Wi-Fi, redes sociais). O resto do cupom segue o modelo obrigatório da SEFAZ e não muda.',
};

/** Variáveis que cada modelo enxerga, para a cola ao lado do editor. */
const VARS: Record<Kind, [string, string][]> = {
  receipt: [
    ['loja.nome', 'nome do restaurante'],
    ['pedido.numero / pedido.hora', 'número e hora do pedido'],
    ['pedido.local', '"Mesa 7", "Comanda 12" ou o canal'],
    ['pedido.cliente / pedido.telefone', 'cliente'],
    ['pedido.entrega / pedido.endereco', 'é delivery? e o endereço'],
    ['pedido.observacao', 'observação do pedido'],
    [
      'itens (lista)',
      'item.nome, item.quantidade, item.quantidade_formatada (2x ou 0,350kg), item.unidade (un ou kg), item.total_formatado, item.opcoes, item.observacao',
    ],
    ['totais.*', 'subtotal, desconto, acrescimo, entrega, total, falta (+ _formatado)'],
    ['pagamentos (lista)', 'p.forma, p.valor_formatado, p.troco_formatado'],
    ['pedido.cpf_cnpj', 'CPF/CNPJ que o cliente pediu na nota'],
  ],
  delivery_slip: [
    ['loja.nome', 'nome do restaurante'],
    ['pedido.numero / pedido.data', 'número, data e hora completas do pedido'],
    ['pedido.cliente / pedido.telefone / pedido.endereco', 'para quem e onde entregar'],
    ['pedido.cobrar_formatado / pedido.pago', 'quanto cobrar na porta (pago = nada a cobrar)'],
    ['pedido.pagar_na_entrega', 'como o cliente disse que vai pagar'],
    ['pedido.troco_para_formatado / pedido.levar_de_troco_formatado', 'troco'],
    ['pedido.observacao', 'observação do pedido'],
    ['itens (lista)', 'item.nome, item.quantidade_formatada, item.total_formatado, item.opcoes'],
    ['totais.*', 'subtotal, desconto, acrescimo, entrega, total (+ _formatado)'],
    ['pagamentos (lista)', 'p.forma, p.valor_formatado'],
  ],
  kitchen_ticket: [
    ['setor', 'nome do setor (Cozinha, Bar…)'],
    ['pedido.*', 'numero, hora, local, cliente, observacao'],
    ['itens (lista)', 'item.nome, item.quantidade_formatada, item.opcoes, item.observacao'],
  ],
  fiscal_footer: [
    ['loja.nome', 'nome do restaurante'],
    ['nota.numero / nota.serie', 'número e série da NFC-e'],
  ],
};

const FILTERS: [string, string][] = [
  ['{{ valor | dinheiro }}', 'R$ 1.234,50'],
  ['{{ "Total" | linha: valor }}', 'texto à esquerda e valor à direita'],
  ['{{ "texto" | centro }}', 'centraliza na bobina'],
  ['{{ "-" | traco }}', 'linha separadora'],
  ['{{ texto | quebra }}', 'quebra texto longo em linhas'],
  ['{{ item.quantidade | qtd }}', '2,000 → 2'],
];

/**
 * Modelos de impressão em Liquid (a mesma ideia do Jinja): o restaurante muda o que sai na
 * conferência, na via de entrega, na comanda da cozinha e no rodapé do cupom fiscal, com prévia antes de salvar.
 */
export function PrintTemplatesCard() {
  const toast = useToast();
  const areaId = useId();
  const [list, setList] = useState<Template[] | null>(null);
  const [kind, setKind] = useState<Kind>('receipt');
  const [draft, setDraft] = useState<Record<Kind, string>>({
    receipt: '',
    delivery_slip: '',
    kitchen_ticket: '',
    fiscal_footer: '',
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'reset' | null>(null);

  const load = useCallback(async () => {
    const r = await api<Template[]>('/printing/templates');
    setList(r);
    setDraft(
      Object.fromEntries(r.map((t) => [t.kind, t.body ?? t.default])) as Record<Kind, string>,
    );
  }, []);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const cur = list?.find((t) => t.kind === kind);
  const body = draft[kind];

  async function run(what: 'preview' | 'save' | 'reset') {
    setBusy(what);
    setError(null);
    try {
      if (what === 'preview') {
        const r = await api<{ text: string }>('/printing/templates/preview', {
          method: 'POST',
          json: { kind, body },
        });
        setPreview(r.text);
      } else if (what === 'save') {
        await api(`/printing/templates/${kind}`, { method: 'PUT', json: { body } });
        toast('Modelo salvo: as próximas impressões já saem assim', 'success');
        await load();
      } else {
        await api(`/printing/templates/${kind}`, { method: 'DELETE' });
        toast('Voltou para o modelo padrão do Comandou', 'success');
        setPreview(null);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card searchId="secao-modelos" title="Modelos de impressão">
      {list === null ? (
        error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <Skeleton variant="grid" />
        )
      ) : (
        <div className="print-tpl">
          <Tabs
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPreview(null);
              setError(null);
            }}
            items={(Object.keys(LABEL) as Kind[]).map((k) => [k, LABEL[k]])}
          />
          <p className="cm-hint">
            {HELP[kind]}{' '}
            {cur?.body ? <Badge tone="brand">personalizado</Badge> : <Badge>padrão</Badge>}
          </p>
          <div className="print-tpl__grid">
            <div className="cm-field">
              <label className="cm-label" htmlFor={areaId}>
                Modelo
              </label>
              <textarea
                id={areaId}
                className="cm-input print-tpl__area"
                spellCheck={false}
                rows={18}
                maxLength={8000}
                value={body}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value }))}
              />
              <span className="cm-hint">
                Use {'{{ variável }}'} para mostrar um dado e {'{% if %}'} / {'{% for %}'} para
                condições e listas. A bobina tem 42 colunas.
              </span>
            </div>
            <div className="print-tpl__side">
              {preview !== null ? (
                <>
                  <strong>Prévia (último pedido)</strong>
                  <pre className="print-tpl__paper">{preview}</pre>
                </>
              ) : (
                <>
                  <strong>O que dá para usar</strong>
                  <ul className="print-tpl__vars">
                    {VARS[kind].map(([v, d]) => (
                      <li key={v}>
                        <code>{v}</code> <span className="cm-hint">{d}</span>
                      </li>
                    ))}
                  </ul>
                  <strong>Ajudantes</strong>
                  <ul className="print-tpl__vars">
                    {FILTERS.map(([v, d]) => (
                      <li key={v}>
                        <code>{v}</code> <span className="cm-hint">{d}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="actions-row">
            <Button
              variant="secondary"
              icon={<Eye size={16} />}
              loading={busy === 'preview'}
              disabled={!body.trim()}
              onClick={() => void run('preview')}
            >
              Ver prévia
            </Button>
            <Button
              icon={<Save size={16} />}
              loading={busy === 'save'}
              disabled={!body.trim()}
              onClick={() => void run('save')}
            >
              Salvar modelo
            </Button>
            {cur?.body && (
              <Button
                variant="ghost"
                icon={<RotateCcw size={16} />}
                loading={busy === 'reset'}
                onClick={() => void run('reset')}
              >
                Voltar ao padrão
              </Button>
            )}
            {preview !== null && (
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Ver ajuda
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
