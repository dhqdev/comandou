import { toCents } from '@comandou/shared';
import {
  Banknote,
  Bike,
  CheckCircle2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, TextField, useToast } from '../design-system';
import { brl } from '../lib/money';
import type { Delivery } from '../lib/types';
import { minutesSince, PAYMENT_METHOD_LABELS, time } from './format';
import './driver-panel.css';

export interface DriverActions {
  complete(id: string): Promise<unknown>;
  fail(id: string, reason: string): Promise<unknown>;
  location(id: string, lat: number, lng: number): Promise<unknown>;
}

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
const waPhone = (s: string | null) => {
  const d = digits(s);
  return d.length >= 12 ? d : `55${d}`;
};

/** Rota no Google Maps (ou no app de mapas do celular). Usa o ponto do mapa quando existe. */
export function routeUrl(d: Pick<Delivery, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>) {
  const dest =
    d.deliveryLat && d.deliveryLng
      ? `${d.deliveryLat},${d.deliveryLng}`
      : (d.deliveryAddress ?? '');
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}`;
}
export function wazeUrl(d: Pick<Delivery, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>) {
  return d.deliveryLat && d.deliveryLng
    ? `https://waze.com/ul?ll=${d.deliveryLat},${d.deliveryLng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(d.deliveryAddress ?? '')}&navigate=yes`;
}

/**
 * Painel do entregador: feito para o celular, com botões grandes. Mostra as corridas na rua
 * (endereço, rota, contato e quanto cobrar) e as encerradas hoje. Usado pelo entregador com
 * login (tela Entregas) e pelo link do entregador (sem login).
 */
export function DriverPanel({
  deliveries,
  actions,
  onChanged,
}: {
  deliveries: Delivery[];
  actions: DriverActions;
  onChanged(): void;
}) {
  const out = deliveries.filter((d) => d.status === 'out');
  const done = deliveries.filter((d) => d.status !== 'out');
  const sharing = useShareLocation(out, actions);
  return (
    <div className="driver">
      <div className="driver__share" data-on={sharing.on || undefined}>
        <LocateFixed size={20} />
        <div>
          <strong>{sharing.on ? 'Localização ligada' : 'Localização desligada'}</strong>
          <span className="cm-hint">
            {sharing.on
              ? sharing.last
                ? `Última enviada às ${time(sharing.last)}. O cliente acompanha pelo link.`
                : 'Enviando…'
              : 'Ligue para o cliente acompanhar você no mapa.'}
          </span>
        </div>
        <Button
          variant={sharing.on ? 'secondary' : 'primary'}
          size="sm"
          onClick={sharing.toggle}
          disabled={!out.length && !sharing.on}
        >
          {sharing.on ? 'Desligar' : 'Ligar'}
        </Button>
      </div>
      {sharing.error && <p className="form-error">{sharing.error}</p>}

      <h2 className="driver__title">
        <Bike size={18} /> Na rua ({out.length})
      </h2>
      {out.length === 0 ? (
        <EmptyState
          mascot
          title="Nenhuma entrega com você agora"
          description="Quando o restaurante despachar um pedido para você, ele aparece aqui."
        />
      ) : (
        out.map((d) => <RunCard key={d.id} d={d} actions={actions} onChanged={onChanged} />)
      )}

      {done.length > 0 && (
        <>
          <h2 className="driver__title">Encerradas hoje ({done.length})</h2>
          <ul className="driver__done">
            {done.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>#{d.orderNumber}</strong> {d.customerName}
                </span>
                {d.status === 'delivered' ? (
                  <Badge tone="success">Entregue {d.finishedAt && time(d.finishedAt)}</Badge>
                ) : (
                  <Badge tone="danger">Não entregue</Badge>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RunCard({
  d,
  actions,
  onChanged,
}: {
  d: Delivery;
  actions: DriverActions;
  onChanged(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const toCollect = d.paymentStatus !== 'paid' && toCents(d.balance) > 0;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="run" data-search-id={`entrega-${d.id}`}>
      <header className="run__top">
        <strong className="run__num">#{d.orderNumber}</strong>
        <span className="cm-hint">
          saiu {time(d.dispatchedAt)} · {minutesSince(d.dispatchedAt)} min
        </span>
      </header>
      <div className="run__who">
        <strong>{d.customerName ?? 'Cliente'}</strong>
        {d.customerPhone && <span className="cm-hint">{d.customerPhone}</span>}
      </div>
      <a className="run__addr" href={routeUrl(d)} target="_blank" rel="noreferrer">
        <MapPin size={18} />
        <span>{d.deliveryAddress ?? 'Endereço não informado'}</span>
      </a>
      {d.notes && <p className="run__notes">Obs.: {d.notes}</p>}
      <div className={`run__pay ${toCollect ? 'is-due' : ''}`}>
        <Banknote size={18} />
        {toCollect ? (
          <span>
            Cobrar <strong>{brl(d.balance)}</strong>
            {d.paymentHint &&
              ` · ${PAYMENT_METHOD_LABELS[d.paymentHint as keyof typeof PAYMENT_METHOD_LABELS] ?? d.paymentHint}`}
            {d.changeFor && ` · troco para ${brl(d.changeFor)}`}
          </span>
        ) : (
          <span>Já está pago · {brl(d.total)}</span>
        )}
      </div>
      <div className="run__links">
        <a className="cm-btn cm-btn--secondary" href={routeUrl(d)} target="_blank" rel="noreferrer">
          <Navigation size={16} /> Rota
        </a>
        <a className="cm-btn cm-btn--secondary" href={wazeUrl(d)} target="_blank" rel="noreferrer">
          Waze
        </a>
        {d.customerPhone && (
          <>
            <a
              className="cm-btn cm-btn--secondary"
              href={`tel:${digits(d.customerPhone)}`}
              aria-label="Ligar para o cliente"
            >
              <Phone size={16} />
            </a>
            <a
              className="cm-btn cm-btn--secondary"
              href={`https://wa.me/${waPhone(d.customerPhone)}`}
              target="_blank"
              rel="noreferrer"
              aria-label="WhatsApp do cliente"
            >
              <MessageCircle size={16} />
            </a>
          </>
        )}
      </div>
      {failing ? (
        <div className="inline-form">
          <TextField
            label="Por que não foi entregue?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente ausente, endereço errado"
          />
          <div className="run__actions">
            <Button variant="secondary" size="lg" onClick={() => setFailing(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => run(() => actions.fail(d.id, reason.trim()), 'Avisamos o restaurante')}
            >
              Confirmar
            </Button>
          </div>
        </div>
      ) : (
        <div className="run__actions">
          <Button
            variant="secondary"
            size="lg"
            icon={<XCircle size={18} />}
            onClick={() => setFailing(true)}
          >
            Não consegui
          </Button>
          <Button
            variant="success"
            size="lg"
            loading={busy}
            icon={<CheckCircle2 size={18} />}
            onClick={() => run(() => actions.complete(d.id), 'Entrega concluída')}
          >
            Entreguei
          </Button>
        </div>
      )}
    </article>
  );
}

/**
 * Envia a posição do celular a cada ~30 s para as corridas na rua, enquanto a tela estiver
 * aberta. Fica ligado entre visitas (lembrado no aparelho).
 */
function useShareLocation(out: Delivery[], actions: DriverActions) {
  const KEY = 'cm-driver-share';
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = out.map((d) => d.id).join(',');
  const ref = useRef({ ids, actions });
  ref.current = { ids, actions };

  useEffect(() => {
    if (!on || !ids) return;
    if (!navigator.geolocation) {
      setError('Este aparelho não informa a localização.');
      return;
    }
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent < 30_000) return;
        lastSent = Date.now();
        setError(null);
        const list = ref.current.ids.split(',').filter(Boolean);
        void Promise.all(
          list.map((id) => ref.current.actions.location(id, p.coords.latitude, p.coords.longitude)),
        )
          .then(() => setLast(new Date().toISOString()))
          .catch(() => undefined);
      },
      () => setError('Permita o acesso à localização nas configurações do navegador.'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on, ids]);

  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? '0' : '1');
      } catch {
        /* sem armazenamento: vale só agora */
      }
      return !v;
    });
  return { on, last, error, toggle };
}
