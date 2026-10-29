import { Ban } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useCan } from '../../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import type { FiscalKind, FiscalVoid } from '../../lib/types';
import { FiscalHead, fmtDateTime, KIND_LABEL } from './common';

interface Gap {
  kind: FiscalKind;
  series: number;
  number: number;
}

/** Junta números seguidos em faixas: 4, 5, 6, 9 → 4 a 6, 9. */
function ranges(gaps: Gap[]) {
  const out: { kind: FiscalKind; series: number; from: number; to: number }[] = [];
  for (const g of gaps) {
    const last = out[out.length - 1];
    if (last && last.kind === g.kind && last.series === g.series && last.to + 1 === g.number)
      last.to = g.number;
    else out.push({ kind: g.kind, series: g.series, from: g.number, to: g.number });
  }
  return out;
}

/** Inutilização: avisa a SEFAZ que números pulados não vão virar nota. */
export function VoidsSection() {
  const toast = useToast();
  const canManage = useCan('fiscal:manage');
  const [rows, setRows] = useState<FiscalVoid[] | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<FiscalKind>('nfce');
  const [series, setSeries] = useState('1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, g] = await Promise.all([
        api<FiscalVoid[]>('/fiscal/voids'),
        api<Gap[]>('/fiscal/voids/gaps').catch(() => []),
      ]);
      setRows(v);
      setGaps(g);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const gapRanges = useMemo(() => ranges(gaps), [gaps]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api('/fiscal/voids', {
        method: 'POST',
        json: {
          kind,
          series: Number(series),
          from: Number(from),
          to: Number(to || from),
          reason: reason.trim(),
        },
      });
      toast('Numeração inutilizada', 'success');
      setFrom('');
      setTo('');
      setReason('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <div className="fi-page">
      <FiscalHead title="Inutilização" error={error}>
        Quando um número de nota é pulado (falha na emissão, nota apagada), a SEFAZ precisa saber
        que ele não será usado. Inutilize até o dia 10 do mês seguinte.
      </FiscalHead>

      {gapRanges.length > 0 && (
        <Card title="Números pulados">
          <p className="cm-hint" style={{ marginTop: 0 }}>
            Estes números ficaram entre notas emitidas e não têm nota nem inutilização.
          </p>
          <ul className="fi-list fi-links">
            {gapRanges.map((g) => (
              <li key={`${g.kind}-${g.series}-${g.from}`}>
                <strong>{KIND_LABEL[g.kind]}</strong>
                <span>
                  série {g.series} · {g.from === g.to ? `nº ${g.from}` : `nº ${g.from} a ${g.to}`}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setKind(g.kind);
                      setSeries(String(g.series));
                      setFrom(String(g.from));
                      setTo(String(g.to));
                    }}
                  >
                    Preencher
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage && (
        <Card title="Inutilizar números">
          <form className="form-grid" onSubmit={submit}>
            <SelectField
              label="Tipo"
              value={kind}
              onChange={(e) => setKind(e.target.value as FiscalKind)}
            >
              <option value="nfce">NFC-e</option>
              <option value="nfe">NF-e</option>
            </SelectField>
            <TextField
              label="Série"
              inputMode="numeric"
              value={series}
              maxLength={3}
              onChange={(e) => setSeries(e.target.value.replace(/\D/g, ''))}
            />
            <TextField
              label="Do número"
              inputMode="numeric"
              value={from}
              onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
            />
            <TextField
              label="Até o número"
              inputMode="numeric"
              value={to}
              placeholder={from}
              onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))}
              error={to && from && Number(to) < Number(from) ? 'Menor que o inicial' : undefined}
            />
            <TextField
              label="Justificativa"
              value={reason}
              maxLength={255}
              onChange={(e) => setReason(e.target.value)}
              hint="Mínimo de 15 caracteres. Ex.: falha no sistema durante a emissão."
              className="fi-span"
            />
            <div style={{ alignSelf: 'end' }}>
              <Button
                type="submit"
                variant="danger"
                loading={busy}
                disabled={
                  !from ||
                  !series ||
                  reason.trim().length < 15 ||
                  (!!to && Number(to) < Number(from))
                }
              >
                Inutilizar
              </Button>
            </div>
          </form>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <p className="cm-hint">Inutilizar não tem volta: o número nunca mais pode virar nota.</p>
        </Card>
      )}

      <Card bodyless title="Histórico">
        {rows === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Ban size={20} />}
            title="Nenhuma inutilização"
            description="Os pedidos de inutilização aparecem aqui."
          />
        ) : (
          <div className="fi-table-wrap">
            <table className="cm-table fi-table">
              <thead>
                <tr>
                  <th>Números</th>
                  <th>Situação</th>
                  <th>Quando</th>
                  <th>Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong>
                        {KIND_LABEL[v.kind]} · série {v.series}
                      </strong>
                      <div className="cm-hint">
                        {v.numberFrom === v.numberTo
                          ? `nº ${v.numberFrom}`
                          : `nº ${v.numberFrom} a ${v.numberTo}`}
                        {v.environment === 'homologacao' && ' · homologação'}
                      </div>
                    </td>
                    <td>
                      <Badge tone={v.status === 'authorized' ? 'success' : 'danger'}>
                        {v.status === 'authorized' ? 'Inutilizada' : 'Recusada'}
                      </Badge>
                      {v.status !== 'authorized' && v.sefazMessage && (
                        <div className="cm-hint fi-row__why">{v.sefazMessage}</div>
                      )}
                    </td>
                    <td>
                      {fmtDateTime(v.createdAt)}
                      {v.createdByName && <div className="cm-hint">{v.createdByName}</div>}
                    </td>
                    <td>{v.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
