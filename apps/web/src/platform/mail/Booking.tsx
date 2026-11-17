import { Copy, ExternalLink, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { CheckField, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { Section, Tag } from '../ui';
import type { BookingPage, Mailbox } from './types';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Endereço público da página: no site (domínio base), não no painel. */
function publicUrl(slug: string) {
  const host = window.location.host.replace(/^admin\./, '');
  return `${window.location.protocol}//${host}/agendar/${slug}`;
}

/** Páginas públicas para marcar horário: quem visita escolhe um horário livre na agenda. */
export function BookingTab({ mailboxes }: { mailboxes: Mailbox[] }) {
  const toast = useToast();
  const pages = useLoad<BookingPage[]>('/platform/mail/booking-pages');
  const [editing, setEditing] = useState<BookingPage | 'new' | null>(null);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado', 'success');
    } catch {
      toast(url);
    }
  };
  return (
    <Section
      title="Páginas de agendamento"
      sub="Mande o link: a pessoa escolhe um horário livre e recebe o convite"
      actions={
        <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditing('new')}>
          Nova página
        </Button>
      }
    >
      {pages.error && <Alert tone="danger">{pages.error}</Alert>}
      {!pages.data ? (
        <Card>
          <Spinner />
        </Card>
      ) : !pages.data.length ? (
        <Card>
          <EmptyState
            title="Nenhuma página ainda"
            description="Crie uma para clientes marcarem uma demonstração ou uma reunião, sem troca de mensagens."
          />
        </Card>
      ) : (
        <Card bodyless>
          <ul className="book__list">
            {pages.data.map((p) => {
              const url = publicUrl(p.slug);
              return (
                <li key={p.id} className="book__row">
                  <div>
                    <strong>{p.title}</strong> {!p.enabled && <Tag level="off">Desligada</Tag>}
                    <div className="cm-hint">
                      {p.durationMin} min ·{' '}
                      {Object.values(p.availability).filter((w) => w.length).length} dias por semana
                      · até {p.daysAhead} dias à frente
                    </div>
                    <div className="book__url">{url}</div>
                  </div>
                  <div className="book__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={14} />}
                      onClick={() => copy(url)}
                    >
                      Copiar link
                    </Button>
                    <a
                      className="cm-btn cm-btn--ghost cm-btn--sm"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} /> Abrir
                    </a>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                      Editar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {editing && (
        <PageForm
          page={editing === 'new' ? null : editing}
          mailboxes={mailboxes.filter((m) => !m.archived)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            pages.reload();
          }}
        />
      )}
    </Section>
  );
}

function PageForm({
  page,
  mailboxes,
  onClose,
  onSaved,
}: {
  page: BookingPage | null;
  mailboxes: Mailbox[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    slug: page?.slug ?? 'demonstracao',
    title: page?.title ?? 'Demonstração do Comandou',
    description:
      page?.description ??
      'Uma conversa rápida para mostrar o sistema funcionando no seu restaurante.',
    location: page?.location ?? '',
    durationMin: String(page?.durationMin ?? 30),
    bufferMin: String(page?.bufferMin ?? 10),
    minNoticeHours: String(page?.minNoticeHours ?? 4),
    daysAhead: String(page?.daysAhead ?? 21),
    mailboxId: page?.mailboxId ?? mailboxes[0]?.id ?? '',
    enabled: page?.enabled ?? true,
  });
  // Janela de cada dia (uma por dia, que é o comum); vazio = sem atendimento.
  const [hours, setHours] = useState<Record<string, { on: boolean; from: string; to: string }>>(
    () =>
      Object.fromEntries(
        DAYS.map((_, i) => {
          const w = page?.availability[String(i)]?.[0];
          const on = page ? !!w : i >= 1 && i <= 5;
          return [String(i), { on, from: w?.[0] ?? '09:00', to: w?.[1] ?? '18:00' }];
        }),
      ),
  );
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      await api(page ? `/platform/mail/booking-pages/${page.id}` : '/platform/mail/booking-pages', {
        method: page ? 'PUT' : 'POST',
        json: {
          slug: f.slug,
          title: f.title,
          description: f.description,
          location: f.location,
          durationMin: Number(f.durationMin) || 30,
          bufferMin: Number(f.bufferMin) || 0,
          minNoticeHours: Number(f.minNoticeHours) || 0,
          daysAhead: Number(f.daysAhead) || 21,
          availability: Object.fromEntries(
            Object.entries(hours).map(([d, h]) => [d, h.on ? [[h.from, h.to]] : []]),
          ),
          timeZone: 'America/Sao_Paulo',
          mailboxId: f.mailboxId || null,
          enabled: f.enabled,
        },
      });
      toast('Página salva', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!page || !window.confirm('Apagar a página? O link deixa de funcionar.')) return;
    setBusy('delete');
    try {
      await api(`/platform/mail/booking-pages/${page.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={page ? 'Editar página de agendamento' : 'Nova página de agendamento'}
      onClose={onClose}
      footer={
        <>
          {page && (
            <Button variant="ghost" onClick={remove} loading={busy === 'delete'} disabled={!!busy}>
              Apagar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Fechar
          </Button>
          <Button type="submit" form="book-page" loading={busy === 'save'} disabled={!!busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="book-page" className="cm-form" onSubmit={save}>
        <TextField label="Título" value={f.title} onChange={set('title')} maxLength={120} />
        <TextField
          label="Endereço"
          hint={publicUrl(f.slug || '...')}
          value={f.slug}
          onChange={(e) =>
            setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })
          }
          maxLength={50}
        />
        <label className="cm-field cm-form__wide">
          <span className="cm-label">Descrição</span>
          <textarea
            className="cm-input"
            rows={2}
            value={f.description}
            onChange={set('description')}
            maxLength={1000}
          />
        </label>
        <TextField
          label="Local ou link da chamada"
          wrapClass="cm-form__wide"
          value={f.location}
          onChange={set('location')}
          maxLength={300}
        />
        <TextField
          label="Duração (minutos)"
          inputMode="numeric"
          value={f.durationMin}
          onChange={set('durationMin')}
        />
        <TextField
          label="Folga depois (minutos)"
          inputMode="numeric"
          value={f.bufferMin}
          onChange={set('bufferMin')}
        />
        <TextField
          label="Antecedência mínima (horas)"
          inputMode="numeric"
          value={f.minNoticeHours}
          onChange={set('minNoticeHours')}
        />
        <TextField
          label="Até quantos dias à frente"
          inputMode="numeric"
          value={f.daysAhead}
          onChange={set('daysAhead')}
        />
        <SelectField label="Confirmação sai de" value={f.mailboxId} onChange={set('mailboxId')}>
          <option value="">Não mandar e-mail</option>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.address}
            </option>
          ))}
        </SelectField>
        <div className="cm-form__block">
          <CheckField
            label="Página no ar"
            checked={f.enabled}
            onChange={(v) => setF({ ...f, enabled: v })}
          />
        </div>
        <h3 className="cm-form__section">Horários de atendimento</h3>
        <div className="book__hours cm-form__wide">
          {DAYS.map((d, i) => {
            const h = hours[String(i)]!;
            const put = (patch: Partial<typeof h>) =>
              setHours({ ...hours, [String(i)]: { ...h, ...patch } });
            return (
              <div key={d} className="book__day">
                <label className="book__day-name">
                  <input
                    type="checkbox"
                    checked={h.on}
                    onChange={(e) => put({ on: e.target.checked })}
                  />{' '}
                  {d}
                </label>
                {h.on ? (
                  <>
                    <input
                      className="cm-input"
                      type="time"
                      aria-label={`${d}: começa`}
                      value={h.from}
                      onChange={(e) => put({ from: e.target.value })}
                    />
                    <span>às</span>
                    <input
                      className="cm-input"
                      type="time"
                      aria-label={`${d}: termina`}
                      value={h.to}
                      onChange={(e) => put({ to: e.target.value })}
                    />
                  </>
                ) : (
                  <span className="cm-hint">Sem atendimento</span>
                )}
              </div>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}
