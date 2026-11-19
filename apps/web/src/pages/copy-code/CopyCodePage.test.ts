import { describe, expect, it } from 'vitest';
import { readCode } from './CopyCodePage';

describe('página de copiar o código', () => {
  it('só aceita os 6 números do e-mail', () => {
    expect(readCode('#482915')).toBe('482915');
    expect(readCode('#%20482915')).toBe('482915');
    expect(readCode('')).toBeNull();
    expect(readCode('#12345')).toBeNull();
    expect(readCode('#<script>')).toBeNull();
    expect(readCode('#4829150')).toBeNull();
  });
});
