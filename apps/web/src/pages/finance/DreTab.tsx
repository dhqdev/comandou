import {
  csvText,
  financeMonthName,
  financeMonthRange,
  fromCents,
  toCents,
  type DreIndicator,
  type FinanceMonth,
} from '@comandou/shared';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Skeleton } from '../../design-system';
import { fmtDate, Tabs } from '../../features/forms';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useLiveData } from '../../lib/realtime';
import { Waterfall, type WaterStep } from './charts';
import type { DreResponse } from './types';

const fmtPct = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')}%`);
const signed = (v: string) => {
  const c = toCents(v);
  return c < 0 ? `−${brl(fromCents(-c))}` : brl(v);
};

const STATUS_TEXT: Record<DreIndicator['status'], string> = {
  good: 'Bom',
  warn: 'Atenção',
  bad: 'Ruim',
  none: '',
};

/**
 * DRE gerencial: do faturamento ao lucro, no mês financeiro escolhido em cima e comparado com o
 * mês anterior, com os indicadores que o restaurante deve olhar todo mês.
 */
export function DreTab({
  period,
  previous,
}: {
  period: FinanceMonth | null;
  previous: FinanceMonth | null;
}) {
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const [data, setData] = useState<DreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Venda paga, caixa fechado ou conta lançada: o DRE se refaz sem piscar a tela.
  const [tick, setTick] = useState(0);
  const shownKey = useRef('');
  useLiveData(
    ['finance'],
    () => setTick((n) => n + 1),
    ['cash.changed', 'channels.finance', 'order.changed'],
    3000,
  );
  useEffect(() => {
    if (!period) return;
    const qs = new URLSearchParams({ from: period.from, to: period.to, basis });
    if (previous) {
      qs.set('prevFrom', previous.from);
      qs.set('prevTo', previous.to);
    }
    const key = JSON.stringify([period, previous, basis]);
    if (shownKey.current !== key) setData(null);
    shownKey.current = key;
    api<DreResponse>(`/finance/dre?${qs}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [period, previous, basis, tick]);

  function download() {
    if (!data) return;
    const prev = new Map(data.previous.dre.lines.map((l) => [l.id, l]));
    const rows = [
      [
        'Linha',
        `${fmtDate(data.from)} a ${fmtDate(data.to)}`,
        '% da receita líquida',
        'Período anterior',
      ],
      ...data.dre.lines.map((l) => [
        l.kind === 'item' ? `   ${l.label}` : l.label,
        l.value.replace('.', ','),
        l.pct === null ? '' : String(l.pct).replace('.', ','),
        (prev.get(l.id)?.value ?? '').replace('.', ','),
      ]),
    ];
    // csvText: nome de categoria nunca vira fórmula; valores negativos seguem como número.
    const cell = (c: string) => (/^-?\d[\d.,]*$/.test(c) ? `"${c}"` : csvText(c));
    const csv = rows.map((r) => r.map(cell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dre-${data.from}-a-${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const prevById = new Map((data?.previous.dre.lines ?? []).map((l) => [l.id, l]));
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="fin-toolbar">
        <div>
          <Tabs<typeof basis>
            value={basis}
            onChange={setBasis}
            items={[
              ['accrual', 'Competência'],
              ['cash', 'Caixa'],
            ]}
          />
          <p className="cm-hint" style={{ margin: '6px 0 0' }}>
            {basis === 'accrual'
              ? 'Contas entram pelo vencimento: mostra o resultado do mês, pago ou não.'
              : 'Contas entram no dia em que foram pagas: mostra o dinheiro que de fato saiu.'}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Download size={16} />}
          disabled={!data}
          onClick={download}
        >
          Baixar planilha
        </Button>
      </div>
      {!data ? (
        !error && <Skeleton variant="table" />
      ) : (
        <>
          {waterfall(data) && (
            <Card title="Do faturamento ao lucro">
              <Waterfall
                steps={waterfall(data)!}
                label="Cascata do DRE: receita líquida, custos e lucro"
              />
            </Card>
          )}
          {data.dre.indicators.length > 0 && (
            <div className="fin-ind">
              {data.dre.indicators.map((i) => (
                <div key={i.id} className="fin-ind__item" data-status={i.status}>
                  <span className="fin-ind__label">{i.label}</span>
                  <strong className="fin-ind__value">
                    {i.value === null
                      ? '—'
                      : i.unit === 'pct'
                        ? fmtPct(i.value as number)
                        : brl(i.value as string)}
                  </strong>
                  <span className="cm-hint">
                    {i.status !== 'none' && (
                      <span className="fin-dot" data-status={i.status} aria-hidden />
                    )}
                    {STATUS_TEXT[i.status] && `${STATUS_TEXT[i.status]} · `}
                    {i.value === null
                      ? 'sem lançamentos'
                      : i.unit === 'pct'
                        ? `referência ${i.reference}`
                        : i.reference}
                  </span>
                  <span className="cm-hint fin-ind__explain">{i.explain}</span>
                </div>
              ))}
            </div>
          )}
          {data.dre.notes.map((n) => (
            <Alert key={n} tone="info">
              {n}
            </Alert>
          ))}
          <Card
            title={
              period ? `Mês de ${financeMonthName(period)} · ${financeMonthRange(period)}` : 'DRE'
            }
            bodyless
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="cm-table fin-dre">
                <thead>
                  <tr>
                    <th />
                    <th className="cm-num">Valor</th>
                    <th className="cm-num">%</th>
                    <th className="cm-num">
                      {previous ? `Mês de ${financeMonthName(previous)}` : 'Período anterior'}
                    </th>
                    <th className="cm-num">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dre.lines.map((l) => {
                    const p = prevById.get(l.id);
                    const cur = toCents(l.value);
                    const before = p ? toCents(p.value) : 0;
                    // Despesa compara o tamanho: custo que subiu aparece com +, mesmo negativo.
                    const cost = cur <= 0 && before < 0;
                    const delta =
                      before !== 0
                        ? Math.round(
                            ((cost ? before - cur : cur - before) / Math.abs(before)) * 1000,
                          ) / 10
                        : null;
                    const deltaText =
                      delta === null || cur === before
                        ? null
                        : `${delta > 0 ? '+' : ''}${fmtPct(delta)}`;
                    return (
                      <tr key={l.id} data-kind={l.kind} title={l.hint}>
                        <td>
                          {l.label}
                          {/* Celular: % e comparação numa linha só, embaixo do nome. */}
                          <span className="cm-hint fin-dre__sub">
                            {l.pct !== null && `${fmtPct(l.pct)} da receita`}
                            {p &&
                              `${l.pct !== null ? ' · ' : ''}antes ${signed(p.value)}${deltaText ? ` (${deltaText})` : ''}`}
                          </span>
                        </td>
                        <td
                          className="cm-num"
                          data-neg={
                            ((l.kind === 'result' || l.kind === 'total') && cur < 0) || undefined
                          }
                        >
                          {signed(l.value)}
                        </td>
                        <td className="cm-num cm-hint">{fmtPct(l.pct)}</td>
                        <td className="cm-num cm-hint">{p ? signed(p.value) : '—'}</td>
                        <td className="cm-num cm-hint">{deltaText ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="cm-hint">
            Vendas: o que entrou no caixa. CMV:{' '}
            {data.dre.cmvSource === 'stock'
              ? 'o consumo de insumos pelas fichas técnicas (mais as perdas).'
              : 'as compras de insumos, bebidas e embalagens do período (cadastre as fichas técnicas no Estoque para o CMV real).'}{' '}
            Despesas: pela categoria de cada conta (veja o plano de contas em{' '}
            <Link className="fin-link" to="/financeiro?aba=entries">
              Contas
            </Link>
            ).
          </p>
        </>
      )}
    </>
  );
}

/** Degraus da cascata: receita líquida, cada grupo de custo e o lucro (some o que está zerado). */
function waterfall(data: DreResponse): WaterStep[] | null {
  const v = (id: string) => toCents(data.dre.lines.find((l) => l.id === id)?.value ?? '0');
  const net = v('net');
  if (net <= 0) return null;
  const steps: WaterStep[] = [
    { key: 'net', label: 'Receita líquida', value: net, total: true },
    { key: 'cmv', label: 'CMV', value: v('cmv') },
    { key: 'variable', label: 'Variáveis', value: v('variable') },
    { key: 'fixed', label: 'Fixas', value: v('fixed') },
    { key: 'other', label: 'Financeiro', value: v('other') },
    { key: 'net_profit', label: 'Lucro', value: v('net_profit'), total: true },
  ];
  // Degrau menor que 0,5% da receita (centavos de sobra de caixa, por exemplo) só polui.
  return steps.filter((s) => s.total || Math.abs(s.value) >= net * 0.005);
}
