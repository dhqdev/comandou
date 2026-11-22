import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Modal, TextField, useToast } from '../../design-system';
import { fmtQty, parseQtyInput } from '../../features/forms';
import { api, type Product, type ProductAvailability } from '../../lib/api';

/**
 * Quantidade em estoque do item do cardápio. O número mora no Estoque (ficha técnica):
 * item sem ficha ganha o controle simples (insumo com o nome do item, 1 por venda) e item com
 * ficha "1 por venda" tem esse insumo contado (`PUT /stock/products/:id/quantity`). Ficha com
 * vários insumos não tem número para digitar: mostra quanto dá para fazer com o que tem.
 */

/** Saldo do insumo do controle simples ("12.000"), ou null quando a ficha não é direta. */
export function directQty(stock?: ProductAvailability): string | null {
  return stock?.direct ? (stock.lines[0]?.have ?? null) : null;
}

/** Texto curto da quantidade: "24", "12,5 kg", "Sem limite" ou null (não controla). */
export function stockLabel(p: Product, stock?: ProductAvailability): string | null {
  if (!stock) return null;
  const have = directQty(stock);
  if (have !== null) {
    const n = have.startsWith('-') ? '0' : fmtQty(have);
    return p.soldByWeight ? `${n} kg` : n;
  }
  return stock.portions === null ? 'Sem limite' : String(stock.portions);
}

/** Célula da coluna Estoque da lista de itens. */
export function StockCell({
  p,
  stock,
  canEdit,
  onEdit,
}: {
  p: Product;
  stock?: ProductAvailability;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const label = stockLabel(p, stock);
  const tone =
    stock?.out || stock?.portions === 0
      ? 'mn-stock--out'
      : stock?.portions !== null && stock?.portions !== undefined && stock.portions <= 5
        ? 'mn-stock--low'
        : '';
  const unit = !p.soldByWeight && label && label !== 'Sem limite' ? 'un.' : '';
  const hint = stock && !stock.direct ? 'pela ficha' : '';
  if (!label)
    return canEdit ? (
      <button
        type="button"
        className="mn-stock mn-stock--set"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        Informar
      </button>
    ) : (
      <span className="mn-stock mn-stock--none">Não controla</span>
    );
  const body = (
    <>
      <span className="mn-stock__n">{label}</span>
      {unit && <span className="mn-stock__u"> {unit}</span>}
      {hint && <span className="mn-stock__hint">{hint}</span>}
    </>
  );
  return canEdit && stock?.direct ? (
    <button
      type="button"
      className={`mn-stock mn-stock--edit ${tone}`}
      title="Mudar a quantidade em estoque"
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {body}
    </button>
  ) : (
    <span className={`mn-stock ${tone}`}>{body}</span>
  );
}

/** Janela "Quantidade em estoque": conta o insumo do item ou cria o controle simples. */
export function StockQtyModal({
  product,
  stock,
  onClose,
  onSaved,
}: {
  product: Product | null;
  stock?: ProductAvailability;
  onClose: () => void;
  onSaved: (a: ProductAvailability) => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!product) return;
    const have = directQty(stock);
    setValue(have !== null && !have.startsWith('-') ? fmtQty(have) : '');
    setError(null);
    // Só ao abrir: a quantidade pode mudar por venda enquanto a pessoa digita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);
  const composite = !!stock && !stock.direct;
  const quantity = parseQtyInput(value);
  const fraction = !!quantity && !product?.soldByWeight && !/^\d+(\.0+)?$/.test(quantity);
  async function save() {
    if (!product || !quantity || fraction) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api<ProductAvailability>(`/stock/products/${product.id}/quantity`, {
        method: 'PUT',
        json: { quantity },
      });
      onSaved(a);
      toast('Estoque atualizado', 'success');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!product}
      title="Quantidade em estoque"
      onClose={onClose}
      footer={
        composite ? (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={!quantity || fraction} onClick={save}>
              Salvar
            </Button>
          </>
        )
      }
    >
      {product && composite ? (
        <p className="cm-hint" style={{ margin: 0 }}>
          {product.name} usa uma ficha técnica com {stock!.lines.length} insumos: a quantidade sai
          deles ({stock!.portions === null ? 'sem limite' : `dá para vender ${stock!.portions}`}).
          Ajuste o saldo dos insumos em <Link to="/estoque">Estoque</Link>.
        </p>
      ) : (
        product && (
          <form
            className="mn-stock-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {error && <Alert tone="danger">{error}</Alert>}
            <TextField
              label={`Quanto tem agora de ${product.name}${product.soldByWeight ? ' (kg)' : ''}`}
              inputMode={product.soldByWeight ? 'decimal' : 'numeric'}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              error={
                value && !quantity
                  ? 'Use um número, como 24'
                  : fraction
                    ? 'Item vendido por unidade: use um número inteiro'
                    : undefined
              }
            />
            <p className="cm-hint" style={{ margin: 0 }}>
              Cada venda baixa {product.soldByWeight ? 'o peso vendido' : '1'}. Quando chegar a
              zero, o item sai do cardápio sozinho e volta quando você informar mais.
              {!stock && ' O controle fica no Estoque, com o nome do item.'}
            </p>
          </form>
        )
      )}
    </Modal>
  );
}
