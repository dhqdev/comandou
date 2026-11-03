import { RELEASES, type ReleaseTag } from '@comandou/shared';
import { Bell, BellDot } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Sheet } from '../design-system';
import { markNewsSeen, newsExpiresAt, recentNews, useNow, useSeenNews } from '../lib/news';
import { markReleasesSeen } from '../lib/releases';
import './news-bell.css';

const TAG_TONE: Record<ReleaseTag, 'brand' | 'info' | 'success' | 'warning'> = {
  novo: 'brand',
  melhoria: 'info',
  correção: 'warning',
  segurança: 'success',
};

const dayFmt = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });

function leftText(ms: number): string {
  const h = Math.max(1, Math.round(ms / 3_600_000));
  if (h < 24) return `some em ${h} h`;
  const d = Math.round(h / 24);
  return `some em ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/**
 * Sininho da barra de cima: mostra o que saiu de novo no sistema nos últimos 2 dias, com o número
 * de novidades ainda não vistas neste aparelho. Cada novidade some sozinha 2 dias depois do dia
 * em que saiu; o histórico completo continua na tela Novidades.
 */
export function NewsBell() {
  const now = useNow();
  const seen = useSeenNews();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const items = recentNews(RELEASES, now);
  const unread = items.filter((r) => !seen.includes(r.version)).length;
  const label = unread
    ? `${unread} ${unread === 1 ? 'novidade nova' : 'novidades novas'}`
    : 'Novidades';

  const show = () => {
    setOpen(true);
    if (items.length) {
      markNewsSeen(items.map((r) => r.version));
      if (items[0] === RELEASES[0]) markReleasesSeen();
    }
  };

  return (
    <>
      <button
        type="button"
        className="cm-theme-toggle news-bell"
        data-unread={unread || undefined}
        aria-label={`${label}. Ver o que há de novo`}
        title={label}
        onClick={show}
      >
        {unread ? <BellDot size={18} aria-hidden /> : <Bell size={18} aria-hidden />}
        {unread > 0 && (
          <span className="news-bell__count" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Sheet
        open={open}
        title="O que há de novo"
        onClose={() => setOpen(false)}
        footer={
          <Button
            block
            variant="secondary"
            onClick={() => {
              setOpen(false);
              navigate('/novidades');
            }}
          >
            Ver todas as versões
          </Button>
        }
      >
        {items.length === 0 ? (
          <div className="news-bell__empty">
            <Bell size={28} aria-hidden />
            <p>Nada de novo nos últimos 2 dias.</p>
            <p className="cm-hint">Cada novidade fica aqui por 2 dias e depois some sozinha.</p>
          </div>
        ) : (
          <ol className="news-bell__list">
            {items.map((r) => (
              <li key={r.version} className="news-bell__item">
                <div className="news-bell__head">
                  <strong>
                    v{r.version} · {r.title}
                  </strong>
                  {!seen.includes(r.version) && <Badge tone="brand">nova</Badge>}
                </div>
                <p className="news-bell__summary">{r.summary}</p>
                <ul className="news-bell__notes">
                  {r.notes.map((n, j) => (
                    <li key={j}>
                      <Badge tone={TAG_TONE[n.tag]}>{n.tag}</Badge>
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
                <span className="cm-hint">
                  {dayFmt(r.date)} · {leftText(newsExpiresAt(r) - now)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </>
  );
}
