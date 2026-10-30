import { Spinner } from '../design-system';

/** Enquanto o arquivo da tela chega (só na primeira vez que ela abre). */
export function PageLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 160 }}>
      <Spinner />
    </div>
  );
}
