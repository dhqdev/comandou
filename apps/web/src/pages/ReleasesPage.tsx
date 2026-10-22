import { RELEASES, type ReleaseTag } from '@pedemais/shared';
import { Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Badge, Card } from '../design-system';
import { markReleasesSeen } from '../lib/releases';

const TAG_TONE: Record<ReleaseTag, 'brand' | 'info' | 'success' | 'warning'> = {
  novo: 'brand',
  melhoria: 'info',
  correção: 'warning',
  segurança: 'success',
};

const fmt = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

/** Histórico de versões do PedeMais (fonte: packages/shared/src/releases.ts). */
export function ReleasesPage() {
  useEffect(() => {
    markReleasesSeen();
  }, []);
  return (
    <>
      <div>
        <h1 className="page-title">Novidades</h1>
        <p className="page-sub">O que mudou em cada versão do PedeMais.</p>
      </div>
      <ol className="releases">
        {RELEASES.map((r, i) => (
          <li key={r.version} className="release">
            <Card
              title={
                <span className="release__title">
                  <Sparkles size={18} aria-hidden /> v{r.version} · {r.title}
                </span>
              }
              actions={
                <>
                  {i === 0 && <Badge tone="success">versão atual</Badge>}
                  <span className="pm-hint">{fmt(r.date)}</span>
                </>
              }
            >
              <p style={{ marginTop: 0 }}>{r.summary}</p>
              <ul className="release__notes">
                {r.notes.map((n, j) => (
                  <li key={j}>
                    <Badge tone={TAG_TONE[n.tag]}>{n.tag}</Badge>
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
