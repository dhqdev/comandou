import { describe, expect, it } from 'vitest';
import {
  appPlaces,
  hasAppLink,
  isPlaceQuestion,
  linkPlaces,
  placeFor,
  placesFor,
  safeAppPath,
} from './ai-places';
import { isKnownAppPath } from './nav-catalog';
import { roleHas, type Role } from './roles';

const all = () => true;
/** O que cada perfil abre (o mesmo teste das telas: basta uma das permissões). */
const canOf = (role: Role) => (perms?: string[]) =>
  !perms?.length || perms.some((p) => roleHas(role, p as never));

describe('lugares do sistema', () => {
  it('todo lugar cai numa tela que existe', () => {
    expect(appPlaces().length).toBeGreaterThan(80);
    for (const p of appPlaces()) expect(isKnownAppPath(p.path), p.id).toBe(true);
  });

  it('acha pelo nome que a IA escreve em negrito, com ou sem o caminho do menu', () => {
    expect(placeFor('Conta › Uso de IA')?.path).toBe('/conta/uso-ia');
    expect(placeFor('Conta > Uso de IA')?.path).toBe('/conta/uso-ia');
    expect(placeFor('Uso de IA')?.path).toBe('/conta/uso-ia');
    expect(placeFor('Assinatura')?.path).toBe('/plano');
    expect(placeFor('Gestão › Financeiro › DRE')?.path).toBe('/financeiro?aba=dre');
    expect(placeFor('Pedido mínimo')?.path).toBe(
      '/loja-online?aba=funcionamento&foco=campo-pedido-minimo',
    );
    expect(placeFor('Loja online › Funcionamento › Pedido mínimo')?.path).toContain(
      'foco=campo-pedido-minimo',
    );
    expect(placeFor('Conta › Ajustes › Mesas do salão')?.path).toBe(
      '/configuracoes?foco=secao-mesas',
    );
    expect(placeFor('tela Caixa')?.path).toBe('/caixa');
    expect(placeFor('Nova venda')?.path).toBe('/?foco=botao-nova-venda');
    // Parte do caminho que não é um lugar: vale a de antes ("Insumos" fica no Estoque).
    expect(placeFor('Estoque › Insumos')?.path).toBe('/estoque');
    expect(placeFor('Uso de IA')?.where).toBe('Conta › Uso de IA');
  });

  it('não inventa lugar para botão comum nem para palavra de dois sentidos', () => {
    expect(placeFor('Salvar')).toBeNull();
    expect(placeFor('Produção')).toBeNull();
    expect(placeFor('Pix')).toBeNull();
    expect(placeFor('Mesa 12')).toBeNull();
  });

  it('só leva aonde o perfil abre', () => {
    expect(placeFor('DRE', canOf('cashier'))).toBeNull();
    expect(placeFor('DRE', canOf('owner'))?.path).toBe('/financeiro?aba=dre');
    expect(placeFor('Uso de IA', canOf('cashier'))).toBeNull();
    // Nem a tela de cima: a Conta abre, mas o Uso de IA não estaria lá para ele.
    expect(placeFor('Conta › Uso de IA', canOf('cashier'))).toBeNull();
    expect(placeFor('Abrir caixa', canOf('cashier'))?.path).toBe('/caixa?foco=botao-abrir-caixa');
  });
});

describe('lugares que combinam com a pergunta', () => {
  const first = (q: string, can = all) => placesFor(q, can)[0]?.place.path;

  it('as perguntas do David vão para o Uso de IA', () => {
    expect(first('aonde eu vejo quanto de token eu to gastando de ia no sistema ?')).toBe(
      '/conta/uso-ia',
    );
    expect(first('aonde eu controlo a quantidade de tokens que uso da ia ?')).toBe('/conta/uso-ia');
  });

  it('acha campo, seção e tela', () => {
    expect(first('onde mudo o pedido mínimo?')).toContain('foco=campo-pedido-minimo');
    expect(first('onde fica o DRE')).toBe('/financeiro?aba=dre');
    expect(first('onde troco a cor da loja')).toContain('foco=campo-cor-loja');
    expect(first('onde cadastro uma mesa')).toBe('/configuracoes?foco=secao-mesas');
    expect(first('como pago os entregadores')).toBe('/entregas?aba=acerto');
    expect(first('onde vejo as notas recusadas')).toBe('/fiscal/nfce');
    expect(first('onde fica o caixa')).toBe('/caixa');
    expect(placesFor('como conecto o whatsapp').map((x) => x.place.path)).toContain(
      '/whatsapp?foco=secao-qr',
    );
  });

  it('pergunta solta não vira chute', () => {
    expect(placesFor('Tem algo travando a loja agora?')).toEqual([]);
    expect(placesFor('oi, tudo bem?')).toEqual([]);
  });

  it('respeita o perfil', () => {
    expect(first('onde fica o DRE', canOf('cashier'))).toBeUndefined();
  });

  it('sabe quando a pergunta pede um lugar', () => {
    expect(isPlaceQuestion('aonde eu vejo quanto de token eu to gastando?')).toBe(true);
    expect(isPlaceQuestion('Cadê o botão de sangria?')).toBe(true);
    expect(isPlaceQuestion('me leva no financeiro')).toBe(true);
    expect(isPlaceQuestion('Como faço o fechamento?')).toBe(true);
    expect(isPlaceQuestion('quanto vendi hoje?')).toBe(false);
  });
});

describe('link na resposta, mesmo quando a IA esquece', () => {
  it('nome em negrito vira o botão que leva até lá (as respostas do print)', () => {
    expect(
      linkPlaces(
        'Você pode acessar a tela de **Conta** e depois clicar em **Assinatura**.',
        canOf('owner'),
      ),
    ).toBe('Você pode acessar a tela de [Conta](/conta) e depois clicar em [Assinatura](/plano).');
    expect(linkPlaces('Veja em **Conta › Uso de IA**.', canOf('owner'))).toBe(
      'Veja em [Conta › Uso de IA](/conta/uso-ia).',
    );
  });

  it('conserta link com caminho inventado e tira o endereço do próprio Comandou', () => {
    expect(linkPlaces('[Assinatura](/assinatura)', all)).toBe('[Assinatura](/plano)');
    expect(linkPlaces('[Assinatura](/conta/assinatura)', all)).toBe('[Assinatura](/plano)');
    expect(linkPlaces('[aqui](https://casa.comandou.com/conta/uso-ia)', all)).toBe(
      '[aqui](/conta/uso-ia)',
    );
    // Endereço de fora fica como está (a tela mostra só o texto).
    expect(linkPlaces('[site](https://x.com/caixa)', all)).toBe('[site](https://x.com/caixa)');
  });

  it('um botão por lugar e nada muda na segunda passada', () => {
    const t = 'Abra o **Caixa** em [Caixa](/caixa), depois **Caixa** e **Salvar**.';
    expect(linkPlaces(t, all)).toBe(t);
    const once = linkPlaces('**Uso de IA** e de novo **Uso de IA**', all);
    expect(once).toBe('[Uso de IA](/conta/uso-ia) e de novo **Uso de IA**');
    expect(linkPlaces(once, all)).toBe(once);
    expect(linkPlaces('**[Caixa](/caixa)**', all)).toBe('**[Caixa](/caixa)**');
  });

  it('sem acesso, fica o negrito', () => {
    expect(linkPlaces('Veja o **DRE**.', canOf('cashier'))).toBe('Veja o **DRE**.');
    expect(linkPlaces('Veja o **DRE**.', () => false)).toBe('Veja o **DRE**.');
  });

  it('confere se já tem link do app', () => {
    expect(hasAppLink('vá em [Caixa](/caixa)')).toBe(true);
    expect(hasAppLink('vá em [site](https://x.com)')).toBe(false);
    expect(hasAppLink('vá em **Caixa**')).toBe(false);
  });

  it('caminho seguro: só do app e sem "Página não encontrada"', () => {
    expect(safeAppPath('/caixa')).toBe('/caixa');
    expect(safeAppPath('/conta/uso-ia')).toBe('/conta/uso-ia');
    expect(safeAppPath('/conta/assinatura')).toBeNull();
    expect(safeAppPath('/financeiro/dre')).toBeNull();
    expect(safeAppPath('/estoque/fichas')).toBe('/estoque/fichas');
    expect(safeAppPath('//evil.com')).toBeNull();
    expect(safeAppPath('https://evil.com/caixa')).toBeNull();
    expect(safeAppPath('javascript:alert(1)')).toBeNull();
    expect(safeAppPath('/a/../caixa')).toBeNull();
    expect(safeAppPath('https://loja.exemplo.com/caixa', 'loja.exemplo.com')).toBe('/caixa');
  });
});
