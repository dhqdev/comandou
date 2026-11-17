import {
  accessEmail,
  contractEmail,
  customerResetEmail,
  Mail,
  passwordChangedEmail,
  passwordCodeEmail,
  paymentDueEmail,
  paymentOverdueEmail,
  paymentReceivedEmail,
  testEmail,
  trialEndedEmail,
  trialEndingEmail,
  welcomeEmail,
} from './emails';

export interface EmailSample {
  id: string;
  label: string;
  /** Quando sai. */
  when: string;
  mail: Mail;
  /** Remetente com o nome do restaurante (e-mail para o cliente da loja). */
  fromName?: string;
}

const DAY = 86_400_000;

/**
 * Todos os e-mails do sistema com dados de exemplo: a aba Modelos do Super Admin › E-mail mostra
 * cada um e manda um teste. `assets` é o site do Comandou; `tenantUrl` monta o endereço de um
 * restaurante de exemplo.
 */
export function emailSamples(
  assets: string,
  tenantUrl: (slug: string) => string,
  now = new Date(),
): EmailSample[] {
  const store = tenantUrl('fumaca-burger');
  const base = {
    name: 'Marina Souza',
    restaurant: 'Fumaça Burger',
    planUrl: `${store}/plano`,
    assets,
    contact: '(11) 99999-0000',
  };
  const due = new Date(now.getTime() + 3 * DAY).toISOString().slice(0, 10);
  const late = new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10);
  return [
    {
      id: 'welcome',
      label: 'Boas-vindas do teste grátis',
      when: 'O restaurante criado pelo site fica pronto (leva o endereço, o login e a senha)',
      mail: welcomeEmail({
        restaurant: 'Fumaça Burger',
        contactName: 'Marina Souza',
        url: store,
        loginEmail: 'marina@fumacaburger.com.br',
        password: 'k7mf-2xqp-9dhw',
        trialDays: 7,
        trialEndsAt: new Date(now.getTime() + 7 * DAY),
        siteUrl: assets,
        salesContact: '(11) 99999-0000',
      }),
    },
    {
      id: 'access',
      label: 'Acesso do restaurante criado pela equipe',
      when: 'O Super Admin cria um restaurante em Restaurantes › Criar restaurante',
      mail: accessEmail({
        restaurant: 'Fumaça Burger',
        ownerName: 'Marina Souza',
        url: store,
        loginEmail: 'marina@fumacaburger.com.br',
        password: 'k7mf-2xqp-9dhw',
        siteUrl: assets,
        salesContact: '(11) 99999-0000',
      }),
    },
    {
      id: 'password-code',
      label: 'Código de nova senha (equipe e Super Admin)',
      when: 'Alguém toca em "Esqueci minha senha" no painel, PDV, cozinha, entregas ou Super Admin',
      mail: passwordCodeEmail({
        name: 'Marina Souza',
        code: '482915',
        minutes: 15,
        place: 'Fumaça Burger',
        assets,
      }),
    },
    {
      id: 'password-changed',
      label: 'Senha trocada (aviso de segurança)',
      when: 'Logo depois de trocar a senha com o código',
      mail: passwordChangedEmail({
        name: 'Marina Souza',
        place: 'Fumaça Burger',
        when: now,
        loginUrl: store,
        assets,
      }),
    },
    {
      id: 'customer-code',
      label: 'Código de nova senha do cliente da loja',
      when: 'O cliente do cardápio online esquece a senha e a loja não tem WhatsApp conectado',
      fromName: 'Fumaça Burger',
      mail: customerResetEmail({
        restaurant: 'Fumaça Burger',
        customerName: 'João Pedro',
        code: '730264',
        minutes: 15,
        assets,
      }),
    },
    {
      id: 'trial-ending',
      label: 'Teste grátis acaba amanhã',
      when: 'Na véspera do fim do teste grátis',
      mail: trialEndingEmail({
        ...base,
        endsAt: new Date(now.getTime() + DAY),
        price: 'R$ 149,90',
      }),
    },
    {
      id: 'trial-ended',
      label: 'Teste grátis terminou',
      when: 'Quando o teste grátis acaba sem plano escolhido',
      mail: trialEndedEmail(base),
    },
    {
      id: 'payment-due',
      label: 'Mensalidade vence em breve',
      when: '3 dias antes do vencimento (e no dia, se ainda não pagou)',
      mail: paymentDueEmail({
        ...base,
        amount: 'R$ 149,90',
        dueDate: due,
        daysLeft: 3,
        payUrl: 'https://www.asaas.com/i/exemplo',
        description: 'Mensalidade do Comandou',
      }),
    },
    {
      id: 'payment-overdue',
      label: 'Mensalidade vencida',
      when: 'No dia seguinte ao vencimento sem pagamento',
      mail: paymentOverdueEmail({
        ...base,
        amount: 'R$ 149,90',
        dueDate: late,
        blockOn: new Date(now.getTime() + 3 * DAY).toISOString().slice(0, 10),
        payUrl: 'https://www.asaas.com/i/exemplo',
      }),
    },
    {
      id: 'payment-blocked',
      label: 'Restaurante pausado por falta de pagamento',
      when: 'Quando o sistema é pausado pela cobrança',
      mail: paymentOverdueEmail({
        ...base,
        amount: 'R$ 149,90',
        dueDate: late,
        blocked: true,
        payUrl: 'https://www.asaas.com/i/exemplo',
      }),
    },
    {
      id: 'payment-received',
      label: 'Pagamento recebido',
      when: 'Quando a mensalidade é paga',
      mail: paymentReceivedEmail({
        ...base,
        amount: 'R$ 149,90',
        paidOn: now.toISOString().slice(0, 10),
        until: new Date(now.getTime() + 30 * DAY),
      }),
    },
    {
      id: 'contract',
      label: 'Contrato para assinar',
      when: 'Super Admin › Restaurante › Contrato › Enviar',
      mail: {
        subject: 'Contrato do Comandou para assinar · nº 2026-0042',
        html: contractEmail({
          heading: 'Seu contrato está pronto para assinar',
          paragraphs: [
            'Olá, Marina Souza!',
            'Comandou Tecnologia enviou o contrato do Comandou de Fumaça Burger LTDA (nº 2026-0042) para você assinar.',
            'Plano: Comandou · Mensalidade: R$ 149,90 · Vigência: 12 meses',
            'Abra o link, leia o contrato até o fim e assine com o dedo, o mouse ou digitando o seu nome.',
          ],
          button: { label: 'Ler e assinar', url: 'https://admin.comandou.com/assinar/exemplo' },
          assets,
        }),
        text: 'Seu contrato está pronto para assinar.',
      },
    },
    {
      id: 'test',
      label: 'E-mail de teste',
      when: 'Botão Enviar teste da aba Resend',
      mail: testEmail(assets),
    },
  ];
}
