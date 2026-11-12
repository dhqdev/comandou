import './art.css';

/**
 * Ilustrações do cardápio, em estilo desenho (traço escuro e cores chapadas). Pintadas com a cor
 * da loja (--cm-brand-*) e a de destaque (--cm-accent-*): combinam com qualquer identidade.
 * São decorativas (aria-hidden); o texto ao lado diz o que importa.
 *
 * Todas usam a mesma tela (260 × 170) e a mesma sombra no chão, para trocar uma pela outra sem
 * mexer no layout. `live` liga a animação leve de cada uma (desligada com movimento reduzido).
 */

/** Coração desenhado a partir do topo (cx = centro, top = topo, w = largura). */
export function heartPath(cx: number, top: number, w: number) {
  const s = w / 96;
  const p = (x: number, y: number) =>
    `${+(cx + (x - 50) * s).toFixed(1)} ${+(top + (y - 2) * s).toFixed(1)}`;
  return (
    `M${p(50, 88)} C${p(20, 66)} ${p(2, 48)} ${p(2, 28)} C${p(2, 12)} ${p(14, 2)} ${p(28, 2)} ` +
    `C${p(38, 2)} ${p(46, 8)} ${p(50, 16)} C${p(54, 8)} ${p(62, 2)} ${p(72, 2)} ` +
    `C${p(86, 2)} ${p(98, 12)} ${p(98, 28)} C${p(98, 48)} ${p(80, 66)} ${p(50, 88)} Z`
  );
}

/** Serrilhado de baixo (papel de comanda, folha de alface): `n` dentes de `x0` até `x1`. */
function teeth(x0: number, x1: number, y: number, n: number, depth: number) {
  const w = (x1 - x0) / n;
  let d = '';
  for (let i = 0; i < n; i++) d += ` q${+(w / 2).toFixed(2)} ${depth} ${+w.toFixed(2)} 0`;
  return `M${x0} ${y}${d}`;
}

type ArtProps = { live?: boolean; className?: string };

/** Motoboy na moto com a caixa de entrega. `ride`: rodas girando, vento e fumacinha. */
export function MotoboyArt({
  ride = false,
  className = '',
}: {
  ride?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`art art--moto ${className}`}
      data-ride={ride || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="154" rx="98" ry="7" />
      <g className="art-wind">
        <path d="M6 70h24" />
        <path d="M0 94h32" />
        <path d="M12 118h18" />
      </g>
      <g className="art-puff">
        <circle className="art-ink art-white" cx="30" cy="132" r="7" />
        <circle className="art-ink art-white" cx="16" cy="139" r="4.5" />
      </g>
      <g className="art-body">
        {/* rodas (com raios, para girar) */}
        <g className="art-wheel" style={{ transformOrigin: '66px 134px' }}>
          <circle className="art-tire" cx="66" cy="134" r="18" />
          <circle className="art-ink art-hub" cx="66" cy="134" r="8.5" />
          <path className="art-spoke" d="M66 127v14M59 134h14" />
        </g>
        <g className="art-wheel" style={{ transformOrigin: '196px 134px' }}>
          <circle className="art-tire" cx="196" cy="134" r="18" />
          <circle className="art-ink art-hub" cx="196" cy="134" r="8.5" />
          <path className="art-spoke" d="M196 127v14M189 134h14" />
        </g>
        {/* garfo */}
        <path className="art-ink" strokeWidth="6" d="M196 134 L178 76" />
        <path className="art-fork" d="M196 134 L178 76" />
        {/* carroceria */}
        <path
          className="art-ink art-brand"
          d="M40 118 C40 100 54 94 72 94 L116 94 C124 94 128 100 132 110 L146 116 L160 82 C163 74 170 70 178 72 L184 74 C186 90 180 108 170 122 C166 128 160 130 152 130 L92 130 C86 122 78 118 66 118 C58 118 50 122 46 128 L40 128 Z"
        />
        <path className="art-shine" d="M52 104 C58 100 66 99 76 99" />
        <path className="art-shine" d="M170 82 C172 90 170 100 166 108" />
        {/* banco e lanterna */}
        <path
          className="art-ink art-seat"
          d="M68 94 C70 86 76 84 84 84 L118 84 C124 84 126 88 124 94 Z"
        />
        <rect
          className="art-ink art-red"
          x="35"
          y="107"
          width="7"
          height="10"
          rx="2"
          strokeWidth="2"
        />
        {/* guidão, farol e espelho */}
        <path className="art-ink" strokeWidth="5" d="M178 70 L172 56" />
        <path className="art-ink" strokeWidth="5" d="M164 56 L182 56" />
        <path className="art-ink art-light" d="M184 74 C192 72 197 78 195 86 L182 88 Z" />
        <path className="art-ink" strokeWidth="2.5" d="M176 56 L184 44" />
        <ellipse className="art-ink art-glass" cx="186" cy="42" rx="5" ry="3.5" strokeWidth="2.5" />
        {/* bagageiro e caixa de entrega */}
        <path className="art-ink" strokeWidth="3.5" d="M26 96 H80 M44 96 L50 104" />
        <g className="art-box">
          <rect className="art-ink art-brand-deep" x="22" y="38" width="62" height="56" rx="8" />
          <rect className="art-ink art-brand-dark" x="22" y="38" width="62" height="15" rx="7" />
          <circle className="art-ink art-white" cx="53" cy="74" r="12.5" strokeWidth="2.5" />
          <path className="art-cutlery" d="M49 67v14M57 67v14M47 67v5a2 2 0 0 0 4 0v-5" />
          <path className="art-shine" d="M30 45h8" />
        </g>
        {/* piloto: perna e tênis */}
        <path
          className="art-ink art-pants"
          d="M96 88 C100 80 112 78 124 80 L138 84 C144 86 146 92 142 98 L134 118 L122 116 L128 98 L104 96 C98 96 94 94 96 88 Z"
        />
        <path
          className="art-ink art-white"
          d="M120 114 L136 116 C142 117 146 120 146 124 L118 124 C116 120 117 115 120 114 Z"
        />
        <path className="art-sole" d="M118 124 H146" />
        {/* jaqueta com faixa refletiva */}
        <path
          className="art-ink art-accent"
          d="M94 90 C90 74 96 58 110 50 L124 46 C134 46 140 54 140 62 L136 74 C132 84 120 90 108 92 Z"
        />
        <path className="art-stripe" d="M98 76 C108 76 122 72 132 66" />
        <path
          className="art-ink art-accent"
          d="M120 54 C132 52 146 54 160 56 L162 64 C150 66 136 66 124 66 C116 66 114 56 120 54 Z"
        />
        <circle className="art-glove" cx="164" cy="59" r="6.5" />
        {/* capacete */}
        <g className="art-head">
          <circle className="art-ink art-white" cx="128" cy="32" r="19" />
          <path className="art-helmet-stripe" d="M110 30 C112 18 122 12 132 13" />
          <path
            className="art-ink art-visor"
            d="M130 24 C140 22 147 26 147 34 C147 40 142 42 136 42 L128 42 C126 36 126 28 130 24 Z"
          />
          <path className="art-visor-shine" d="M136 28 C140 28 143 30 144 33" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Lojinha com toldo e a sacola pronta na porta (retirada no balcão). `live`: a sacola balança
 * de leve soltando vapor (quentinha, esperando você) e a plantinha mexe com o vento.
 */
export function PickupArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--pickup ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="154" rx="106" ry="7" />
      <rect className="art-ink art-wall" x="40" y="52" width="150" height="100" rx="4" />
      <path className="art-ink art-white" d="M32 52 L44 26 H186 L198 52 Z" />
      <g className="art-ink art-brand">
        <path d="M44 26 L32 52 H56 L64 26 Z" />
        <path d="M84 26 L80 52 H104 L104 26 Z" />
        <path d="M124 26 L128 52 H152 L144 26 Z" />
        <path d="M164 26 L176 52 H198 L186 26 Z" />
      </g>
      <path
        className="art-ink art-none"
        d="M32 52 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q11 12 22 0"
      />
      <rect className="art-sign" x="88" y="8" width="56" height="18" rx="4" />
      <path className="art-sign-line" d="M98 17h36" />
      <rect className="art-ink art-glass" x="52" y="74" width="62" height="42" rx="4" />
      <path className="art-glass-shine" d="M60 82h14M60 90h8" />
      <rect className="art-ink art-brand-deep" x="128" y="74" width="46" height="78" rx="4" />
      <circle className="art-knob" cx="165" cy="114" r="3" />
      <rect
        className="art-ink art-white"
        x="136"
        y="84"
        width="30"
        height="16"
        rx="3"
        strokeWidth="2.5"
      />
      <path className="art-open" d="M142 92h18" />
      <g className="art-steam art-steam--bag">
        <path d="M204 88 C200 82 208 78 204 70" />
        <path d="M220 88 C216 82 224 78 220 70" />
      </g>
      <g className="art-bag">
        <path className="art-ink art-kraft" d="M188 104 H236 L232 152 H192 Z" />
        <path className="art-ink art-kraft-dark" d="M188 104 H236 L234 112 H190 Z" />
        <path className="art-ink art-none" d="M202 104 C202 92 222 92 222 104" />
        <circle className="art-ink art-white" cx="212" cy="131" r="9.5" strokeWidth="2.5" />
        <path className="art-cutlery" d="M208 127v8M216 127v8" />
      </g>
      <g className="art-plant">
        <path
          className="art-ink art-leaf"
          d="M28 132 C20 124 18 114 22 106 C30 112 32 122 28 132 Z"
        />
        <path
          className="art-ink art-leaf"
          d="M28 132 C34 122 40 118 46 118 C44 126 38 132 28 132 Z"
        />
      </g>
      <path className="art-ink art-pot" d="M18 132 H38 L35 152 H21 Z" />
    </svg>
  );
}

/**
 * Cartela de carimbos e o presente (Fidelidade). `live`: o próximo carimbo é batido na cartela
 * e a tampa do presente dá um pulinho, em ciclo.
 */
export function LoyaltyArt({ live = false, className = '' }: ArtProps) {
  const stamps = [
    [44, 92],
    [80, 92],
    [116, 92],
    [44, 120],
    [80, 120],
    [116, 120],
  ] as const;
  return (
    <svg
      className={`art art--loyalty ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="157" rx="104" ry="7" />
      {/* cartela */}
      <g transform="rotate(-5 80 100)">
        <rect className="art-ink art-white" x="14" y="52" width="134" height="92" rx="10" />
        <path
          className="art-ink art-brand"
          d="M14 62 A10 10 0 0 1 24 52 H138 A10 10 0 0 1 148 62 V72 H14 Z"
        />
        <path className="art-paper-line art-paper-line--white" d="M26 62 H70" />
        {stamps.map(([x, y], i) =>
          i < 4 ? (
            <g key={i}>
              <circle className="art-ink art-brand" cx={x} cy={y} r="11" />
              <path
                className="art-seal-check art-seal-check--sm"
                d={`M${x - 5} ${y} l3.5 3.5 l6.5 -7`}
              />
            </g>
          ) : i === 4 ? (
            <g key={i}>
              <circle className="art-stamp-slot" cx={x} cy={y} r="11" />
              <g className="art-stamp-new">
                <circle className="art-ink art-brand" cx={x} cy={y} r="11" />
                <path
                  className="art-seal-check art-seal-check--sm"
                  d={`M${x - 5} ${y} l3.5 3.5 l6.5 -7`}
                />
              </g>
            </g>
          ) : (
            <circle key={i} className="art-stamp-slot" cx={x} cy={y} r="11" />
          ),
        )}
      </g>
      {/* presente */}
      <g className="art-gift">
        <rect className="art-ink art-brand-deep" x="164" y="98" width="72" height="54" rx="4" />
        <rect className="art-ink art-kraft" x="193" y="98" width="14" height="54" />
        <path className="art-shine" d="M172 108 V140" />
        <g className="art-lid">
          <path
            className="art-ink art-kraft"
            d="M200 82 C188 62 172 68 180 80 C184 84 192 84 200 82 Z"
          />
          <path
            className="art-ink art-kraft"
            d="M200 82 C212 62 228 68 220 80 C216 84 208 84 200 82 Z"
          />
          <rect className="art-ink art-brand-dark" x="158" y="80" width="84" height="20" rx="4" />
          <rect className="art-ink art-kraft" x="193" y="80" width="14" height="20" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Calendário com o dia marcado e o relógio ao lado (Reserva de mesa). `live`: a folha do topo
 * vira, o visto do dia se desenha e o ponteiro dá a volta, em ciclo.
 */
export function ReserveArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--reserve ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="157" rx="104" ry="7" />
      {/* calendário */}
      <rect className="art-ink art-white" x="30" y="40" width="136" height="110" rx="12" />
      <path
        className="art-ink art-brand"
        d="M30 52 A12 12 0 0 1 42 40 H154 A12 12 0 0 1 166 52 V70 H30 Z"
      />
      <path
        className="art-ink art-brand-dark art-rsv-page"
        d="M30 52 A12 12 0 0 1 42 40 H154 A12 12 0 0 1 166 52 V70 H30 Z"
      />
      <rect className="art-ink art-brand-dark" x="60" y="28" width="9" height="24" rx="4.5" />
      <rect className="art-ink art-brand-dark" x="127" y="28" width="9" height="24" rx="4.5" />
      <g className="art-rsv-days">
        <circle cx="52" cy="88" r="5" />
        <circle cx="76" cy="88" r="5" />
        <circle cx="144" cy="88" r="5" />
        <circle cx="52" cy="128" r="5" />
        <circle cx="144" cy="128" r="5" />
      </g>
      <circle className="art-ink art-brand art-rsv-day" cx="110" cy="110" r="22" />
      <path className="art-seal-check art-rsv-check" d="M99 110 l8 8 l14 -15" />
      {/* relógio */}
      <g className="art-rsv-clock">
        <circle className="art-ink art-kraft" cx="206" cy="112" r="32" />
        <circle className="art-ink art-white" cx="206" cy="112" r="24" />
        <path className="art-ink art-none" d="M206 112 V96" />
        <path className="art-ink art-none art-rsv-hand" d="M206 112 H220" />
        <circle className="art-knob" cx="206" cy="112" r="3.5" />
      </g>
    </svg>
  );
}

/**
 * Bandeja com a cúpula e a plaquinha da mesa (pedido na mesa pelo QR Code). `live`: a cúpula
 * levanta de leve e solta o vapor, em ciclo.
 */
export function WaiterArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--waiter ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="157" rx="104" ry="7" />
      {/* plaquinha da mesa */}
      <path className="art-ink art-wood" d="M196 150 H236 L230 140 H202 Z" />
      <rect className="art-ink art-brand" x="200" y="88" width="32" height="52" rx="5" />
      <path className="art-paper-line art-paper-line--white" d="M208 102 H224 M208 112 H220" />
      <circle className="art-ink art-white" cx="216" cy="126" r="6" strokeWidth="2" />
      {/* bandeja e cúpula */}
      <path className="art-ink art-kraft" d="M24 132 H184 L176 144 H32 Z" />
      <g className="art-steam art-waiter-steam">
        <path d="M86 74 C80 66 92 60 86 50" />
        <path d="M104 70 C98 62 110 56 104 46" />
        <path d="M122 74 C116 66 128 60 122 50" />
      </g>
      <ellipse className="art-ink art-white" cx="104" cy="130" rx="62" ry="6" />
      <g className="art-cloche">
        <path
          className="art-ink art-brand"
          d="M46 130 C46 96 72 76 104 76 C136 76 162 96 162 130 Z"
        />
        <path className="art-shine" d="M62 116 C64 102 74 92 86 88" />
        <rect className="art-ink art-brand-dark" x="96" y="64" width="16" height="12" rx="5" />
      </g>
    </svg>
  );
}

/** Ilustração do jeito que a loja entrega: motoboy (entrega) ou lojinha (só retirada). */
export function DeliveryArt({
  delivery,
  ride,
  className,
}: {
  delivery: boolean;
  ride?: boolean;
  className?: string;
}) {
  return delivery ? (
    <MotoboyArt ride={ride} className={className} />
  ) : (
    <PickupArt live={ride} className={className} />
  );
}

/** Celular com a conversa e dois balões saindo dele (a loja digitando e a sua mensagem). */
export function ChatArt({ live = false, className = '' }: { live?: boolean; className?: string }) {
  return (
    <svg
      className={`art art--chat ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="134" cy="158" rx="70" ry="6" />
      <path className="art-spark" d="M30 10v14M23 17h14" />
      <path className="art-spark" d="M214 18v10M209 23h10" />
      {/* celular */}
      <rect className="art-ink art-phone" x="96" y="12" width="80" height="142" rx="14" />
      <rect className="art-screen" x="103" y="25" width="66" height="116" rx="6" />
      <rect className="art-notch" x="124" y="17.5" width="24" height="3.5" rx="1.75" />
      <rect className="art-chip-theirs" x="108" y="34" width="38" height="11" rx="5.5" />
      <rect className="art-chip-mine" x="126" y="51" width="38" height="11" rx="5.5" />
      <rect className="art-chip-theirs" x="108" y="68" width="28" height="11" rx="5.5" />
      <rect className="art-chip-photo" x="130" y="85" width="34" height="26" rx="5" />
      <path className="art-chip-hill" d="M132 109 L142 97 L149 104 L154 99 L162 109 Z" />
      <circle className="art-chip-sun" cx="155" cy="92" r="3" />
      <rect className="art-chip-theirs" x="107" y="124" width="58" height="10" rx="5" />
      {/* balão da loja, digitando */}
      <path
        className="art-ink art-white"
        d="M26 34 H86 A14 14 0 0 1 100 48 V62 A14 14 0 0 1 86 76 H44 L24 90 L30 76 H26 A14 14 0 0 1 12 62 V48 A14 14 0 0 1 26 34 Z"
      />
      <g className="art-typing">
        <circle cx="38" cy="55" r="5.5" />
        <circle cx="56" cy="55" r="5.5" />
        <circle cx="74" cy="55" r="5.5" />
      </g>
      {/* sua mensagem */}
      <path
        className="art-ink art-brand"
        d="M174 84 H234 A14 14 0 0 1 248 98 V110 A14 14 0 0 1 234 124 H232 L238 138 L218 124 H174 A14 14 0 0 1 160 110 V98 A14 14 0 0 1 174 84 Z"
      />
      <path className="art-msg-line" d="M174 99 H224 M174 110 H204" />
      <path
        className="art-ink art-heart"
        strokeWidth="2.5"
        d="M232 72 C221 64 220 52 228 51 C231 51 232 53 232 55 C232 53 233 51 236 51 C244 52 243 64 232 72 Z"
      />
    </svg>
  );
}

/** Hambúrguer no prato com a bandeirinha de coração (Favoritos). */
export function FavoritesArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--fav ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="157" rx="100" ry="7" />
      <path className="art-spark" d="M30 92v12M24 98h12" />
      <path className="art-spark" d="M226 22v12M220 28h12" />
      <g className="art-float">
        <path className="art-ink art-heart" strokeWidth="2.5" d={heartPath(46, 40, 22)} />
        <path className="art-ink art-brand" strokeWidth="2.5" d={heartPath(216, 70, 16)} />
        <path className="art-ink art-accent" strokeWidth="2.5" d={heartPath(62, 8, 13)} />
      </g>
      {/* prato */}
      <ellipse className="art-ink art-white" cx="130" cy="140" rx="90" ry="14" />
      <ellipse className="art-plate-in" cx="130" cy="138" rx="66" ry="8" />
      {/* pão de baixo, carne, queijo, alface e pão de cima */}
      <path
        className="art-ink art-kraft"
        d="M82 128 C82 121 89 118 98 118 H162 C171 118 178 121 178 128 C178 134 172 137 164 137 H96 C88 137 82 134 82 128 Z"
      />
      <rect className="art-ink art-patty" x="76" y="103" width="108" height="19" rx="9.5" />
      <path
        className="art-ink art-light"
        d="M80 101 H180 L176 108 H167 L161 118 L155 108 H137 L131 116 L125 108 H105 L99 115 L93 108 H84 Z"
      />
      <path className="art-ink art-leaf" d={`${teeth(74, 186, 98, 8, 18)} L186 90 H74 Z`} />
      <path
        className="art-ink art-kraft"
        d="M78 94 C78 64 102 47 130 47 C158 47 182 64 182 94 C182 98 179 100 175 100 H85 C81 100 78 98 78 94 Z"
      />
      <path className="art-shine" d="M96 72 C101 63 110 57 121 55" />
      <g className="art-seed">
        <ellipse cx="114" cy="66" rx="3.4" ry="2" transform="rotate(-20 114 66)" />
        <ellipse cx="132" cy="60" rx="3.4" ry="2" />
        <ellipse cx="150" cy="66" rx="3.4" ry="2" transform="rotate(20 150 66)" />
        <ellipse cx="124" cy="78" rx="3.4" ry="2" transform="rotate(-10 124 78)" />
        <ellipse cx="160" cy="80" rx="3.4" ry="2" transform="rotate(25 160 80)" />
        <ellipse cx="102" cy="82" rx="3.4" ry="2" transform="rotate(-30 102 82)" />
      </g>
      {/* palito com a bandeirinha */}
      <path className="art-ink" strokeWidth="3" d="M140 52 L150 12" />
      <g className="art-flag">
        <path className="art-ink art-heart" strokeWidth="2.5" d={heartPath(163, 6, 30)} />
        <path className="art-shine" strokeWidth="2.4" d="M153 13 C155 11 158 10 160 11" />
      </g>
    </svg>
  );
}

/** Comanda com os itens ticados, lápis e o sininho do balcão (Pedidos). */
export function OrdersArt({ live = false, className = '' }: ArtProps) {
  // Pé da comanda em zigue-zague: 6 dentes da direita para a esquerda.
  let zig = '';
  for (let i = 0; i < 6; i++) zig += ' l-7.83 7 l-7.83 -7';
  return (
    <svg
      className={`art art--orders ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="157" rx="98" ry="7" />
      <path className="art-spark" d="M210 20v12M204 26h12" />
      {/* sininho do balcão */}
      <g className="art-ding">
        <path d="M30 98 l-6 -6" />
        <path d="M45 92 v-9" />
        <path d="M60 98 l6 -6" />
      </g>
      <g className="art-bell">
        <path
          className="art-ink art-light"
          d="M25 140 C25 120 34 108 45 108 C56 108 65 120 65 140 Z"
        />
        <circle className="art-ink art-light" cx="45" cy="104" r="4" />
        <path className="art-shine" d="M33 128 C33 121 36 116 41 113" />
      </g>
      <rect className="art-ink art-seat" x="18" y="139" width="54" height="9" rx="3" />
      {/* comanda */}
      <g className="art-ticket">
        <path
          className="art-ink art-white"
          d={`M84 14 H166 C169.3 14 172 16.7 172 20 V140${zig} V20 C78 16.7 80.7 14 84 14 Z`}
        />
        <path
          className="art-ink art-brand"
          d="M84 14 H166 C169.3 14 172 16.7 172 20 V40 H78 V20 C78 16.7 80.7 14 84 14 Z"
        />
        <path className="art-paper-line art-paper-line--white" d="M92 27 H128" />
        <circle className="art-white" cx="158" cy="27" r="5" />
        <circle className="art-ink art-ok" cx="93" cy="58" r="7" strokeWidth="2.5" />
        <path className="art-tick" d="M89.5 58 l2.6 2.6 l4.6 -5" />
        <circle className="art-ink art-ok" cx="93" cy="80" r="7" strokeWidth="2.5" />
        <path className="art-tick" d="M89.5 80 l2.6 2.6 l4.6 -5" />
        <circle className="art-ink art-white art-todo" cx="93" cy="102" r="7" strokeWidth="2.5" />
        <path className="art-paper-line" d="M108 58 H146 M108 80 H138 M108 102 H150" />
        <path className="art-paper-line art-paper-line--short" d="M156 58 H162 M156 80 H162" />
        <path className="art-paper-dash" d="M88 118 H162" />
        <path className="art-paper-line art-paper-line--ink" d="M90 131 H116" />
        <path className="art-paper-line art-paper-line--brand" d="M140 131 H162" />
      </g>
      {/* lápis */}
      <g className="art-pencil" transform="rotate(24 214 88)">
        <rect className="art-ink art-eraser" x="207" y="38" width="14" height="13" rx="4" />
        <rect className="art-ink art-metal" x="207" y="49" width="14" height="9" />
        <rect className="art-ink art-accent" x="207" y="58" width="14" height="52" />
        <path className="art-shine" d="M214 62 V104" />
        <path className="art-ink art-wood" d="M207 110 H221 L214 127 Z" />
        <path className="art-tip" d="M211.6 121.2 H216.4 L214 127 Z" />
      </g>
    </svg>
  );
}

/** Casinha com o alfinete do mapa pulando (Endereços). */
export function AddressArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--address ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="122" cy="157" rx="106" ry="7" />
      {/* árvore */}
      <rect className="art-ink art-trunk" x="27" y="116" width="9" height="38" rx="3" />
      <circle className="art-ink art-leaf" cx="31" cy="100" r="20" />
      <circle className="art-ink art-leaf" cx="44" cy="116" r="11" />
      <path className="art-shine" d="M20 92 C22 86 26 83 31 82" />
      {/* casa */}
      <rect className="art-ink art-brand-dark" x="140" y="40" width="15" height="30" rx="2" />
      <path className="art-ink art-wall" d="M64 154 V86 L114 46 L164 86 V154 Z" />
      <path className="art-ink art-brand" d="M46 92 L114 36 L182 92 L172 100 L114 54 L56 100 Z" />
      <circle className="art-ink art-glass" cx="114" cy="78" r="9" />
      <path className="art-glass-shine" d="M109 76 C110 73 112 72 114 71.5" />
      <rect className="art-ink art-glass" x="74" y="108" width="20" height="20" rx="3" />
      <rect className="art-ink art-glass" x="134" y="108" width="20" height="20" rx="3" />
      <path className="art-frame" d="M84 108 V128 M74 118 H94 M144 108 V128 M134 118 H154" />
      <path
        className="art-ink art-brand-deep"
        d="M100 154 V122 C100 114 106 109 114 109 C122 109 128 114 128 122 V154 Z"
      />
      <circle className="art-knob" cx="122" cy="134" r="2.6" />
      <rect
        className="art-ink art-accent"
        x="94"
        y="151"
        width="40"
        height="6"
        rx="3"
        strokeWidth="2.5"
      />
      {/* caminho até o alfinete */}
      <path className="art-trail" d="M134 154 C170 152 196 140 206 116" />
      {/* alfinete */}
      <ellipse className="art-pin-shadow" cx="210" cy="110" rx="11" ry="3.5" />
      <g className="art-pin">
        <path
          className="art-ink art-red"
          d="M210 100 C200 86 186 72 186 54 C186 40 197 30 210 30 C223 30 234 40 234 54 C234 72 220 86 210 100 Z"
        />
        <circle className="art-ink art-white" cx="210" cy="54" r="9" />
        <path className="art-shine" d="M193 50 C194 44 198 39 203 37" />
      </g>
    </svg>
  );
}

/** Panela no fogo soltando vapor (cardápio sendo preparado, pedido em preparo). */
export function CookingArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--cook ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="130" cy="160" rx="92" ry="5" />
      <g className="art-steam">
        <path d="M106 32 C100 24 112 18 106 8" />
        <path d="M130 26 C124 18 136 12 130 2" />
        <path d="M154 32 C148 24 160 18 154 8" />
      </g>
      {/* fogo e boca do fogão */}
      <g className="art-fire">
        <path
          className="art-ink art-flame"
          strokeWidth="2.5"
          d="M98 151 C90 143 95 134 100 128 C101 135 109 139 105 151 Z"
        />
        <path
          className="art-ink art-flame"
          strokeWidth="2.5"
          d="M127 151 C118 142 124 131 130 124 C131 132 140 137 134 151 Z"
        />
        <path
          className="art-ink art-flame"
          strokeWidth="2.5"
          d="M156 151 C148 143 153 134 158 128 C159 135 167 139 163 151 Z"
        />
      </g>
      <rect className="art-ink art-seat" x="58" y="149" width="144" height="8" rx="4" />
      {/* panela */}
      <rect className="art-ink art-brand-dark" x="46" y="88" width="28" height="13" rx="6.5" />
      <rect className="art-ink art-brand-dark" x="186" y="88" width="28" height="13" rx="6.5" />
      <path
        className="art-ink art-brand"
        d="M70 80 H190 V118 C190 128 182 136 172 136 H88 C78 136 70 128 70 118 Z"
      />
      <path className="art-shine" d="M80 92 V120" />
      <circle className="art-ink art-white" cx="130" cy="108" r="14" strokeWidth="2.5" />
      <path className="art-cutlery" d="M125 100v16M134 100v16M122.5 100v5a2.5 2.5 0 0 0 5 0v-5" />
      <rect className="art-ink art-brand-dark" x="64" y="74" width="132" height="12" rx="6" />
      {/* tampa (pula com o vapor) */}
      <g className="art-lid">
        <rect className="art-ink art-brand-dark" x="121" y="34" width="18" height="11" rx="4" />
        <path
          className="art-ink art-brand-deep"
          d="M78 72 C82 54 104 44 130 44 C156 44 178 54 182 72 Z"
        />
        <path className="art-shine" d="M96 62 C102 56 110 52 120 51" />
      </g>
    </svg>
  );
}

/** Lupa procurando em cima do prato vazio (busca sem resultado, produto que sumiu). */
export function SearchArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--search ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="122" cy="157" rx="100" ry="7" />
      <path className="art-spark" d="M36 40v12M30 46h12" />
      {/* prato vazio, talheres e farelos */}
      <path
        className="art-ink art-metal"
        strokeWidth="2.5"
        d="M22 108 V148 M17 108 V118 C17 122 27 122 27 118 V108"
      />
      <path
        className="art-ink art-metal"
        strokeWidth="2.5"
        d="M196 148 V106 C205 110 207 124 196 130"
      />
      <ellipse className="art-ink art-white" cx="108" cy="140" rx="76" ry="14" />
      <ellipse className="art-plate-in" cx="108" cy="138" rx="54" ry="8" />
      <circle className="art-crumb" cx="94" cy="137" r="2" />
      <circle className="art-crumb" cx="118" cy="140" r="1.6" />
      <circle className="art-crumb" cx="106" cy="134" r="1.4" />
      {/* lupa */}
      <g className="art-loupe">
        <path className="art-handle-ink" d="M196 92 L228 124" />
        <path className="art-handle" d="M196 92 L228 124" />
        <circle className="art-lens" cx="164" cy="62" r="34" />
        <circle className="art-ring-ink" cx="164" cy="62" r="34" />
        <circle className="art-ring" cx="164" cy="62" r="34" />
        <path className="art-glass-shine" d="M141 52 C144 44 150 38 158 36" />
        <path
          className="art-question"
          d="M154 54 C154 46 159 42 165 42 C171 42 176 46 176 52 C176 58 170 60 166 64 V70"
        />
        <circle className="art-question-dot" cx="166" cy="80" r="3.6" />
      </g>
    </svg>
  );
}

/** Lojinha de porta fechada, com lua e estrelas (loja fechada agora). */
export function ClosedArt({ live = false, className = '' }: ArtProps) {
  return (
    <svg
      className={`art art--closed ${className}`}
      data-live={live || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="140" cy="155" rx="108" ry="7" />
      <path className="art-ink art-light" d="M40 10 A22 22 0 1 0 62 46 A17 17 0 1 1 40 10 Z" />
      <g className="art-stars">
        <path className="art-star" d="M76 20 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" />
        <path
          className="art-star"
          d="M240 18 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 Z"
        />
        <path
          className="art-star"
          d="M22 66 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 Z"
        />
      </g>
      <rect className="art-ink art-wall" x="70" y="58" width="150" height="96" rx="4" />
      <path className="art-ink art-white" d="M62 58 L74 32 H216 L228 58 Z" />
      <g className="art-ink art-brand">
        <path d="M74 32 L62 58 H86 L94 32 Z" />
        <path d="M114 32 L110 58 H134 L134 32 Z" />
        <path d="M154 32 L158 58 H182 L174 32 Z" />
        <path d="M194 32 L206 58 H228 L216 32 Z" />
      </g>
      <path
        className="art-ink art-none"
        d="M62 58 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q12 12 24 0 q11 12 22 0"
      />
      <rect className="art-ink art-night" x="82" y="80" width="62" height="42" rx="4" />
      <path className="art-glass-shine art-glass-shine--dim" d="M90 88h14M90 96h8" />
      <rect className="art-ink art-brand-deep" x="158" y="80" width="46" height="74" rx="4" />
      <circle className="art-knob" cx="195" cy="118" r="3" />
      {/* plaquinha "fechado" pendurada */}
      <path className="art-ink art-none" strokeWidth="2" d="M168 98 L181 86 L194 98" />
      <circle className="art-knob" cx="181" cy="86" r="2.4" />
      <rect
        className="art-ink art-red"
        x="163"
        y="97"
        width="36"
        height="17"
        rx="3"
        strokeWidth="2.5"
      />
      <path className="art-paper-line art-paper-line--white" d="M171 105.5 H191" />
      {/* vaso */}
      <path className="art-ink art-pot" d="M30 134 H52 L49 154 H33 Z" />
      <path
        className="art-ink art-leaf"
        d="M41 134 C33 126 31 116 35 108 C43 114 45 124 41 134 Z"
      />
      <path
        className="art-ink art-leaf"
        d="M41 134 C47 124 53 120 59 120 C57 128 51 134 41 134 Z"
      />
    </svg>
  );
}

/**
 * Sacola de papel com o selo da loja. `done`: selo verde de concluído (pedido enviado, entregue);
 * sem ele, sai fumacinha (pedido pronto, quentinho).
 */
export function BagArt({
  done = false,
  live = false,
  className = '',
}: ArtProps & { done?: boolean }) {
  return (
    <svg
      className={`art art--bag ${className}`}
      data-live={live || undefined}
      data-done={done || undefined}
      viewBox="0 0 260 170"
      aria-hidden
      focusable="false"
    >
      <ellipse className="art-shadow" cx="134" cy="157" rx="76" ry="7" />
      <path className="art-spark" d="M48 104v12M42 110h12" />
      <path className="art-spark" d="M222 112v10M217 117h10" />
      {!done && (
        <g className="art-steam">
          <path d="M112 34 C106 26 118 20 112 10" />
          <path d="M134 30 C128 22 140 16 134 6" />
          <path d="M156 34 C150 26 162 20 156 10" />
        </g>
      )}
      <g className="art-bagbody">
        <path className="art-ink art-none" strokeWidth="4" d="M110 66 C110 38 158 38 158 66" />
        <path className="art-ink art-kraft-dark" d="M182 62 L198 70 L192 148 L176 152 Z" />
        <path className="art-ink art-kraft" d="M86 62 H182 L176 152 H92 Z" />
        <path className="art-ink art-kraft-dark" d="M86 62 H182 L181 74 H87 Z" />
        <path className="art-shine" d="M98 86 V138" />
        <circle className="art-ink art-white" cx="134" cy="110" r="19" strokeWidth="2.5" />
        <path
          className="art-cutlery"
          d="M128 100v20M140 100c5 3 5 10 0 13v7M125 100v6a3 3 0 0 0 6 0v-6"
        />
        <path className="art-ink art-heart" strokeWidth="2.2" d={heartPath(66, 56, 18)} />
      </g>
      {done && (
        <g className="art-seal">
          <circle className="art-ink art-ok" cx="190" cy="58" r="20" />
          <path className="art-seal-check" d="M180.5 58.5 l6.5 6.5 l12.5 -13" />
        </g>
      )}
    </svg>
  );
}
