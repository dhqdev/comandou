import { CURRENT_RELEASE } from '@comandou/shared';
import { describe, expect, it } from 'vitest';

describe('versão mostrada no app', () => {
  it('é a mesma da última entrada de Novidades', () => {
    expect(__APP_RELEASE__).toBe(CURRENT_RELEASE.version);
  });
});
