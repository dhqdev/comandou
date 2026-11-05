import './art.css';

/**
 * Ilustrações do cardápio, em estilo desenho (traço escuro e cores chapadas). Pintadas com a cor
 * da loja (--cm-brand-*) e a de destaque (--cm-accent-*): combinam com qualquer identidade.
 * São decorativas (aria-hidden); o texto ao lado diz o que importa.
 */

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

/** Lojinha com toldo e a sacola pronta na porta (retirada no balcão). */
export function PickupArt({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`art art--pickup ${className}`}
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
      <g className="art-bag">
        <path className="art-ink art-kraft" d="M188 104 H236 L232 152 H192 Z" />
        <path className="art-ink art-kraft-dark" d="M188 104 H236 L234 112 H190 Z" />
        <path className="art-ink art-none" d="M202 104 C202 92 222 92 222 104" />
        <circle className="art-ink art-white" cx="212" cy="131" r="9.5" strokeWidth="2.5" />
        <path className="art-cutlery" d="M208 127v8M216 127v8" />
      </g>
      <path className="art-ink art-pot" d="M18 132 H38 L35 152 H21 Z" />
      <path
        className="art-ink art-leaf"
        d="M28 132 C20 124 18 114 22 106 C30 112 32 122 28 132 Z"
      />
      <path
        className="art-ink art-leaf"
        d="M28 132 C34 122 40 118 46 118 C44 126 38 132 28 132 Z"
      />
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
    <PickupArt className={className} />
  );
}
