import { LivePanda } from '../../design-system';
import { openWardrobe, useMascot } from './state';
import './mascot.css';

/** O panda do topo, vestido com a roupa da pessoa. Tocar nele abre o guarda-roupa. */
export function PandaButton({ size }: { size: number }) {
  const { outfit } = useMascot();
  return (
    <button
      type="button"
      className="pw-brand"
      onClick={openWardrobe}
      aria-label="Seu panda: trocar a roupa"
      title="Seu panda: trocar a roupa"
    >
      <LivePanda size={size} outfit={outfit} />
    </button>
  );
}
