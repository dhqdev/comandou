import { formatBRL, toCents } from '@comandou/shared';

/**
 * Modelo do contrato de licença de uso do Comandou (SaaS), preenchido com os dados do cliente.
 * O resultado é congelado no banco (texto exato + hash) no momento em que o contrato é gerado:
 * mudar este modelo depois não altera contratos já emitidos.
 *
 * Revisão jurídica: este texto é um ponto de partida completo, mas deve ser revisado por um
 * advogado antes do uso com clientes.
 */

export interface ContractParty {
  role: 'CONTRATADA' | 'CONTRATANTE';
  name: string;
  document: string | null;
  address: string | null;
  email: string | null;
  representative: string | null;
}

export interface ContractTerms {
  storeName: string;
  systemAddress: string;
  planName: string;
  priceMonthly: string;
  setupFee: string;
  dueDay: number;
  termMonths: number;
  startDate: string;
  trialDays: number;
  limits: string[];
  features: string[];
  slaPercent: string;
  readjustIndex: string;
  lateFeePercent: string;
  lateInterestPercent: string;
  suspendAfterDays: number;
  supportHours: string;
  forumCity: string;
  specialConditions: string | null;
}

/** Um parágrafo numerado (string) ou as alíneas do parágrafo anterior (lista). */
export type ContractItem = string | string[];

export interface ContractClause {
  title: string;
  items: ContractItem[];
}

export interface ContractContent {
  /** 1 = só o cliente assinava; 2 = cliente primeiro, contratada depois. */
  version: 1 | 2;
  number: string;
  title: string;
  issuedAt: string;
  parties: { provider: ContractParty; customer: ContractParty };
  terms: ContractTerms;
  preamble: string;
  clauses: ContractClause[];
  closing: string;
}

const UNITS = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const TENS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const HUNDREDS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** Número inteiro de 0 a 999 por extenso (masculino): 30 → "trinta". */
export function extenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return UNITS[n]!;
  if (n === 100) return 'cem';
  if (n < 100) {
    const u = n % 10;
    return TENS[Math.floor(n / 10)]! + (u ? ` e ${UNITS[u]}` : '');
  }
  const r = n % 100;
  return HUNDREDS[Math.floor(n / 100)]! + (r ? ` e ${extenso(r)}` : '');
}

/** "30 (trinta)" */
const num = (n: number) => `${n} (${extenso(n)})`;

export function formatDocument(d: string | null | undefined): string | null {
  if (!d) return null;
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

const money = (v: string) => formatBRL(toCents(v));
const pct = (v: string) => `${v.replace('.', ',')}%`;

export function dateBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
/** "26 de outubro de 2026" */
export function dateLong(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MONTHS[m! - 1]} de ${y}`;
}

function partyLine(p: ContractParty, kind: string): string {
  const doc = p.document
    ? `${p.document.replace(/\D/g, '').length === 14 ? 'inscrita no CNPJ' : 'inscrito(a) no CPF'} sob o nº ${p.document}`
    : 'documento a informar';
  return [
    `${p.role}: ${p.name}, ${doc}`,
    p.address ? `com endereço em ${p.address}` : null,
    p.email ? `e-mail ${p.email}` : null,
    p.representative ? `neste ato representada por ${p.representative}` : null,
  ]
    .filter(Boolean)
    .join(', ')
    .concat(`, doravante denominada ${kind}.`);
}

export function buildContract(input: {
  number: string;
  issuedAt: string;
  provider: ContractParty;
  customer: ContractParty;
  terms: ContractTerms;
}): ContractContent {
  const { provider: P, customer: C, terms: t } = input;
  const providerName = P.name || 'CONTRATADA';
  const sla = pct(t.slaPercent);
  const clauses: ContractClause[] = [
    {
      title: 'Definições',
      items: [
        'Para os fins deste contrato, as palavras abaixo têm o seguinte significado:',
        [
          `Plataforma ou Comandou: o sistema de gestão para restaurantes oferecido pela CONTRATADA na modalidade software como serviço (SaaS), acessado pela internet, incluindo aplicativos, painéis, APIs e atualizações;`,
          'Loja: o estabelecimento da CONTRATANTE cadastrado na Plataforma, com seu endereço próprio de acesso;',
          'Usuários: as pessoas autorizadas pela CONTRATANTE a usar a Plataforma (sócios, gerentes, caixas, garçons, cozinha, entregadores e demais funções);',
          'Clientes Finais: os consumidores da CONTRATANTE que fazem pedidos, reservas ou cadastros pela Loja;',
          'Dados da CONTRATANTE: todas as informações inseridas ou geradas pela CONTRATANTE, seus Usuários e Clientes Finais na Plataforma, como cardápio, pedidos, clientes, estoque, financeiro e documentos fiscais;',
          'Dados Pessoais, Tratamento, Controlador, Operador, Titular e Incidente de Segurança: os termos definidos na Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais, LGPD) e nos regulamentos da Autoridade Nacional de Proteção de Dados (ANPD);',
          'Plano: o conjunto de recursos, limites e preço contratado, descrito na cláusula 3;',
          'Disponibilidade: o percentual do tempo, em cada mês, em que a Plataforma está acessível e funcional pela internet, conforme a cláusula 11.',
        ],
      ],
    },
    {
      title: 'Objeto',
      items: [
        `O objeto deste contrato é a concessão, pela CONTRATADA à CONTRATANTE, de licença de uso da Plataforma, não exclusiva, intransferível, revogável nos termos deste contrato e limitada ao período de vigência, para a gestão da Loja "${t.storeName}", acessível em ${t.systemAddress}.`,
        'A licença inclui, conforme o Plano contratado: ponto de venda (PDV), gestão de pedidos e comandas, cardápio e loja online, mesas e salão, cozinha, entregas e acompanhamento de entregadores, reservas, estoque e ficha técnica, financeiro, relatórios, equipe e permissões, impressão de pedidos e integrações disponibilizadas pela CONTRATADA.',
        'A Plataforma é fornecida como serviço: a CONTRATANTE não recebe cópia do código-fonte nem instala o sistema em servidor próprio. Hospedagem, manutenção, segurança, cópias de segurança (backups) e atualizações são de responsabilidade da CONTRATADA.',
        'A CONTRATADA pode melhorar, alterar ou substituir funcionalidades da Plataforma ao longo do tempo, desde que não haja redução substancial dos recursos essenciais do Plano contratado sem aviso prévio de 30 (trinta) dias.',
        'Não fazem parte deste contrato, salvo acordo por escrito: equipamentos (computadores, tablets, impressoras, leitores), conexão com a internet, certificado digital, consultoria contábil, fiscal ou jurídica, serviços de terceiros contratados diretamente pela CONTRATANTE e desenvolvimento de funcionalidades exclusivas.',
      ],
    },
    {
      title: 'Plano contratado e limites',
      items: [
        `A CONTRATANTE contrata o Plano ${t.planName}, com as seguintes características:`,
        [...t.limits, ...t.features].map((x, i, a) => `${x}${i === a.length - 1 ? '.' : ';'}`),
        'Ao atingir um limite do Plano, a Plataforma impede apenas a criação de novos registros daquele tipo (por exemplo, novos produtos ou novos Usuários). Nenhum dado é apagado por causa de limite. A CONTRATANTE pode mudar de Plano a qualquer momento, e o novo preço vale a partir da mensalidade seguinte.',
        'Recursos novos lançados pela CONTRATADA podem ser incluídos no Plano sem custo ou oferecidos como adicional pago, à escolha da CONTRATADA, sempre com informação prévia à CONTRATANTE.',
      ],
    },
    {
      title: 'Preço, pagamento e faturamento',
      items: [
        `Pela licença de uso, a CONTRATANTE pagará à CONTRATADA a mensalidade de ${money(t.priceMonthly)}, com vencimento todo dia ${num(t.dueDay)} de cada mês, pelo meio de pagamento indicado pela CONTRATADA (boleto, PIX, cartão ou outro).`,
        Number(t.setupFee) > 0
          ? `Pela implantação (configuração inicial, cadastro do cardápio e treinamento remoto), a CONTRATANTE pagará o valor único de ${money(t.setupFee)}, junto com a primeira mensalidade.`
          : 'Não há cobrança de taxa de implantação.',
        t.trialDays > 0
          ? `A CONTRATANTE tem ${num(t.trialDays)} dias de teste gratuito contados do início da vigência. A primeira mensalidade vence no primeiro dia de vencimento após o fim do teste.`
          : 'A primeira mensalidade vence no primeiro dia de vencimento após o início da vigência, proporcional aos dias de uso quando a CONTRATADA assim indicar.',
        'O preço inclui os tributos incidentes sobre o serviço. A CONTRATADA emitirá o documento fiscal correspondente a cada pagamento.',
        'Custos de serviços de terceiros contratados diretamente pela CONTRATANTE (como certificado digital, mensagens oficiais do WhatsApp cobradas pela Meta, meios de pagamento, mapas ou telefonia) não estão incluídos e são pagos por ela diretamente ao fornecedor, salvo quando expressamente incluídos no Plano.',
        'A cobrança é antecipada por mês de uso. Mensalidades pagas não são devolvidas por cancelamento no meio do mês, exceto nos casos previstos em lei ou neste contrato.',
      ],
    },
    {
      title: 'Atraso e inadimplência',
      items: [
        `O atraso no pagamento sujeita a CONTRATANTE a multa de ${pct(t.lateFeePercent)} sobre o valor em atraso, juros de mora de ${pct(t.lateInterestPercent)} ao mês, calculados dia a dia, e atualização monetária pelo ${t.readjustIndex}.`,
        `Após ${num(t.suspendAfterDays)} dias de atraso e aviso prévio por e-mail ou pela própria Plataforma com pelo menos 5 (cinco) dias de antecedência, a CONTRATADA poderá suspender o acesso à Plataforma até a regularização.`,
        'A suspensão não apaga nenhum dado. Assim que o pagamento é confirmado, o acesso volta em até 1 (um) dia útil.',
        'Durante a suspensão, a CONTRATANTE continua podendo solicitar a exportação dos seus dados, nos termos da cláusula 8.',
      ],
    },
    {
      title: 'Reajuste',
      items: [
        `Os valores deste contrato serão reajustados a cada 12 (doze) meses, contados do início da vigência, pela variação acumulada do ${t.readjustIndex} no período ou, na sua falta, pelo índice oficial que o substituir.`,
        'Fora do reajuste anual, alterações de preço da tabela da CONTRATADA só valem para a CONTRATANTE com aviso prévio de 30 (trinta) dias, e ela pode rescindir o contrato sem qualquer multa caso não concorde.',
      ],
    },
    {
      title: 'Vigência e renovação',
      items: [
        `Este contrato entra em vigor em ${dateBR(t.startDate)} e vale por ${num(t.termMonths)} ${t.termMonths === 1 ? 'mês' : 'meses'}, renovando-se automaticamente por períodos iguais e sucessivos, salvo manifestação contrária de qualquer das partes com 30 (trinta) dias de antecedência.`,
        'O uso da Plataforma pela CONTRATANTE antes da assinatura deste instrumento fica regido por estas mesmas condições.',
      ],
    },
    {
      title: 'Rescisão e devolução dos dados',
      items: [
        'Qualquer das partes pode rescindir este contrato, sem multa, mediante aviso por escrito (e-mail vale) com 30 (trinta) dias de antecedência. As mensalidades do período de aviso continuam devidas.',
        'O contrato pode ser rescindido imediatamente, por aviso escrito, nos seguintes casos:',
        [
          'descumprimento de obrigação contratual não corrigido em 10 (dez) dias após notificação;',
          `inadimplência superior a 60 (sessenta) dias;`,
          'uso da Plataforma para atividades ilícitas, fraude, envio de mensagens não solicitadas (spam) ou violação de direitos de terceiros;',
          'falência, recuperação judicial ou encerramento das atividades de qualquer das partes, nos limites da lei.',
        ],
        'Encerrado o contrato, a CONTRATANTE pode, em até 30 (trinta) dias, solicitar a exportação dos seus dados em formato aberto e legível por máquina (como CSV ou JSON). Os documentos fiscais eletrônicos (XML) permanecem disponíveis para download nesse mesmo prazo.',
        'Após 90 (noventa) dias do encerramento, a CONTRATADA eliminará os Dados da CONTRATANTE de seus sistemas ativos. As cópias de segurança são eliminadas no ciclo normal de retenção. Ficam ressalvados os dados que a lei obrigue a CONTRATADA a guardar, que serão mantidos apenas pelo prazo e para a finalidade legal.',
        'A rescisão não extingue as obrigações já vencidas nem as de confidencialidade e proteção de dados, que continuam valendo pelo prazo previsto neste contrato.',
      ],
    },
    {
      title: 'Obrigações da CONTRATADA',
      items: [
        'Além das demais obrigações previstas neste contrato, a CONTRATADA se obriga a:',
        [
          'manter a Plataforma em funcionamento, com o nível de serviço da cláusula 11;',
          'hospedar a Plataforma em infraestrutura profissional, com banco de dados isolado por cliente, conexão cifrada (HTTPS) e controle de acesso;',
          'fazer cópias de segurança diárias e cifradas dos dados, com teste periódico de restauração;',
          'aplicar correções e atualizações de segurança e de legislação (como mudanças da nota fiscal) sem custo adicional;',
          'avisar a CONTRATANTE com pelo menos 48 (quarenta e oito) horas de antecedência sobre manutenções programadas que possam interromper o serviço, preferindo horários de menor movimento;',
          'prestar o suporte técnico da cláusula 12;',
          'manter sigilo sobre os Dados da CONTRATANTE e só acessá-los quando necessário para suporte, segurança, cumprimento de lei ou mediante solicitação da CONTRATANTE, sempre com registro do acesso.',
        ],
      ],
    },
    {
      title: 'Obrigações da CONTRATANTE',
      items: [
        'Além das demais obrigações previstas neste contrato, a CONTRATANTE se obriga a:',
        [
          'pagar os valores devidos nas datas de vencimento;',
          'fornecer e manter atualizados dados cadastrais verdadeiros, inclusive os fiscais e tributários;',
          'guardar em sigilo as senhas de acesso, criar um Usuário para cada pessoa e remover o acesso de quem deixar a equipe, respondendo pelos atos praticados com os acessos da Loja;',
          'usar a Plataforma de acordo com a lei, inclusive o Código de Defesa do Consumidor nas relações com os Clientes Finais, e não tentar copiar, descompilar, revender ou sobrecarregar a Plataforma;',
          'responder pelo conteúdo que publicar na Loja (cardápio, preços, fotos, promoções, informações sobre alérgenos e taxas de entrega), garantindo que tem os direitos sobre ele;',
          'manter equipamentos e conexão com a internet adequados ao uso da Plataforma;',
          'conferir pedidos, pagamentos e fechamentos de caixa, comunicando à CONTRATADA qualquer falha percebida assim que possível;',
          'obter dos Clientes Finais e Usuários as autorizações exigidas por lei para o tratamento de seus Dados Pessoais e para o envio de mensagens.',
        ],
      ],
    },
    {
      title: 'Nível de serviço (disponibilidade)',
      items: [
        `A CONTRATADA se compromete a manter a Plataforma disponível em pelo menos ${sla} do tempo de cada mês civil, medido pelo seu sistema de monitoramento.`,
        'Não contam como indisponibilidade:',
        [
          'manutenções programadas avisadas com a antecedência da cláusula 9;',
          'falhas de internet, energia ou equipamentos da CONTRATANTE;',
          'instabilidade ou indisponibilidade de serviços de terceiros que a Plataforma apenas consulta ou integra, como a SEFAZ e os serviços de nota fiscal, WhatsApp/Meta, provedores de mapas, CEP, meios de pagamento e aplicativos de entrega;',
          'suspensão por inadimplência ou por uso indevido, nos termos deste contrato;',
          'caso fortuito ou força maior, inclusive ataques em larga escala à infraestrutura da internet.',
        ],
        'Se a Disponibilidade de um mês ficar abaixo do compromisso, a CONTRATANTE terá direito a desconto na mensalidade seguinte, mediante solicitação em até 30 (trinta) dias:',
        [
          `10% (dez por cento) da mensalidade, se a Disponibilidade ficar abaixo de ${sla} e igual ou acima de 99%;`,
          '25% (vinte e cinco por cento), se ficar abaixo de 99% e igual ou acima de 95%;',
          '50% (cinquenta por cento), se ficar abaixo de 95%.',
        ],
        'O desconto acima é a compensação pela indisponibilidade, sem prejuízo do direito de rescisão por descumprimento reiterado (três meses seguidos ou quatro meses em doze abaixo do compromisso), sem multa para a CONTRATANTE.',
      ],
    },
    {
      title: 'Suporte técnico',
      items: [
        `O suporte é prestado de forma remota, pelos canais informados pela CONTRATADA (WhatsApp, e-mail ou pela Plataforma), em ${t.supportHours}.`,
        'A CONTRATADA buscará dar a primeira resposta nos seguintes prazos, contados dentro do horário de suporte:',
        [
          'crítico (Loja totalmente parada, sem conseguir vender): até 2 (duas) horas;',
          'alto (função importante com falha, mas com alternativa): até 8 (oito) horas;',
          'normal (dúvidas, ajustes e pedidos de melhoria): até 2 (dois) dias úteis.',
        ],
        'O suporte cobre o uso e o funcionamento da Plataforma. Não inclui consultoria contábil, fiscal ou tributária, configuração de equipamentos de terceiros fora do previsto, nem cadastro em massa de dados, que podem ser orçados à parte.',
        'Para prestar suporte, a CONTRATADA pode acessar a Loja com acesso de suporte identificado e registrado, mediante solicitação ou autorização da CONTRATANTE, ou quando necessário para corrigir falha ou incidente.',
      ],
    },
    {
      title: 'Nota fiscal do consumidor (NFC-e) e obrigações fiscais',
      items: [
        'Quando o Plano incluir a emissão de NFC-e, a Plataforma transmite os documentos fiscais da CONTRATANTE à SEFAZ por meio de provedor especializado contratado pela CONTRATADA (atualmente a Focus NFe), sem que a CONTRATANTE precise contratar esse provedor diretamente.',
        'A CONTRATANTE é a emitente dos documentos fiscais e a única responsável pelas informações tributárias cadastradas (regime tributário, inscrição estadual, NCM, CFOP, CST/CSOSN, alíquotas, CSC e certificado digital A1), pela sua conferência com o contador e pelo recolhimento dos tributos.',
        'O certificado digital e o CSC informados pela CONTRATANTE são guardados de forma cifrada e usados exclusivamente para a emissão dos seus documentos fiscais.',
        'A CONTRATADA não responde por rejeições, multas ou autuações decorrentes de dados fiscais incorretos, certificado vencido, indisponibilidade da SEFAZ ou do provedor, nem por emissões em contingência que a CONTRATANTE deixar de regularizar no prazo legal.',
        'Os arquivos XML dos documentos emitidos ficam disponíveis na Plataforma durante a vigência e no prazo de exportação da cláusula 8. Cabe à CONTRATANTE guardá-los pelo prazo exigido pela legislação fiscal.',
      ],
    },
    {
      title: 'Integrações e serviços de terceiros',
      items: [
        'A Plataforma pode se integrar a serviços de terceiros, como WhatsApp, mapas, consulta de CEP, impressoras, meios de pagamento e aplicativos de entrega. Esses serviços seguem os termos e as políticas de seus próprios fornecedores.',
        'A conexão do WhatsApp por QR Code utiliza o aplicativo do próprio número da CONTRATANTE e não é a API oficial da Meta. A Meta pode limitar ou bloquear números que enviem mensagens em desacordo com as suas regras. A CONTRATANTE assume esse risco e deve preferir a API oficial quando o volume de mensagens exigir.',
        'A CONTRATADA não responde por mudanças, falhas, cobranças ou descontinuidade de serviços de terceiros, mas se compromete a adaptar a Plataforma, dentro do razoável, quando um fornecedor mudar suas regras.',
      ],
    },
    {
      title: 'Proteção de dados pessoais (LGPD)',
      items: [
        'Em relação aos Dados Pessoais dos Clientes Finais e dos Usuários tratados na Plataforma, a CONTRATANTE é a Controladora e a CONTRATADA é a Operadora, nos termos dos artigos 5º, incisos VI e VII, e 39 da LGPD.',
        'Como Operadora, a CONTRATADA se obriga a:',
        [
          'tratar os Dados Pessoais somente para executar este contrato e conforme as instruções lícitas da CONTRATANTE, nunca para finalidade própria, venda ou publicidade;',
          'adotar medidas de segurança técnicas e administrativas aptas a proteger os Dados Pessoais (artigo 46 da LGPD), como criptografia em trânsito, isolamento dos dados por cliente, controle de acesso com registro (auditoria), cópias de segurança cifradas e segredos de integrações guardados de forma cifrada;',
          'garantir que as pessoas autorizadas a tratar os dados estejam comprometidas com o sigilo;',
          'comunicar à CONTRATANTE, em até 48 (quarenta e oito) horas da ciência, qualquer Incidente de Segurança que possa acarretar risco ou dano relevante aos Titulares, com as informações disponíveis para que a CONTRATANTE avalie a comunicação à ANPD e aos Titulares;',
          'auxiliar a CONTRATANTE, na medida do possível, no atendimento aos pedidos dos Titulares (acesso, correção, portabilidade, eliminação e demais direitos do artigo 18 da LGPD) e nas solicitações da ANPD;',
          'eliminar ou devolver os Dados Pessoais ao fim do contrato, conforme a cláusula 8, ressalvada a guarda exigida por lei.',
        ],
        'A CONTRATANTE autoriza a CONTRATADA a utilizar suboperadores necessários à prestação do serviço, como provedores de hospedagem e armazenamento em nuvem, serviço de cópias de segurança, provedor de nota fiscal, serviços de mensagens e de envio de e-mail, exigindo deles obrigações de proteção de dados equivalentes às deste contrato. A lista atualizada é informada a pedido da CONTRATANTE.',
        'Se algum suboperador tratar dados fora do Brasil, a CONTRATADA assegurará que a transferência internacional atenda a uma das hipóteses do artigo 33 da LGPD.',
        'Cabe à CONTRATANTE, como Controladora, definir a base legal dos tratamentos que realiza, informar os Titulares (inclusive por política de privacidade da Loja) e responder a eles, com o auxílio da CONTRATADA descrito acima.',
        'Em relação aos dados cadastrais e de cobrança da própria CONTRATANTE e de seus representantes, a CONTRATADA atua como Controladora e os trata para executar este contrato, cumprir obrigações legais e exercer direitos, nos termos do artigo 7º, incisos II, V e VI, da LGPD.',
        'A CONTRATADA pode usar dados de uso da Plataforma de forma agregada e anonimizada, sem identificar a CONTRATANTE nem os Titulares, para manter, medir e melhorar o serviço.',
      ],
    },
    {
      title: 'Propriedade intelectual',
      items: [
        'A Plataforma, seu código-fonte, banco de dados estrutural, marca Comandou, layout, documentação e melhorias são de propriedade exclusiva da CONTRATADA e protegidos pelas Leis nº 9.609/1998 (software) e nº 9.610/1998 (direitos autorais). Este contrato não transfere nenhum desses direitos à CONTRATANTE.',
        'Os Dados da CONTRATANTE pertencem à CONTRATANTE. A CONTRATANTE autoriza a CONTRATADA a usar o nome, a marca e as imagens da Loja apenas para exibi-los na própria Loja e no funcionamento da Plataforma.',
        'Sugestões de melhoria enviadas pela CONTRATANTE podem ser livremente usadas pela CONTRATADA, sem que isso gere qualquer obrigação de pagamento.',
      ],
    },
    {
      title: 'Confidencialidade',
      items: [
        'As partes manterão em sigilo as informações confidenciais a que tiverem acesso em razão deste contrato, como dados comerciais, financeiros, técnicos e de clientes, usando-as apenas para os fins deste contrato.',
        'Não são confidenciais as informações que já eram públicas, que se tornarem públicas sem culpa da parte, ou cuja divulgação seja exigida por lei ou ordem de autoridade competente, caso em que a outra parte será avisada, quando permitido.',
        'A obrigação de confidencialidade vale durante a vigência e por 5 (cinco) anos após o seu término.',
      ],
    },
    {
      title: 'Limitação de responsabilidade',
      items: [
        'A CONTRATADA responde pelos danos diretos que causar à CONTRATANTE por culpa comprovada na prestação do serviço, limitados ao valor total pago pela CONTRATANTE nos 12 (doze) meses anteriores ao fato.',
        'A CONTRATADA não responde por lucros cessantes, perda de vendas ou de oportunidades, danos indiretos, nem por prejuízos decorrentes de dados ou configurações inseridos pela CONTRATANTE, uso indevido de senhas, falhas de equipamentos ou internet da CONTRATANTE, ou serviços de terceiros.',
        'As limitações desta cláusula não se aplicam em caso de dolo ou culpa grave, nem afastam a responsabilidade prevista em lei por tratamento irregular de Dados Pessoais.',
      ],
    },
    {
      title: 'Caso fortuito e força maior',
      items: [
        'Nenhuma das partes responde pelo descumprimento causado por caso fortuito ou força maior, nos termos do artigo 393 do Código Civil, enquanto durar o evento. A parte afetada deve avisar a outra assim que possível e adotar as medidas razoáveis para reduzir os efeitos.',
      ],
    },
    {
      title: 'Conduta ética e anticorrupção',
      items: [
        'As partes declaram conhecer e se obrigam a cumprir a Lei nº 12.846/2013 (Lei Anticorrupção) e as demais normas de integridade, não oferecendo nem aceitando vantagem indevida de qualquer natureza relacionada a este contrato.',
      ],
    },
    {
      title: 'Comunicações',
      items: [
        `As comunicações entre as partes serão feitas por escrito, preferencialmente por e-mail, para os endereços indicados neste contrato (CONTRATADA: ${P.email ?? 'e-mail informado pela CONTRATADA'}; CONTRATANTE: ${C.email ?? 'e-mail cadastrado na Plataforma'}), ou por avisos dentro da própria Plataforma.`,
        'Cada parte deve informar à outra qualquer mudança de endereço ou e-mail. Até essa comunicação, valem os endereços anteriores.',
      ],
    },
    {
      title: 'Alterações deste contrato',
      items: [
        'Qualquer alteração deste contrato deve ser feita por escrito, inclusive por termo aditivo assinado eletronicamente.',
        'A CONTRATADA pode atualizar as condições gerais de uso da Plataforma para refletir mudanças legais ou do serviço, avisando a CONTRATANTE com 30 (trinta) dias de antecedência. Se não concordar, a CONTRATANTE pode rescindir o contrato sem multa nesse prazo.',
      ],
    },
    {
      title: 'Assinatura eletrônica',
      items: [
        'As partes reconhecem a validade deste contrato assinado por meio eletrônico, nos termos do artigo 10, § 2º, da Medida Provisória nº 2.200-2/2001, da Lei nº 14.063/2020 e do artigo 107 do Código Civil, admitindo como meio de comprovação de autoria e integridade as assinaturas eletrônicas descritas nesta cláusula.',
        'A CONTRATANTE assina primeiro, pelo link pessoal enviado ao seu e-mail, desenhando a assinatura na tela ou digitando o nome completo, somente depois de percorrer todo o texto. Em seguida, a CONTRATADA confere a assinatura da CONTRATANTE e assina pelo seu painel, confirmando com o código de um aplicativo autenticador. O contrato só se completa com as duas assinaturas, e cada parte recebe por e-mail a via final em PDF.',
        'Cada assinatura fica registrada com nome, CPF e e-mail do signatário, imagem da assinatura (que também aparece como rubrica em cada página), data e hora, endereço IP, navegador utilizado, localização informada pelo aparelho quando o signatário permitir e o código de integridade (hash SHA-256) do documento. Os eventos do documento (envio, abertura, leitura e assinaturas) formam uma trilha encadeada por códigos de integridade. Essas informações integram o manifesto de assinatura anexo a este contrato.',
        'O signatário de cada parte declara ter poderes para representá-la e assinar este contrato em seu nome.',
        'Se a CONTRATADA não assinar em até 10 (dez) dias depois da assinatura da CONTRATANTE, ou cancelar o envio informando o motivo, a CONTRATANTE será avisada e a assinatura dela perde o efeito, sem custo para nenhuma das partes.',
      ],
    },
    {
      title: 'Disposições gerais',
      items: [
        'Este contrato não cria vínculo trabalhista, societário ou de representação entre as partes, nem entre uma parte e os empregados ou contratados da outra.',
        'Nenhuma das partes pode ceder este contrato sem concordância da outra, exceto a CONTRATADA em caso de reorganização societária, venda ou incorporação, mantidas as condições contratadas.',
        'A tolerância de uma parte com o descumprimento de qualquer obrigação pela outra não significa renúncia ou novação.',
        'Se alguma cláusula for considerada inválida, as demais continuam valendo normalmente.',
        'Este contrato, com seus anexos e aditivos, representa o acordo integral entre as partes sobre o seu objeto e substitui entendimentos anteriores.',
      ],
    },
  ];
  if (t.specialConditions)
    clauses.push({
      title: 'Condições especiais',
      items: t.specialConditions
        .split(/\n{2,}|\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  clauses.push({
    title: 'Foro',
    items: [
      `As partes elegem o foro da comarca de ${t.forumCity || 'domicílio da CONTRATADA'} para resolver qualquer questão sobre este contrato, com renúncia a qualquer outro, por mais privilegiado que seja. Antes de recorrer ao Judiciário, as partes tentarão resolver a questão de forma amigável.`,
    ],
  });

  return {
    version: 2,
    number: input.number,
    title: 'Contrato de licença de uso de software (SaaS) e prestação de serviços',
    issuedAt: input.issuedAt,
    parties: { provider: P, customer: C },
    terms: t,
    preamble: `Pelo presente instrumento particular, de um lado, ${partyLine({ ...P, name: providerName }, 'CONTRATADA')} E, de outro lado, ${partyLine(C, 'CONTRATANTE')} As partes têm entre si, justo e contratado, o presente contrato, que se regerá pelas cláusulas e condições a seguir.`,
    clauses,
    closing: `E, por estarem de acordo, as partes assinam este contrato eletronicamente. Emitido em ${dateLong(input.issuedAt)}.`,
  };
}
