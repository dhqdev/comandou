import {
  bigFigures,
  button,
  codeBox,
  divider,
  esc,
  fallbackLink,
  firstName,
  longDate,
  note,
  p,
  plain,
  rows,
  shell,
  shortDate,
  steps,
  strong,
} from './kit';

/**
 * Os e-mails do Comandou. Cada função devolve assunto, HTML e texto puro (o texto vai junto para
 * quem lê e-mail sem HTML e para não cair no spam). `assets` é o site do Comandou
 * (https://comandou.com), de onde vêm o panda e o ícone.
 */
export interface Mail {
  subject: string;
  html: string;
  text: string;
}

const hello = (name: string | null | undefined) => {
  const n = firstName(name);
  return n ? `${esc(n)}, ` : '';
};
const Hello = (name: string | null | undefined) => {
  const n = firstName(name);
  return n ? `Oi, ${esc(n)}!` : 'Oi!';
};

// ------------------------------------------------------------------ boas-vindas

export interface WelcomeEmailInput {
  restaurant: string;
  contactName: string;
  /** Endereço do restaurante novo (https://<slug>.<domínio>). */
  url: string;
  loginEmail: string;
  password: string;
  trialDays: number;
  trialEndsAt: Date;
  /** Site do Comandou (https://<domínio>), para o panda, o logo e o rodapé. */
  siteUrl: string;
  /** WhatsApp ou e-mail de vendas (Super Admin › Cobrança). */
  salesContact?: string;
}

export function trialEndLabel(d: Date): string {
  return longDate(d, true);
}

export function welcomeEmail(i: WelcomeEmailInput): Mail {
  const name = firstName(i.contactName);
  const host = i.url.replace(/^https?:\/\//, '');
  const ends = trialEndLabel(i.trialEndsAt);
  const contact = i.salesContact?.trim();
  const subject = `${i.restaurant} já está no ar no Comandou 🎉`;
  const html = shell({
    title: subject,
    preheader: `Seu endereço, login e senha estão aqui. O teste grátis vale por ${i.trialDays} dias.`,
    assets: i.siteUrl,
    panda: 'ola',
    heading: `${name ? `${esc(name)}, boas-vindas` : 'Boas-vindas'} ao Comandou!`,
    lead: `O ${strong(i.restaurant)} já está no ar. Ele é seu por ${i.trialDays} dias para testar tudo: cardápio online, pedidos, salão, cozinha, caixa e entregas.`,
    body: [
      rows([
        {
          label: 'Endereço do seu restaurante',
          value: `<a href="${esc(i.url)}" style="color:inherit;text-decoration:none;">${esc(host)}</a>`,
        },
        { label: 'Login', value: esc(i.loginEmail) },
        { label: 'Senha', value: esc(i.password), mono: true },
      ]),
      button('Abrir meu restaurante', i.url),
      p('Guarde este e-mail. Você troca a senha quando quiser em Configurações.', {
        center: true,
        small: true,
      }),
      divider(),
      steps(
        [
          {
            title: 'Monte o cardápio em minutos',
            text: 'Mande o PDF, tire foto do cardápio ou cole o link. A gente lê os itens, os preços e as fotos para você só conferir.',
          },
          {
            title: 'Deixe com a sua cara',
            text: 'Logo, cores, horário e endereço. A prévia da loja aparece ao lado enquanto você ajusta.',
          },
          {
            title: 'Faça um pedido de teste',
            text: 'Abra o cardápio no celular, peça e veja o pedido chegar na cozinha e no caixa.',
          },
          {
            title: 'Chame a equipe',
            text: 'Garçom e entregador entram com um PIN de 4 números. Cada um vê só o que precisa.',
          },
        ],
        'Para começar com o pé direito',
      ),
      note(
        `⏳ O teste vai até <strong>${esc(ends)}</strong>. Gostou? ${contact ? `Fale com a gente pelo <strong>${esc(contact)}</strong>` : 'Responda este e-mail'} e o restaurante continua no ar, com tudo o que você cadastrou.`,
        'warn',
      ),
    ],
    footer: `Você recebeu este e-mail porque criou um teste em ${esc(i.siteUrl.replace(/^https?:\/\//, ''))}. Não foi você? É só ignorar: o teste se encerra sozinho.`,
  });
  const text = plain([
    `${name ? `${name}, boas-vindas` : 'Boas-vindas'} ao Comandou!`,
    `O ${i.restaurant} já está no ar.`,
    '',
    `Endereço: ${i.url}`,
    `Login: ${i.loginEmail}`,
    `Senha: ${i.password}`,
    '',
    `O teste vai até ${ends}.`,
    contact ? `Gostou? Fale com a gente: ${contact}` : 'Gostou? Responda este e-mail.',
  ]);
  return { subject, html, text };
}

// ------------------------------------------------------------------ código de nova senha

export interface AccessEmailInput {
  restaurant: string;
  ownerName: string;
  /** Endereço do restaurante (https://<slug>.<domínio>). */
  url: string;
  loginEmail: string;
  password: string;
  /** Site do Comandou (https://<domínio>), para o panda, o logo e o rodapé. */
  siteUrl: string;
  /** WhatsApp ou e-mail de vendas (Super Admin › Cobrança). */
  salesContact?: string;
}

/**
 * Restaurante criado pelo Super Admin (Restaurantes › Criar restaurante): o endereço, o login e a
 * senha inicial do dono. Mesmo visual do e-mail de boas-vindas do site, sem a parte do teste.
 */
export function accessEmail(i: AccessEmailInput): Mail {
  const name = firstName(i.ownerName);
  const host = i.url.replace(/^https?:\/\//, '');
  const contact = i.salesContact?.trim();
  const subject = `Seu acesso ao ${i.restaurant} no Comandou`;
  const html = shell({
    title: subject,
    preheader: 'O endereço do seu restaurante, o login e a senha estão aqui.',
    assets: i.siteUrl,
    panda: 'ola',
    heading: `${name ? `${esc(name)}, o ` : 'O '}${esc(i.restaurant)} está pronto no Comandou!`,
    lead: 'Criamos o seu restaurante. Guarde este e-mail: aqui estão o endereço, o seu login e a senha para entrar.',
    body: [
      rows([
        {
          label: 'Endereço do seu restaurante',
          value: `<a href="${esc(i.url)}" style="color:inherit;text-decoration:none;">${esc(host)}</a>`,
        },
        { label: 'Login', value: esc(i.loginEmail) },
        { label: 'Senha', value: esc(i.password), mono: true },
      ]),
      button('Abrir meu restaurante', i.url),
      p(
        'Troque a senha quando quiser em Configurações. Se você já tinha conta no Comandou com este e-mail, entre com a senha de sempre. A página ainda não abriu? Espere um minutinho: o restaurante está terminando de ser preparado.',
        { center: true, small: true },
      ),
      divider(),
      steps(
        [
          {
            title: 'Monte o cardápio em minutos',
            text: 'Mande o PDF, tire foto do cardápio ou cole o link. A gente lê os itens, os preços e as fotos para você só conferir.',
          },
          {
            title: 'Deixe com a sua cara',
            text: 'Logo, cores, horário e endereço. A prévia da loja aparece ao lado enquanto você ajusta.',
          },
          {
            title: 'Faça um pedido de teste',
            text: 'Abra o cardápio no celular, peça e veja o pedido chegar na cozinha e no caixa.',
          },
        ],
        'Para começar',
      ),
      note(
        `Precisa de ajuda? ${contact ? `Fale com a gente pelo <strong>${esc(contact)}</strong>` : 'Responda este e-mail'}.`,
        'info',
      ),
    ],
    footer: 'Você recebeu este e-mail porque a equipe do Comandou criou o seu restaurante.',
  });
  const text = plain([
    `${name ? `${name}, o ` : 'O '}${i.restaurant} está pronto no Comandou!`,
    '',
    `Endereço: ${i.url}`,
    `Login: ${i.loginEmail}`,
    `Senha: ${i.password}`,
    '',
    'Troque a senha quando quiser em Configurações.',
    contact
      ? `Precisa de ajuda? Fale com a gente: ${contact}`
      : 'Precisa de ajuda? Responda este e-mail.',
  ]);
  return { subject, html, text };
}

export interface PasswordCodeInput {
  name?: string | null;
  code: string;
  minutes: number;
  /** Onde a pessoa vai entrar: o nome do restaurante ou "Super Admin". */
  place: string;
  assets: string;
  /** Quem pediu (IP), mostrado no aviso de segurança. */
  ip?: string | null;
}

/**
 * Código para criar uma nova senha (equipe do restaurante e Super Admin). O código vem no começo
 * do assunto e na linha de prévia: aparece na notificação e na lista de e-mails, dá para copiar
 * sem abrir, e o iPhone e o Mac oferecem preencher sozinho.
 */
export function passwordCodeEmail(i: PasswordCodeInput): Mail {
  const subject = `${i.code} é o seu código do Comandou`;
  const html = shell({
    title: subject,
    preheader: `Código ${i.code} para criar uma nova senha em ${i.place}. Vale por ${i.minutes} minutos.`,
    assets: i.assets,
    panda: 'codigo',
    heading: 'Seu código para criar uma nova senha',
    lead: `${hello(i.name)}${i.name ? 'digite' : 'Digite'} este código na tela de nova senha de ${strong(i.place)}.`,
    body: [
      codeBox(i.code, `Vale por ${i.minutes} minutos e só funciona uma vez`),
      p(
        'Sua senha continua a mesma até você digitar o código e escolher a nova. Depois disso, a conta sai dos outros aparelhos.',
        { center: true, small: true },
      ),
      note(
        `🔒 Não pediu? É só ignorar este e-mail: nada muda na sua conta. Ninguém do Comandou pede este código${i.ip ? ` (pedido feito do IP ${esc(i.ip)})` : ''}.`,
        'info',
      ),
    ],
  });
  const text = plain([
    `Seu código para criar uma nova senha em ${i.place}:`,
    '',
    i.code,
    '',
    `Vale por ${i.minutes} minutos e só funciona uma vez.`,
    'Não pediu? É só ignorar este e-mail: nada muda na sua conta.',
  ]);
  return { subject, html, text };
}

/** Código para o cliente do cardápio online: sai com o nome do restaurante. */
export interface CustomerResetInput {
  restaurant: string;
  customerName?: string | null;
  code: string;
  minutes: number;
  assets: string;
}

export function customerResetEmail(i: CustomerResetInput): Mail {
  const subject = `${i.code} é o seu código para criar uma nova senha em ${i.restaurant}`;
  const html = shell({
    title: subject,
    preheader: `Código ${i.code}. Vale por ${i.minutes} minutos.`,
    assets: i.assets,
    brand: { name: i.restaurant },
    panda: 'codigo',
    heading: `${firstName(i.customerName) ? `${esc(firstName(i.customerName))}, aqui está` : 'Aqui está'} o seu código`,
    lead: `Digite este código na tela de nova senha do cardápio de ${strong(i.restaurant)}.`,
    body: [
      codeBox(i.code, `Vale por ${i.minutes} minutos e só funciona uma vez`),
      p(
        'Sua senha continua a mesma até você digitar o código e escolher a nova. Não pediu? É só ignorar este e-mail.',
        { center: true, small: true },
      ),
    ],
  });
  const text = plain([
    `${firstName(i.customerName) ? `${firstName(i.customerName)}, aqui está` : 'Aqui está'} o seu código para criar uma nova senha em ${i.restaurant}:`,
    '',
    i.code,
    '',
    `O código vale por ${i.minutes} minutos e só funciona uma vez.`,
    'Não pediu? É só ignorar este e-mail: nada muda na sua conta.',
  ]);
  return { subject, html, text };
}

/** Aviso de segurança depois da troca pela tela de nova senha. */
export function passwordChangedEmail(i: {
  name?: string | null;
  place: string;
  when: Date;
  ip?: string | null;
  loginUrl: string;
  assets: string;
}): Mail {
  const subject = `Sua senha do Comandou foi trocada`;
  const when = longDate(i.when, true);
  const html = shell({
    title: subject,
    preheader: `A senha de ${i.place} foi trocada ${when}. Foi você? Então está tudo certo.`,
    assets: i.assets,
    panda: 'codigo',
    heading: 'Senha nova, tudo certo',
    lead: `${hello(i.name)}${i.name ? 'a' : 'A'} senha para entrar em ${strong(i.place)} foi trocada ${esc(when)}${i.ip ? ` (IP ${esc(i.ip)})` : ''}.`,
    body: [
      button('Entrar com a senha nova', i.loginUrl),
      note(
        '⚠️ Não foi você? Peça um código novo na tela de entrada (Esqueci minha senha) e troque a senha agora. Depois, avise o administrador do restaurante.',
        'warn',
      ),
    ],
  });
  const text = plain([
    `A senha para entrar em ${i.place} foi trocada ${when}.`,
    '',
    `Entrar: ${i.loginUrl}`,
    '',
    'Não foi você? Peça um código novo em "Esqueci minha senha" e troque a senha agora.',
  ]);
  return { subject, html, text };
}

// ------------------------------------------------------------------ teste grátis e cobrança

export interface LifecycleBase {
  name?: string | null;
  restaurant: string;
  /** Tela Plano do restaurante (https://<slug>.<domínio>/plano). */
  planUrl: string;
  assets: string;
  /** WhatsApp ou e-mail de vendas (Super Admin › Cobrança). */
  contact?: string | null;
}

const contactLine = (c?: string | null) =>
  c?.trim()
    ? `Ficou alguma dúvida? Fale com a gente: ${strong(c.trim())}.`
    : 'Ficou alguma dúvida? É só responder este e-mail.';

/** O teste grátis acaba em breve (sai na véspera). */
export function trialEndingEmail(i: LifecycleBase & { endsAt: Date; price?: string | null }): Mail {
  const ends = longDate(i.endsAt, true);
  const subject = `Seu teste grátis do Comandou acaba amanhã`;
  const html = shell({
    title: subject,
    preheader: `O teste do ${i.restaurant} vai até ${ends}. Continue sem perder nada do que você cadastrou.`,
    assets: i.assets,
    panda: 'relogio',
    heading: 'Seu teste acaba amanhã',
    lead: `${Hello(i.name)} O teste grátis do ${strong(i.restaurant)} vai até ${strong(ends)}.`,
    body: [
      p(
        'Para continuar usando, é só escolher o plano na tela Plano. Cardápio, pedidos, clientes e tudo o que você montou continuam do jeito que estão.',
      ),
      ...(i.price ? [bigFigures([{ label: 'Mensalidade', value: i.price }])] : []),
      button('Continuar com o Comandou', i.planUrl),
      p(contactLine(i.contact), { center: true, small: true }),
    ],
    footer: `Você recebeu este aviso porque é o responsável pelo ${esc(i.restaurant)} no Comandou.`,
  });
  const text = plain([
    `O teste grátis do ${i.restaurant} vai até ${ends}.`,
    'Para continuar, escolha o plano na tela Plano. Nada do que você cadastrou se perde.',
    i.price ? `Mensalidade: ${i.price}` : null,
    '',
    i.planUrl,
  ]);
  return { subject, html, text };
}

/** O teste grátis terminou (o restaurante fica pausado, nada é apagado). */
export function trialEndedEmail(i: LifecycleBase): Mail {
  const subject = `Seu teste grátis terminou, mas o ${i.restaurant} continua guardado`;
  const html = shell({
    title: subject,
    preheader: 'Nada foi apagado: cardápio, pedidos e clientes estão esperando por você.',
    assets: i.assets,
    panda: 'dormindo',
    heading: 'Seu teste grátis terminou',
    lead: `${Hello(i.name)} O ${strong(i.restaurant)} está pausado, mas fica tudo guardado: cardápio, fotos, pedidos, clientes e configurações.`,
    body: [
      steps([
        {
          title: 'Escolha o plano',
          text: 'Um plano só, com tudo incluso. Pague por PIX, boleto ou cartão.',
        },
        {
          title: 'Tudo volta na hora',
          text: 'Assim que o pagamento cair, o restaurante volta ao ar do jeito que estava.',
        },
      ]),
      button('Reativar meu restaurante', i.planUrl),
      p(contactLine(i.contact), { center: true, small: true }),
    ],
    footer: `Você recebeu este aviso porque é o responsável pelo ${esc(i.restaurant)} no Comandou.`,
  });
  const text = plain([
    `O teste grátis do ${i.restaurant} terminou. Nada foi apagado.`,
    'Escolha o plano para o restaurante voltar ao ar do jeito que estava:',
    i.planUrl,
  ]);
  return { subject, html, text };
}

export interface InvoiceInfo {
  /** Valor já formatado (R$ 149,90). */
  amount: string;
  /** AAAA-MM-DD. */
  dueDate: string;
  /** Link de pagamento (PIX, boleto ou cartão); sem ele, a tela Plano. */
  payUrl?: string | null;
  description?: string | null;
}

/** Mensalidade vence em breve. */
export function paymentDueEmail(i: LifecycleBase & InvoiceInfo & { daysLeft: number }): Mail {
  const when = i.daysLeft <= 0 ? 'hoje' : i.daysLeft === 1 ? 'amanhã' : `em ${i.daysLeft} dias`;
  const subject = `Sua mensalidade do Comandou vence ${when} (${shortDate(i.dueDate)})`;
  const url = i.payUrl || i.planUrl;
  const html = shell({
    title: subject,
    preheader: `${i.amount} com vencimento em ${shortDate(i.dueDate)}. Pague por PIX, boleto ou cartão em um toque.`,
    assets: i.assets,
    panda: 'relogio',
    heading: `Sua mensalidade vence ${when}`,
    lead: `${Hello(i.name)} Passando para lembrar da mensalidade do ${strong(i.restaurant)}.`,
    body: [
      bigFigures([
        { label: 'Valor', value: i.amount },
        { label: 'Vencimento', value: shortDate(i.dueDate) },
      ]),
      ...(i.description ? [p(esc(i.description), { center: true, small: true })] : []),
      button('Pagar agora', url),
      fallbackLink(url),
      p('Já pagou? Pode ignorar este lembrete: a baixa é automática.', {
        center: true,
        small: true,
      }),
    ],
    footer: `Você recebeu este lembrete porque é o responsável pelo ${esc(i.restaurant)} no Comandou.`,
  });
  const text = plain([
    `A mensalidade do ${i.restaurant} vence ${when} (${shortDate(i.dueDate)}).`,
    `Valor: ${i.amount}`,
    '',
    `Pagar: ${url}`,
    'Já pagou? Pode ignorar este lembrete.',
  ]);
  return { subject, html, text };
}

/** Mensalidade vencida (antes ou depois do bloqueio). */
export function paymentOverdueEmail(
  i: LifecycleBase & InvoiceInfo & { blockOn?: string | null; blocked?: boolean },
): Mail {
  const subject = i.blocked
    ? `O ${i.restaurant} foi pausado por falta de pagamento`
    : `Sua mensalidade do Comandou venceu em ${shortDate(i.dueDate)}`;
  const url = i.payUrl || i.planUrl;
  const html = shell({
    title: subject,
    preheader: i.blocked
      ? 'Pague a mensalidade e o restaurante volta ao ar na hora, sem perder nada.'
      : `${i.amount} em aberto. Pague para não ter o sistema pausado.`,
    assets: i.assets,
    panda: 'alerta',
    heading: i.blocked ? 'Seu restaurante está pausado' : 'Sua mensalidade venceu',
    lead: i.blocked
      ? `${Hello(i.name)} O ${strong(i.restaurant)} foi pausado porque a mensalidade não foi paga. Nada foi apagado.`
      : `${Hello(i.name)} Não encontramos o pagamento da mensalidade do ${strong(i.restaurant)}.`,
    body: [
      bigFigures([
        { label: 'Valor', value: i.amount },
        { label: 'Venceu em', value: shortDate(i.dueDate) },
      ]),
      ...(!i.blocked && i.blockOn
        ? [
            note(
              `Para não parar as vendas, pague até <strong>${esc(shortDate(i.blockOn))}</strong>. Depois disso o sistema é pausado até o pagamento cair.`,
              'danger',
            ),
          ]
        : []),
      button(i.blocked ? 'Pagar e voltar ao ar' : 'Pagar agora', url),
      fallbackLink(url),
      p(`Já pagou? Pode ignorar: a baixa é automática. ${contactLine(i.contact)}`, {
        center: true,
        small: true,
      }),
    ],
    footer: `Você recebeu este aviso porque é o responsável pelo ${esc(i.restaurant)} no Comandou.`,
  });
  const text = plain([
    i.blocked
      ? `O ${i.restaurant} foi pausado porque a mensalidade não foi paga. Nada foi apagado.`
      : `A mensalidade do ${i.restaurant} venceu em ${shortDate(i.dueDate)}.`,
    `Valor: ${i.amount}`,
    !i.blocked && i.blockOn
      ? `Pague até ${shortDate(i.blockOn)} para não ter o sistema pausado.`
      : null,
    '',
    `Pagar: ${url}`,
  ]);
  return { subject, html, text };
}

/** Pagamento confirmado. */
export function paymentReceivedEmail(
  i: LifecycleBase & { amount: string; paidOn: string; until?: Date | null },
): Mail {
  const subject = `Pagamento recebido. Obrigado! ✅`;
  const html = shell({
    title: subject,
    preheader: `Recebemos ${i.amount} do ${i.restaurant}.${i.until ? ` Tudo liberado até ${shortDate(i.until)}.` : ''}`,
    assets: i.assets,
    panda: 'festa',
    heading: 'Pagamento recebido!',
    lead: `${Hello(i.name)} Obrigado por continuar com a gente. O ${strong(i.restaurant)} segue no ar.`,
    body: [
      bigFigures([
        { label: 'Valor pago', value: i.amount },
        { label: 'Pago em', value: shortDate(i.paidOn) },
        ...(i.until ? [{ label: 'Liberado até', value: shortDate(i.until) }] : []),
      ]),
      button('Ver meu plano', i.planUrl),
      p('O comprovante fica na tela Plano, junto com as faturas anteriores.', {
        center: true,
        small: true,
      }),
    ],
    footer: `Você recebeu este e-mail porque é o responsável pelo ${esc(i.restaurant)} no Comandou.`,
  });
  const text = plain([
    `Recebemos ${i.amount} do ${i.restaurant} em ${shortDate(i.paidOn)}. Obrigado!`,
    i.until ? `Tudo liberado até ${shortDate(i.until)}.` : null,
    '',
    i.planUrl,
  ]);
  return { subject, html, text };
}

// ------------------------------------------------------------------ contrato e teste

/** E-mail dos contratos (enviar para assinar, assinatura recebida, via final). */
export function contractEmail(i: {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  assets: string;
  preheader?: string;
}): string {
  return shell({
    title: i.heading,
    preheader: i.preheader ?? i.paragraphs.find((x) => !/^Olá/.test(x)) ?? i.heading,
    assets: i.assets,
    panda: 'contrato',
    heading: esc(i.heading),
    body: [
      ...i.paragraphs.map((x) => p(esc(x))),
      ...(i.button ? [button(i.button.label, i.button.url), fallbackLink(i.button.url)] : []),
    ],
  });
}

/** E-mail de teste do Super Admin › E-mail. */
export function testEmail(assets: string): Mail {
  const subject = 'Teste do e-mail do Comandou';
  return {
    subject,
    html: shell({
      title: subject,
      preheader: 'Se este e-mail chegou, o envio pelo Resend está funcionando.',
      assets,
      panda: 'festa',
      heading: 'Chegou! O envio está funcionando',
      lead: 'Este é um e-mail de teste enviado pelo painel do Comandou.',
      body: [
        p(
          'Boas-vindas do teste, códigos de nova senha, lembretes de mensalidade e contratos saem por aqui, pelo Resend.',
          { center: true },
        ),
      ],
    }),
    text: 'Teste do e-mail do Comandou: se este e-mail chegou, o envio pelo Resend está funcionando.',
  };
}
