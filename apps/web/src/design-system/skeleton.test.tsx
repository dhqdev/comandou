import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppSkeleton, Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('anuncia o carregamento para leitor de tela', () => {
    render(<Skeleton label="Carregando pedidos" />);
    const s = screen.getByRole('status');
    expect(s).toHaveAttribute('aria-busy', 'true');
    expect(s).toHaveTextContent('Carregando pedidos');
  });

  it('altura informada vira o número de linhas da lista', () => {
    const { container } = render(<Skeleton height={160} />);
    expect(container.querySelectorAll('.cm-sk__row')).toHaveLength(3);
  });

  it('cada formato desenha o seu esqueleto', () => {
    const { container, rerender } = render(<Skeleton variant="grid" rows={6} />);
    expect(container.querySelectorAll('.cm-sk__tile')).toHaveLength(6);
    rerender(<Skeleton variant="table" rows={5} />);
    expect(container.querySelectorAll('.cm-sk__tr')).toHaveLength(5);
    rerender(<Skeleton variant="board" />);
    expect(container.querySelectorAll('.cm-sk__col')).toHaveLength(3);
  });

  it('moldura do cliente não tem menu lateral nem abas', () => {
    const { container } = render(<AppSkeleton plain />);
    expect(container.firstElementChild).toHaveClass('cm-appsk--plain');
  });
});

describe('Abertura do app (index.html + boot.js)', () => {
  const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
  const boot = readFileSync(join(__dirname, '../../public/boot.js'), 'utf8');

  it('o HTML já chega com o esqueleto e a saída "Tentar de novo"', () => {
    expect(html).toMatch(/<div id="root">\s*<div id="cm-boot"/);
    expect(html).toContain('id="cm-boot-retry"');
    // a CSP não deixa script dentro do HTML: a saída mora em /boot.js
    expect(html).toContain('<script src="/boot.js"></script>');
    expect(html).not.toMatch(/<script>(?!\s*<\/script>)/);
  });

  it('cardápio do cliente: esqueleto da loja e o cardápio pedido já na abertura', () => {
    expect(html).toContain('class="cm-msk"');
    expect(boot).toContain("dataset.boot = 'menu'");
    expect(boot).toContain("'/store?mesa=' + mesa");
    // a mesma mesa lembrada que o cardápio usa (pages/public/store.ts)
    const store = readFileSync(join(__dirname, '../pages/public/store.ts'), 'utf8');
    const key = /const TABLE_KEY = '([^']+)'/.exec(store)?.[1];
    expect(key).toBeTruthy();
    expect(boot).toContain(`sessionStorage.getItem('${key}')`);
  });

  it('arquivo do app que não veio limpa o cache e recarrega uma vez só', () => {
    expect(boot).toContain('/\\/assets\\//');
    expect(boot).toContain('sessionStorage');
    expect(boot).toContain('unregister');
  });
});
