import type { CSSProperties } from 'react';

/*
 * Esqueleto do cardápio do cliente (/pedir): o formato da loja no celular, no tablet e no
 * notebook. É o mesmo desenho do esqueleto do index.html (bloco .cm-msk, com o CSS lá no <head>,
 * que já está na página antes de qualquer arquivo do app). Do primeiro byte até o cardápio
 * aparecer, a tela não troca de desenho: index.html → espera do arquivo do cardápio → espera do
 * servidor. O teste MenuSkeleton.test.tsx confere que os dois continuam iguais.
 */

const round = (size: number): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
});
const line = (height: number, width?: string): CSSProperties =>
  width ? { height, width } : { height };

function Row({ thumb, width }: { thumb: CSSProperties; width: string }) {
  return (
    <div className="cm-msk__row">
      <i style={thumb} />
      <i style={line(12, width)} />
    </div>
  );
}

const CAT_THUMB: CSSProperties = { width: 36, height: 36, borderRadius: 11 };
const RAIL_TILE: CSSProperties = { width: 60, height: 60, borderRadius: 18 };
const NAV_DOT: CSSProperties = round(28);
function Pair() {
  return (
    <span>
      <i />
      <i />
    </span>
  );
}
function Card() {
  return (
    <div className="cm-msk__card">
      <i />
      <i />
      <i />
    </div>
  );
}
const PAIRS = [0, 1, 2, 3, 4].map((k) => <Pair key={k} />);
const TILES = [0, 1, 2, 3].map((k) => <Pair key={k} />);
const CARDS = [0, 1, 2, 3].map((k) => <Card key={k} />);

export function MenuSkeleton() {
  // O brilho continua de onde o esqueleto do index.html estava (sem pular ao trocar).
  const delay = typeof performance === 'undefined' ? 0 : -(performance.now() % 1400);
  return (
    <div
      className="cm-boot cm-boot--react"
      role="status"
      aria-busy="true"
      style={{ '--cm-sk-delay': `${Math.round(delay)}ms` } as CSSProperties}
    >
      <div className="cm-msk cm-msk--react" aria-hidden="true">
        <div className="cm-msk__side">
          <div className="cm-msk__row">
            <i style={round(44)} />
            <span className="cm-msk__lines">
              <i style={line(13, '80%')} />
              <i style={line(10, '50%')} />
            </span>
          </div>
          <i style={{ height: 36, marginTop: 4 }} />
          <i style={{ height: 12, width: '50%', marginLeft: 12 }} />
          <i style={{ height: 12, width: '44%', marginLeft: 12 }} />
          <i style={{ height: 12, width: '56%', marginLeft: 12 }} />
          <i style={{ height: 10, width: '30%', marginTop: 18 }} />
          <Row thumb={CAT_THUMB} width="55%" />
          <Row thumb={CAT_THUMB} width="42%" />
          <Row thumb={CAT_THUMB} width="50%" />
          <Row thumb={CAT_THUMB} width="38%" />
          <Row thumb={CAT_THUMB} width="46%" />
        </div>
        <div className="cm-msk__bar">
          <i style={round(40)} />
          <span className="cm-msk__lines" style={{ flex: '0 0 150px' }}>
            <i style={line(13)} />
            <i style={line(10, '60%')} />
          </span>
          <i style={{ width: 104, height: 40, borderRadius: 999, marginLeft: 'auto' }} />
          <i style={NAV_DOT} />
          <i style={NAV_DOT} />
          <i style={NAV_DOT} />
          <i style={{ width: 112, height: 46, borderRadius: 999, marginLeft: 8 }} />
        </div>
        <div className="cm-msk__rail">
          {[0, 1, 2, 3, 4].map((k) => (
            <i key={k} style={RAIL_TILE} />
          ))}
        </div>
        <div className="cm-msk__main">
          <div className="cm-msk__hero">
            <span className="cm-msk__hello">
              <i className="cm-msk__name" />
              <i className="cm-msk__status" />
            </span>
            <i className="cm-msk__info" />
            <i className="cm-msk__store" />
            <i className="cm-msk__ride" />
          </div>
          <div className="cm-msk__search">
            <i />
            <i />
          </div>
          <i className="cm-msk__banner" />
          <div className="cm-msk__chips">{TILES}</div>
          <i className="cm-msk__title" />
          <div className="cm-msk__grid">{CARDS}</div>
        </div>
        <div className="cm-msk__cart">
          <div className="cm-msk__row">
            <i style={round(36)} />
            <i style={line(16, '40%')} />
          </div>
          <i style={{ height: 38, borderRadius: 8 }} />
          <span />
          <i style={{ height: 50, borderRadius: 999 }} />
        </div>
        <div className="cm-msk__tabs">{PAIRS}</div>
      </div>
      <span className="cm-sr-only">Abrindo o cardápio</span>
    </div>
  );
}
