import type { HelpDict } from '../../design-system';

/**
 * Ajuda dos campos da Nota fiscal ("?" ao lado de cada rótulo). Chave = rótulo do campo.
 * Na dúvida sobre códigos (CFOP, CST, NCM), a explicação manda confirmar com a contabilidade.
 */

const PADROES = { to: '/fiscal/padroes', label: 'Abrir padrões fiscais' };
const CONFIG = { to: '/fiscal/configuracao', label: 'Abrir configuração da nota' };
const ITENS = { to: '/cardapio', label: 'Abrir itens do cardápio' };

/** Campos fiscais do cadastro do item (também usados no Cardápio). */
export const FISCAL_ITEM_HELP: HelpDict = {
  'Padrão fiscal': {
    text: 'Conjunto de impostos (CFOP, CST, alíquotas) que este item usa na nota. "Automático" procura pelo NCM do item e, se não achar, usa o padrão da empresa.',
    link: PADROES,
  },
  CEST: {
    text: 'Código de 7 dígitos exigido só em itens com substituição tributária do ICMS (bebidas, sorvetes…). Comida feita na casa normalmente não tem.',
    example: '0300700 (refrigerante)',
  },
  NCM: {
    text: 'Classificação fiscal do produto, com 8 dígitos. É obrigatório na NFC-e. Vazio usa o NCM padrão da configuração. Peça à contabilidade se tiver dúvida.',
    example: '21069090 (preparações alimentícias)',
    link: { to: '/fiscal/configuracao?foco=secao-saida', label: 'Ver o NCM padrão' },
  },
  CFOP: {
    text: 'Código que diz o tipo de operação. Em restaurante quase sempre é 5102 (venda de mercadoria) ou 5405 (com substituição tributária). Vazio usa o do padrão fiscal.',
    example: '5102',
    link: PADROES,
  },
  'CSOSN / CST do ICMS': {
    text: 'Situação do ICMS do item. No Simples Nacional é o CSOSN (ex.: 102, 500); fora do Simples é o CST (ex.: 00, 60). Vazio usa o do padrão fiscal.',
    link: PADROES,
  },
  Origem: {
    text: 'De onde vem a mercadoria. 0 = nacional (o caso de quase tudo no restaurante). 1, 2 e 6 são importados.',
  },
};

/** Configuração da nota: empresa, NFC-e, NF-e e Geral. */
export const FISCAL_HELP: HelpDict = {
  ...FISCAL_ITEM_HELP,
  'Como conectar à Focus NFe': {
    text: 'A Focus NFe é o serviço que envia as notas para a SEFAZ. "Cadastro pelo Comandou": você só preenche a empresa e o certificado aqui. "Tenho conta na Focus": você cola os tokens da sua própria conta.',
  },
  'CNPJ do emitente': {
    text: 'CNPJ do restaurante, igual ao cadastrado na Focus NFe. É quem aparece como emitente na nota.',
  },
  'Token de homologação': {
    text: 'Chave da sua conta na Focus para notas de teste (sem valor fiscal). Fica no painel da Focus, na sua empresa, em "Tokens".',
  },
  'Token de produção': {
    text: 'Chave da sua conta na Focus para notas que valem de verdade. Só é usada depois que você muda para produção.',
  },
  CNPJ: {
    text: 'CNPJ do restaurante que emite as notas. Ao digitar, o sistema busca a razão social e o endereço sozinho.',
  },
  'Razão social': {
    text: 'Nome oficial da empresa, exatamente como no cartão CNPJ da Receita.',
  },
  'Nome fantasia': {
    text: 'Nome de fachada do restaurante. Sai no cabeçalho da nota.',
  },
  'Inscrição estadual': {
    text: 'Número de cadastro do restaurante na Secretaria da Fazenda do estado. Obrigatório para emitir NFC-e. Só números.',
  },
  'Regime tributário': {
    text: 'Como a empresa paga impostos: Simples Nacional, Simples com excesso de sublimite ou Regime normal (Lucro Presumido/Real). Muda os códigos de imposto usados. Confirme com a contabilidade.',
  },
  CEP: { text: 'CEP do endereço do restaurante, igual ao do cartão CNPJ.' },
  Rua: { text: 'Endereço do restaurante, igual ao do cartão CNPJ.' },
  Número: { text: 'Número do endereço. Use S/N se não tiver.' },
  Complemento: { text: 'Sala, loja, bloco. Opcional.' },
  Bairro: { text: 'Bairro do endereço do restaurante.' },
  Cidade: { text: 'Município do restaurante. Precisa bater com o cadastro na SEFAZ.' },
  UF: { text: 'Sigla do estado, com 2 letras.', example: 'SP' },
  'E-mail fiscal': {
    text: 'E-mail que recebe avisos da Focus NFe (certificado vencendo, rejeições). Opcional.',
  },
  Telefone: { text: 'Telefone da empresa no cadastro fiscal. Opcional.' },
  'CPF/CNPJ da contabilidade': {
    text: 'Documento do contador. Alguns estados (como a BA) exigem que saia na nota para o contador poder baixar o XML. Opcional.',
  },
  'Arquivo do certificado': {
    text: 'Certificado digital A1 da empresa (arquivo .pfx ou .p12), comprado numa certificadora. É ele que assina as notas. Vale 1 ano.',
  },
  'Senha do certificado': {
    text: 'Senha definida quando o certificado foi gerado. Vai direto para a Focus e não fica salva no Comandou.',
  },
  'Emitir sozinho quando o pedido for pago': {
    text: 'Ligado: ao fechar a conta no caixa, a NFC-e sai sem ninguém clicar. Desligado: a nota é emitida pelo botão no pedido ou em Fiscal › NFC-e.',
    link: { to: '/caixa', label: 'Abrir o caixa' },
  },
  'Natureza da operação': {
    text: 'Texto que descreve a venda e sai impresso na nota. Para restaurante o comum é "VENDA AO CONSUMIDOR" (NFC-e) ou "VENDA DE MERCADORIA" (NF-e).',
  },
  CSC: {
    text: 'Código de Segurança do Contribuinte: gerado no site da SEFAZ do seu estado e usado para montar o QR Code da NFC-e. Cada ambiente (teste e produção) tem um.',
  },
  'ID do CSC de homologação': {
    text: 'Número de identificação do CSC de teste, que a SEFAZ mostra junto do código.',
    example: '1 ou 000001',
  },
  'CSC de homologação': {
    text: 'Código de teste gerado no site da SEFAZ do estado (16 caracteres ou mais).',
  },
  'ID do CSC de produção': {
    text: 'Número de identificação do CSC de produção. Pode deixar para quando for mudar para produção.',
  },
  'CSC de produção': {
    text: 'Código de produção gerado no site da SEFAZ do estado. Sem ele, a NFC-e em produção é recusada.',
  },
  Numeração: {
    text: 'A Focus numera as notas sozinha. Só mude série e número se o restaurante já emitia por outro sistema, para continuar de onde parou.',
  },
  'Série em produção': {
    text: 'Série das notas. Quase sempre 1. Mude só para seguir a série que você já usava.',
  },
  'Próximo número': {
    text: 'Número da próxima nota em produção. Preencha só se veio de outro sistema (último número + 1).',
  },
  'Emitir NF-e (modelo 55)': {
    text: 'Liga a NF-e, a nota completa com dados do comprador (empresas, eventos, quem pede com endereço). A empresa precisa estar habilitada para NF-e na SEFAZ.',
    link: { to: '/fiscal/nfe', label: 'Abrir NF-e' },
  },
  'Mandar a nota por e-mail ao cliente': {
    text: 'Quando a nota é autorizada e o cliente tem e-mail no cadastro, ele recebe o PDF e o XML.',
    link: { to: '/clientes', label: 'Abrir clientes' },
  },
  'Observação em todas as notas': {
    text: 'Texto livre que sai no rodapé de toda nota (informações complementares). Ex.: aviso de optante pelo Simples.',
  },
  'Sem padrão fiscal': {
    text: 'Códigos de reserva, usados só enquanto não existe nenhum padrão fiscal ativo. O melhor é criar os padrões fiscais.',
    link: PADROES,
  },
  'CSOSN / CST': {
    text: 'Situação do ICMS usada quando o item não tem padrão fiscal. No Simples Nacional, 102 é o mais comum.',
    link: PADROES,
  },
  'NCM padrão': {
    text: 'NCM usado nos itens que não têm NCM no cadastro. Evita nota recusada, mas o certo é cada item ter o seu.',
    link: ITENS,
  },
};

/** Editor do padrão fiscal. */
export const RULE_HELP: HelpDict = {
  ...FISCAL_HELP,
  Nome: {
    text: 'Nome do padrão para você achar na lista e no cadastro do item.',
    example: 'Comida feita na casa, Bebida com ST',
  },
  Código: {
    text: 'Código curto do padrão. Vazio, o sistema cria um.',
  },
  'Vale para': {
    text: 'Em quais notas este padrão é usado: NFC-e (cupom do consumidor), NF-e (nota completa) ou as duas.',
  },
  Ativo: {
    text: 'Desmarcado, o padrão deixa de ser usado e os itens dele procuram o próximo (NCM ou padrão da empresa).',
  },
  'CFOP fora do estado': {
    text: 'CFOP usado na NF-e quando o comprador é de outro estado. Vazio: troca o 5 do início por 6 (5102 vira 6102).',
  },
  CSOSN: {
    text: 'Situação do ICMS no Simples Nacional. 102 = sem crédito; 500 = ICMS já pago por substituição (bebidas). Confirme com a contabilidade.',
  },
  'CST do ICMS': {
    text: 'Situação do ICMS fora do Simples. 00 = tributada integralmente; 60 = já paga por substituição. Confirme com a contabilidade.',
  },
  'Alíquota do ICMS (%)': {
    text: 'Percentual do ICMS sobre o valor do item. Só no regime normal com ICMS destacado.',
    example: '18',
  },
  'Redução da base (%)': {
    text: 'Quanto da base de cálculo do ICMS é reduzida, quando o estado dá esse benefício. Normalmente vazio.',
  },
  cBenef: {
    text: 'Código de benefício fiscal. Só alguns estados exigem (PR, RJ, RS…), e só quando há isenção ou redução.',
  },
  'CST do PIS': {
    text: 'Situação do PIS. No Simples Nacional costuma ser 49 (outras operações) ou 99. Confirme com a contabilidade.',
  },
  'Alíquota do PIS (%)': { text: 'Percentual do PIS. Só no regime normal.', example: '0,65' },
  'CST da COFINS': {
    text: 'Situação da COFINS. Normalmente igual à do PIS.',
  },
  'Alíquota da COFINS (%)': {
    text: 'Percentual da COFINS. Só no regime normal.',
    example: '3',
  },
  'CST do IPI': {
    text: 'Situação do IPI, só na NF-e e só para indústria. Restaurante normalmente deixa vazio.',
  },
  'Alíquota do IPI (%)': { text: 'Percentual do IPI. Normalmente vazio em restaurante.' },
  'Tributos aproximados (%)': {
    text: 'Percentual aproximado de impostos que aparece no cupom, como pede a Lei da Transparência (IBPT).',
    example: '13,45',
  },
  Anotação: {
    text: 'Lembrete só para a equipe (ex.: "conferido com o contador em 10/2026"). Não sai na nota.',
  },
  'CST do IBS/CBS': {
    text: 'Reforma tributária: situação dos novos impostos IBS e CBS. Em 2026 é fase de teste; siga a orientação da contabilidade.',
  },
  'Classificação tributária': {
    text: 'Código da reforma tributária (cClassTrib) que detalha a situação do IBS/CBS.',
  },
  'CBS (%)': { text: 'Alíquota da CBS (imposto federal novo). Em 2026, alíquota de teste.' },
  'IBS estadual (%)': { text: 'Alíquota do IBS do estado. Em 2026, alíquota de teste.' },
  'IBS municipal (%)': { text: 'Alíquota do IBS do município. Em 2026, alíquota de teste.' },
  'Itens ligados': {
    text: 'Itens que usam este padrão sempre, seja qual for o NCM. É a regra mais forte.',
    link: ITENS,
  },
  'NCMs ligados': {
    text: 'Todo item com um destes NCMs usa este padrão, se não tiver um padrão próprio. Prático para bebidas com ST.',
  },
  'Usar nos itens que não acharem outro padrão': {
    text: 'Faz deste o padrão da empresa: vale para todo item sem padrão próprio e sem NCM ligado. Só um padrão pode ser o da empresa.',
  },
};

/** Inutilização de numeração. */
export const VOID_HELP: HelpDict = {
  Tipo: { text: 'Se a numeração pulada é de NFC-e ou de NF-e.' },
  Série: { text: 'Série das notas puladas, normalmente 1.' },
  'Do número': { text: 'Primeiro número da faixa que nunca foi usada.' },
  'Até o número': {
    text: 'Último número da faixa. Para um número só, repita o mesmo número.',
  },
  Justificativa: {
    text: 'Motivo da inutilização, com pelo menos 15 caracteres. Vai para a SEFAZ.',
    example: 'Falha no sistema pulou a numeração',
  },
};

/** Notas recebidas (manifestação). */
export const RECEIVED_HELP: HelpDict = {
  Justificativa: {
    text: 'Motivo para não reconhecer a operação, com pelo menos 15 caracteres. Vai para a SEFAZ junto com a manifestação.',
  },
};

/** Dados de uma nota (NF-e em rascunho ou com erro). */
export const DOC_HELP: HelpDict = {
  'Natureza da operação': {
    text: 'Texto que descreve a operação e sai na nota. Vem da configuração; troque só se esta venda for diferente.',
    link: CONFIG,
  },
  Finalidade: {
    text: 'Normal para venda comum. Complementar, ajuste e devolução são para corrigir ou desfazer outra nota (pede a chave dela).',
  },
  'Presença do comprador': {
    text: 'Como foi a venda: presencial, pela internet, por telefone ou entrega em domicílio.',
  },
  'Consumidor final': {
    text: 'Sim quando o comprador vai consumir (pessoa ou empresa que não revende). Não quando ele vai revender.',
  },
  Frete: {
    text: 'Quem paga o transporte. Em restaurante quase sempre "Sem frete".',
  },
  Destino: {
    text: 'Calculado pelo endereço do comprador: dentro do estado usa CFOP 5xxx, outro estado usa 6xxx.',
  },
  'Chave da nota referenciada': {
    text: 'Os 44 números da nota que esta corrige ou devolve. Fica no DANFE da nota original.',
  },
  'Informações complementares': {
    text: 'Texto livre que sai no rodapé desta nota.',
  },
  'Trocar cliente': {
    text: 'Busca um cliente já cadastrado e preenche o destinatário com o CPF/CNPJ, a IE e o endereço dele.',
    link: { to: '/clientes', label: 'Abrir clientes' },
  },
  Nome: { text: 'Nome ou razão social de quem recebe a nota.' },
  CPF: { text: 'CPF do comprador pessoa física. Preencha CPF ou CNPJ, não os dois.' },
  CNPJ: { text: 'CNPJ do comprador empresa. Preencha CPF ou CNPJ, não os dois.' },
  'Inscrição estadual': {
    text: 'Se o comprador tem IE: contribuinte (informa o número), isento ou não contribuinte (pessoa física e a maioria das empresas de serviço).',
  },
  'Número da IE': { text: 'Inscrição estadual do comprador, só números.' },
  Logradouro: { text: 'Rua do comprador. A NF-e exige endereço completo.' },
  Número: { text: 'Número do endereço do comprador. Use S/N se não tiver.' },
  Complemento: { text: 'Apartamento, sala, bloco. Opcional.' },
  Bairro: { text: 'Bairro do comprador.' },
  Município: { text: 'Cidade do comprador.' },
  UF: { text: 'Estado do comprador. Outro estado muda o CFOP para 6xxx.' },
  CEP: { text: 'CEP do comprador.' },
  'E-mail': { text: 'Se preencher, o comprador recebe o PDF e o XML quando a nota sair.' },
  Telefone: { text: 'Telefone do comprador. Opcional.' },
};

/** Pagamento: CPF na nota. */
export const PAYMENT_FISCAL_HELP: HelpDict = {
  'CPF/CNPJ na nota': {
    text: 'Só se o cliente pedir. O documento sai na NFC-e deste pedido.',
  },
};
