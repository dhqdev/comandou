import { FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Modal, TextField, HelpScope } from '../../design-system';
import { SelectField } from '../../features/forms';
import { CATEGORY_HELP } from '../../features/help/menu-help';
import { api, type Category } from '../../lib/api';
import type { Sector } from '../../lib/types';

/** Ícones prontos para a categoria (aparecem no lugar da foto). */
// prettier-ignore
export const CATEGORY_ICONS = [
  '🍕', '🍔', '🌮', '🌯', '🥪', '🌭', '🥙', '🍗', '🥩', '🍖',
  '🥓', '🍣', '🍤', '🦑', '🍝', '🍜', '🍛', '🍚', '🍱', '🥗',
  '🥤', '🧃', '🍺', '🧋', '☕', '🥛', '🍷', '🍹', '🍰', '🎂',
  '🧁', '🍫', '🍦', '🍩', '🍪', '🍿', '🥧', '🥐', '🥨', '🥦',
  '🍅', '🍟', '🥟', '🍳', '⭐', '🔥', '✨', '❤️', '🎯', '🏠',
];

/** Ícone da categoria (ou uma pasta, quando não tem). */
export const categoryIcon = (c: Pick<Category, 'icon'> | null | undefined) => c?.icon || '📂';

/** Nova categoria ou editar uma: nome, ícone e cozinha (KDS) dos itens dela. */
export function CategoryModal({
  open,
  category,
  sectors,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Com categoria, edita; sem, cria. */
  category?: Category | null;
  sectors: Sector[];
  onClose(): void;
  onSaved(c: Category): void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? null);
    setSectorId(category?.sectorId ?? '');
    setError(null);
  }, [open, category]);
  const sectorChanged = !!category && (category.sectorId ?? '') !== sectorId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const json = { name: name.trim(), icon, sectorId: sectorId || null };
      const c = category
        ? await api<Category>(`/categories/${category.id}`, { method: 'PATCH', json })
        : await api<Category>('/categories', { method: 'POST', json });
      onSaved(c);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HelpScope dict={CATEGORY_HELP}>
      <Modal
        open={open}
        title={category ? 'Editar categoria' : 'Nova categoria'}
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="categoria-form" loading={busy} disabled={!name.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="categoria-form" onSubmit={submit} className="mn-cat-form">
          <div className="mn-cat-form__name">
            <span className="mn-cat-form__icon" aria-hidden>
              {categoryIcon({ icon })}
            </span>
            <TextField
              label="Nome"
              placeholder="Nome da categoria"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </div>
          <fieldset className="mn-icons">
            <legend>Escolha um ícone</legend>
            {CATEGORY_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                className="mn-icons__btn"
                aria-label={`Ícone ${i}`}
                aria-pressed={icon === i}
                onClick={() => setIcon(icon === i ? null : i)}
              >
                {i}
              </button>
            ))}
          </fieldset>
          <SelectField
            label="Cozinha (KDS)"
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
          >
            <option value="">Nenhuma</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          {sectorChanged && (
            <p className="cm-hint" style={{ margin: 0 }}>
              Todos os itens desta categoria passam a ir para{' '}
              {sectors.find((s) => s.id === sectorId)?.name ?? 'nenhuma cozinha'}.
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Modal>
    </HelpScope>
  );
}
