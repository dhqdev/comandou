import { Eye } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../app/auth';
import type { CourierEarningsData } from '../features/CourierEarnings';
import { DriverPanel } from '../features/DriverPanel';
import type { DriverData, HistoryPage } from '../features/DriverTabs';
import { api } from '../lib/api';
import type { AvailableRun, CourierProfile, Delivery } from '../lib/types';
import { DriverShell, usePolling } from './DriverShell';

interface Preview {
  courier: { name: string };
  deliveries: Delivery[];
  store: { lat: number; lng: number } | null;
  available: AvailableRun[];
  profile: CourierProfile;
  earnings: CourierEarningsData;
}

/** Resposta das ações na prévia: quem pega e conclui corrida é o entregador, no app dele. */
const READ_ONLY =
  'Na prévia é só para ver: quem pega e conclui a corrida é o entregador, no app dele.';
const refuse = () => Promise.reject(new Error(READ_ONLY));

/**
 * Prévia do app do entregador para o administrador (Equipe › Abrir, /equipe/:id/app): a mesma
 * tela que a pessoa vê, com as corridas, os pedidos disponíveis, o histórico, o perfil e os ganhos
 * dela, sem sair da conta do administrador. Só leitura: não manda GPS, não pega nem conclui
 * corrida (a API também só deixa o próprio entregador fazer isso pelo login dele).
 */
export function DriverPreview() {
  const { userId = '' } = useParams();
  const { me } = useAuth();
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/deliveries/preview/${encodeURIComponent(userId)}`;

  const load = useCallback(async () => {
    try {
      setData(await api<Preview>(base));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  usePolling(load);

  const earnings = useCallback(async () => {
    if (!data) throw new Error('Carregando…');
    return data.earnings;
  }, [data]);
  const more = useMemo<DriverData>(
    () => ({
      available: async () => data?.available ?? [],
      claim: refuse,
      history: (before) =>
        api<HistoryPage>(`${base}/history${before ? `?before=${encodeURIComponent(before)}` : ''}`),
      profile: async () => {
        if (!data) throw new Error('Carregando…');
        return data.profile;
      },
    }),
    [base, data],
  );

  return (
    <DriverShell
      name={data?.courier.name ?? null}
      restaurant={me?.tenant.name ?? null}
      error={error}
      loading={!data}
      preview={
        <div className="driver-preview" role="status">
          <Eye size={16} aria-hidden />
          <span>
            Prévia do app de <b>{data?.courier.name ?? 'entregador'}</b>, só para ver. Você continua
            com a sua conta e nada muda daqui.
          </span>
        </div>
      }
    >
      {data && (
        <DriverPanel
          deliveries={data.deliveries}
          store={data.store ? [data.store.lat, data.store.lng] : null}
          onChanged={load}
          actions={{ complete: refuse, fail: refuse, location: () => Promise.resolve() }}
          earnings={earnings}
          data={more}
          preview
        />
      )}
    </DriverShell>
  );
}
