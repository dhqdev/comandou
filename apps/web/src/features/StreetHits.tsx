import { MapPin } from 'lucide-react';
import { maskCep, type CepAddress } from '../lib/cep';
import './street-hits.css';

/** Lista de ruas achadas pelo nome (cada uma com o seu CEP) embaixo do campo da rua. */
export function StreetHits({
  id,
  hits,
  onPick,
}: {
  id: string;
  hits: CepAddress[];
  onPick(a: CepAddress): void;
}) {
  return (
    <ul className="street-hits" id={id} role="listbox" aria-label="Ruas encontradas">
      {hits.map((a) => (
        <li key={a.cep} role="option" aria-selected={false}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(a)}>
            <MapPin size={15} />
            <span>
              <strong>{a.street || 'CEP geral da cidade'}</strong>
              <small>
                {[a.district, `${a.city}/${a.state}`].filter(Boolean).join(' · ')} · CEP{' '}
                {maskCep(a.cep)}
              </small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
