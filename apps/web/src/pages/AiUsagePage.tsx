import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../app/auth';
import { Alert, Card, Segmented, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { DayBars, HBars, KpiStrip, Progress, type BarFormat } from './finance/charts';
import './finance/finance.css';
import './ai-usage.css';

type Period = 'month' | 'last' | 'all';

/** GET /chat/ai/usage: o uso de IA do restaurante (sem valores em dinheiro). */
interface AiUsage {
  period: Period;
  assistantName: string;
  total: { tokens: number; calls: number; bonusTokens: number };
  parts: {
    key: string;
    label: string;
    tokens: number;
    calls: number;
    percent: number;
    sources: { source: string; label: string; tokens: number; calls: number }[];
  }[];
  days: { day: string; tokens: number; calls: number }[];
  people: { userId: string | null; name: string | null; tokens: number; calls: number }[];
  quota: {
    used: number;
    limit: number;
    bonus: number;
    available: number | null;
    percent: number | null;
    enabled: boolean;
    blocked: boolean;
  };
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last', label: 'Mês passado' },
  { value: 'all', label: 'Desde o início' },
];

const int = (n: number) => Math.round(n).toLocaleString('pt-BR');
/** 1.234.567 → "1,2 mi"; 12.300 → "12,3 mil". */
const short = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const TOKENS: BarFormat = { full: (n) => `${int(n)} tokens`, short: (n) => short(n) };

/**
 * Conta › Uso de IA (pedido do David, 0.269: "onde o meu cliente controla o uso de IA dele"):
 * quanto do limite do mês já foi, em que partes do sistema a IA mais trabalha, por dia e por
 * quem. Os números saem da mesma tabela que o limite soma; dinheiro não aparece (é do Comandou).
 */
export function AiUsagePage() {
  const canSee = useCan('plan:read');
  return (
    <>
      <div>
        <Link to="/conta" className="aiu-back">
          <ChevronLeft size={16} aria-hidden /> Conta
        </Link>
        <h1 className="page-title">Uso de IA</h1>
        <p className="page-sub">Quanto o restaurante usou de IA e em que partes do sistema.</p>
      </div>
      {canSee ? (
        <UsageView />
      ) : (
        <Alert tone="info">Só o administrador ou o gerente veem o uso de IA.</Alert>
      )}
    </>
  );
}

function UsageView() {
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<AiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    api<AiUsage>(`/chat/ai/usage?period=${period}`)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [period]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Skeleton variant="page" />;
  const q = data.quota;
  const top = [...data.parts].sort((a, b) => b.tokens - a.tokens)[0];
  const perUse = data.total.calls ? data.total.tokens / data.total.calls : 0;
  const pct = q.percent ?? 0;

  return (
    <div className="aiu">
      <Segmented<Period>
        label="Período"
        value={period}
        onChange={(p) => {
          setData(null);
          setPeriod(p);
        }}
        options={PERIODS}
      />

      <Card title="Limite deste mês">
        {q.limit > 0 ? (
          <div className="aiu-limit">
            <div className="aiu-limit__row">
              <strong
                className="aiu-limit__pct"
                data-level={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok'}
              >
                {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
              </strong>
              <span>
                {int(q.used)} de {int(q.limit)} tokens usados
                {q.bonus > 0 ? ` · mais ${int(q.bonus)} extras liberados pelo Comandou` : ''}
              </span>
            </div>
            <Progress value={q.used} max={q.limit} label="Quanto do limite do mês já foi usado" />
            <p className="aiu-note">
              {q.blocked
                ? 'O limite do mês acabou: a IA volta no dia 1º. Para aumentar antes, fale com o suporte do Comandou.'
                : pct >= 80
                  ? 'Perto do limite: quando chegar a 100%, a IA para até o mês virar.'
                  : 'O limite volta a zero todo dia 1º. Os extras liberados pelo Comandou não vencem.'}
            </p>
          </div>
        ) : (
          <p className="aiu-note">Sem limite neste mês: {int(q.used)} tokens usados até agora.</p>
        )}
      </Card>

      <KpiStrip
        items={[
          { key: 'tokens', label: 'Tokens no período', value: short(data.total.tokens) },
          {
            key: 'calls',
            label: 'Vezes que a IA trabalhou',
            value: int(data.total.calls),
            sub: perUse ? `média de ${int(perUse)} tokens por vez` : undefined,
          },
          {
            key: 'top',
            label: 'Onde mais usa',
            value: top ? top.label : 'Nada ainda',
            sub: top ? `${String(top.percent).replace('.', ',')}% do uso` : undefined,
          },
          {
            key: 'bonus',
            label: 'Dos extras',
            value: short(data.total.bonusTokens),
            sub: 'tokens que saíram dos extras',
          },
        ]}
      />

      <div className="aiu-grid">
        <Card title="Em que partes do sistema">
          {data.parts.length ? (
            <HBars
              label="Uso de IA por parte do sistema"
              rows={data.parts
                .slice()
                .sort((a, b) => b.tokens - a.tokens)
                .map((p, i) => ({
                  key: p.key,
                  label: p.label,
                  value: p.tokens,
                  strong: i === 0,
                  display: `${String(p.percent).replace('.', ',')}% · ${short(p.tokens)}`,
                  sub: p.sources.map((s) => `${s.label}: ${int(s.calls)} vez(es)`).join(' · '),
                }))}
            />
          ) : (
            <p className="aiu-note">Nenhum uso de IA no período.</p>
          )}
        </Card>
        <Card title="Quem mais usou">
          {data.people.length ? (
            <HBars
              label="Uso de IA por pessoa"
              rows={data.people.map((p, i) => ({
                key: p.userId ?? 'auto',
                label: p.name ?? 'Atendimento automático (WhatsApp)',
                value: p.tokens,
                strong: i === 0,
                display: short(p.tokens),
                sub: `${int(p.calls)} vez(es)`,
              }))}
            />
          ) : (
            <p className="aiu-note">Ninguém usou a IA no período.</p>
          )}
        </Card>
      </div>

      <Card title="Por dia · últimos 30 dias">
        {data.days.some((d) => d.tokens > 0) ? (
          <DayBars
            label="Tokens de IA por dia"
            height={200}
            format={TOKENS}
            items={data.days.map((d) => ({
              day: d.day,
              value: d.tokens,
              details: [{ label: 'Vezes:', value: int(d.calls) }],
            }))}
          />
        ) : (
          <p className="aiu-note">Nenhum uso nos últimos 30 dias.</p>
        )}
      </Card>

      <p className="aiu-note">
        Token é um pedaço de texto (uma palavra tem 1 ou 2): a IA conta o que lê e o que escreve.
        Uma pergunta ao {data.assistantName} costuma usar alguns milhares; uma foto refeita conta
        como uma imagem.
      </p>
    </div>
  );
}
