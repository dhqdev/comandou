import { LivePanda } from '../../design-system';
import './mascot.css';

/** O panda do topo: fica olhando de um lado para o outro e reage quando tocam nele. */
export function PandaBrand({ size }: { size: number }) {
  return (
    <span className="pw-brand">
      <LivePanda size={size} title="Comandou" />
    </span>
  );
}
