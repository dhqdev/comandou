import { ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Spinner, TextField, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';

export interface SiteCopy {
  headline: string;
  tagline: string;
  about: string;
  highlights: { title: string; text: string }[];
  cta: string;
}

const EMPTY_HIGHLIGHTS = 3;

/** Abre a página do restaurante (<endereço>/site) numa aba nova. */
export const openSitePage = () => window.open('/site', '_blank', 'noopener');

/** Pede para a IA escrever (ou reescrever) os textos da página do restaurante. */
export const createSitePage = () =>
  api<{ copy: SiteCopy; withAi: boolean }>('/menu-import/site-page', { method: 'POST', json: {} });

/**
 * Loja online › Página: a landing page do restaurante em <endereço>/site. A IA escreve os textos
 * nos primeiros passos; aqui dá para corrigir à mão, refazer com a IA e abrir a página.
 */
export function SitePageCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [copy, setCopy] = useState<SiteCopy | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'ai' | null>(null);

  useEffect(() => {
    api<{ copy: SiteCopy }>('/store/site').then(
      (d) => setCopy(d.copy),
      (e: ApiError) => (e.status === 404 ? setMissing(true) : toast(e.message, 'danger')),
    );
  }, [toast]);

  async function ai() {
    setBusy('ai');
    try {
      const r = await createSitePage();
      setCopy(r.copy);
      setMissing(false);
      toast(
        r.withAi ? 'Página escrita pela IA' : 'Página criada com o texto padrão (IA indisponível)',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!copy) return;
    setBusy('save');
    try {
      const highlights = copy.highlights.filter((h) => h.title.trim());
      const r = await api<{ copy: SiteCopy }>('/store/site', {
        method: 'PUT',
        json: { ...copy, highlights },
      });
      setCopy(r.copy);
      toast('Página salva', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  if (missing)
    return (
      <div className="cm-form">
        <p className="cm-hint cm-form__wide">
          A página do restaurante é um site de apresentação em{' '}
          <strong>{window.location.host}/site</strong>, com o logo, as cores, alguns itens, o
          endereço, o horário e o botão para pedir. A IA escreve os textos com o que já está
          cadastrado.
        </p>
        <div className="cm-form__wide">
          <Button
            icon={<Sparkles size={16} />}
            loading={busy === 'ai'}
            disabled={!canManage}
            onClick={() => void ai()}
          >
            Criar a página com IA
          </Button>
        </div>
      </div>
    );
  if (!copy) return <Spinner />;

  const set = (p: Partial<SiteCopy>) => setCopy({ ...copy, ...p });
  const highlights = [
    ...copy.highlights,
    ...Array.from({ length: Math.max(0, EMPTY_HIGHLIGHTS - copy.highlights.length) }, () => ({
      title: '',
      text: '',
    })),
  ];
  const setHighlight = (i: number, p: Partial<SiteCopy['highlights'][number]>) =>
    set({ highlights: highlights.map((h, j) => (j === i ? { ...h, ...p } : h)) });

  return (
    <div className="cm-form">
      {!canManage && <Alert tone="info">Somente gerentes alteram a página do restaurante.</Alert>}
      <div className="cm-form__wide" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" icon={<ExternalLink size={16} />} onClick={openSitePage}>
          Abrir a página
        </Button>
        <Button
          variant="secondary"
          icon={<Sparkles size={16} />}
          loading={busy === 'ai'}
          disabled={!canManage || busy !== null}
          onClick={() => void ai()}
        >
          Refazer com IA
        </Button>
      </div>
      <TextField
        label="Título"
        wrapClass="cm-form__wide"
        maxLength={80}
        value={copy.headline}
        disabled={!canManage}
        onChange={(e) => set({ headline: e.target.value })}
      />
      <TextField
        label="Frase de apoio"
        wrapClass="cm-form__wide"
        maxLength={160}
        value={copy.tagline}
        disabled={!canManage}
        onChange={(e) => set({ tagline: e.target.value })}
      />
      <div className="cm-field cm-form__wide">
        <label className="cm-label" htmlFor="site-about">
          Sobre
        </label>
        <textarea
          id="site-about"
          className="cm-input"
          rows={4}
          maxLength={600}
          value={copy.about}
          disabled={!canManage}
          onChange={(e) => set({ about: e.target.value })}
        />
      </div>
      <h3 className="cm-form__section">Destaques</h3>
      {highlights.map((h, i) => (
        <div key={i} className="cm-form__wide" style={{ display: 'grid', gap: 8 }}>
          <TextField
            label={`Destaque ${i + 1}`}
            maxLength={40}
            value={h.title}
            disabled={!canManage}
            onChange={(e) => setHighlight(i, { title: e.target.value })}
          />
          <TextField
            label="Frase"
            maxLength={140}
            value={h.text}
            disabled={!canManage}
            onChange={(e) => setHighlight(i, { text: e.target.value })}
          />
        </div>
      ))}
      <TextField
        label="Texto do botão de pedir"
        maxLength={30}
        value={copy.cta}
        disabled={!canManage}
        onChange={(e) => set({ cta: e.target.value })}
      />
      <div className="cm-form__wide">
        <Button
          loading={busy === 'save'}
          disabled={!canManage || busy !== null || !copy.headline.trim() || !copy.cta.trim()}
          onClick={() => void save()}
        >
          Salvar a página
        </Button>
      </div>
    </div>
  );
}
