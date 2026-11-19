import type { ReactNode } from 'react';

/** Onde a credencial mora. */
export type CredGroup = 'painel' | 'instalador' | 'servidor' | 'github';

export interface CredLink {
  label: string;
  href: string;
}

/** Um campo do formulário e o que colar nele. */
export interface CredField {
  name: string;
  text: ReactNode;
}

export interface CredDef {
  id: string;
  title: string;
  group: CredGroup;
  /** Para que serve, numa frase. */
  purpose: string;
  /** Nome do secret, variável ou tela onde fica (aparece em código). */
  where?: string[];
  /** Passo a passo para conseguir e cadastrar. */
  steps: ReactNode[];
  /** O que vai em cada campo do formulário (só as do painel). */
  fields?: CredField[];
  /** Como saber que deu certo. */
  check?: ReactNode;
  links?: CredLink[];
}

const code = (s: string) => <code>{s}</code>;
const INSTALL = 'sudo bash /opt/comandou/scripts/install.sh';

/**
 * Tudo o que o Comandou precisa de chave, token ou senha, na ordem em que aparece na tela.
 * Os ids batem com os de GET /platform/credentials (que diz se cada um está configurado).
 */
export const CREDENTIALS: CredDef[] = [
  // ------------------------------------------------------------------ painel
  {
    id: 'focus_master',
    title: 'Focus NFe · Token Master',
    group: 'painel',
    purpose:
      'Emite a NFC-e e a NF-e dos restaurantes. Com ele o Comandou cadastra a empresa de cada restaurante na sua conta da Focus, sem o lojista precisar de conta lá.',
    fields: [
      {
        name: 'Token Master',
        text: (
          <>
            o token da <strong>conta</strong>, em Painel API › Tokens. Não use o token de uma
            empresa (homologação ou produção): ele só emite a nota daquela empresa e não cadastra as
            outras.
          </>
        ),
      },
    ],
    check: (
      <>
        O <strong>Testar</strong> responde “A Focus aceitou o token” e quantas empresas a conta já
        tem. Salvo, este cartão fica verde com o final do token. Se a Focus recusar, a conta ainda
        não tem o cadastro de empresas pela API: peça ao comercial dela.
      </>
    ),
    steps: [
      <>
        Crie a conta da Comandou em{' '}
        <a href="https://focusnfe.com.br" target="_blank" rel="noreferrer">
          focusnfe.com.br
        </a>{' '}
        e contrate um plano para software house (o cadastro de empresas pela API precisa estar
        liberado; se o teste abaixo recusar o token, peça isso ao comercial da Focus).
      </>,
      <>
        No painel da Focus, abra <strong>Painel API › Tokens</strong> e copie o{' '}
        <strong>Token Master</strong>. Ele é da conta, não de uma empresa.
      </>,
      <>
        Cole abaixo, clique em <strong>Testar</strong> e depois em <strong>Salvar</strong>. Vale na
        hora, sem reiniciar nada.
      </>,
      <>
        Cada restaurante faz o resto no sistema dele, em{' '}
        <strong>Fiscal › Configuração › Empresa</strong> › <em>Cadastro pelo Comandou</em>: envia o
        certificado digital A1 (.pfx e senha), o CSC da SEFAZ e a inscrição estadual. O Comandou
        cria a empresa na Focus com este token e guarda os tokens de homologação e de produção dela,
        cifrados.
      </>,
      <>
        Os endereços da Focus (homologação e produção) já vêm prontos. Comece cada restaurante em
        homologação e só passe para produção depois da primeira nota de teste autorizada.
      </>,
    ],
    links: [
      { label: 'Site da Focus NFe', href: 'https://focusnfe.com.br' },
      {
        label: 'Como a Focus cadastra empresas e tokens',
        href: 'https://doc.focusnfe.com.br/docs/como-cadastrar-uma-empresa',
      },
      {
        label: 'API de empresas (referência)',
        href: 'https://doc.focusnfe.com.br/reference/criar_empresa',
      },
    ],
  },
  {
    id: 'channel_ifood',
    title: 'iFood · aplicativo do Comandou',
    group: 'painel',
    purpose:
      'Opcional. Recebe os pedidos do iFood e sincroniza o cardápio de integração (uma credencial para todos os restaurantes).',
    fields: [
      { name: 'Client ID', text: <>o Client ID do aplicativo, no Portal do Desenvolvedor.</> },
      { name: 'Client Secret', text: <>o Client Secret do mesmo aplicativo.</> },
      {
        name: 'Modo',
        text: (
          <>
            <strong>centralizado</strong>: cada loja autoriza o Comandou no Portal do Parceiro e
            liga pelo id; <strong>distribuído</strong>: cada loja autoriza com um código.
          </>
        ),
      },
    ],
    check: (
      <>
        Salvo, este cartão fica verde com o final do segredo. No restaurante, Sistema › Aplicativos
        de delivery mostra o iFood como disponível. Antes do painel, IFOOD_CLIENT_ID e
        IFOOD_CLIENT_SECRET do servidor continuam valendo como reserva (aparece “vindo do
        servidor”).
      </>
    ),
    steps: [
      <>
        Crie o aplicativo no{' '}
        <a href="https://developer.ifood.com.br" target="_blank" rel="noreferrer">
          Portal do Desenvolvedor do iFood
        </a>{' '}
        com os módulos de pedidos, loja, cardápio e financeiro.
      </>,
      <>Copie o Client ID e o Client Secret e cole aqui embaixo, com o modo do aplicativo.</>,
    ],
    links: [{ label: 'Portal do Desenvolvedor iFood', href: 'https://developer.ifood.com.br' }],
  },
  {
    id: 'channel_keeta',
    title: 'Keeta · aplicativo do Comandou',
    group: 'painel',
    purpose:
      'Opcional. Recebe os pedidos da Keeta (Open Delivery). Uma credencial para todos os restaurantes; cada loja autoriza o Comandou no portal da Keeta.',
    fields: [
      { name: 'Client ID', text: <>o clientId do aplicativo, no portal de desenvolvedores.</> },
      {
        name: 'Client Secret',
        text: <>o clientSecret do mesmo aplicativo (também assina cada chamada).</>,
      },
    ],
    check: (
      <>
        Salvo, este cartão fica verde. No restaurante, Sistema › Aplicativos de delivery deixa ligar
        a loja da Keeta pelo código dela; se a Keeta recusar a chave, o aviso diz para falar com o
        suporte.
      </>
    ),
    steps: [
      <>
        Assine o NDA e crie a conta no{' '}
        <a
          href="https://api-docs.mykeeta.com/apis/opendelivery/keeta-developer-portal"
          target="_blank"
          rel="noreferrer"
        >
          portal de desenvolvedores da Keeta
        </a>
        ; faça o autoteste e o teste integrado com a Keeta antes da produção.
      </>,
      <>Copie o clientId e o clientSecret do aplicativo e cole aqui embaixo.</>,
    ],
    links: [
      {
        label: 'Keeta Open Delivery API',
        href: 'https://api-docs.mykeeta.com/apis/opendelivery',
      },
    ],
  },
  {
    id: 'channel_opendelivery',
    title: 'Open Delivery · aplicativo do Comandou',
    group: 'painel',
    purpose:
      'Opcional. Recebe os pedidos de um aplicativo que fala o padrão Open Delivery (versão 1), pelo endereço da API dele.',
    fields: [
      {
        name: 'Endereço da API',
        text: <>a base HTTPS que o aplicativo informou (sem barra no fim nem parâmetros).</>,
      },
      { name: 'Client ID', text: <>o identificador do Comandou nesse aplicativo.</> },
      { name: 'Client Secret', text: <>o segredo do mesmo cadastro.</> },
    ],
    check: (
      <>
        Salvo, este cartão fica verde com o servidor da API. No restaurante, a loja liga pelo id que
        o aplicativo deu a ela.
      </>
    ),
    steps: [
      <>Peça ao aplicativo o cadastro do Comandou como Software Service (Open Delivery V1).</>,
      <>Cole o endereço da API, o Client ID e o Client Secret aqui embaixo.</>,
    ],
    links: [
      {
        label: 'Padrão Open Delivery',
        href: 'https://docs.opendelivery.com.br',
      },
    ],
  },
  ...(
    [
      ['99food', '99Food', 'parceria de integração da 99Food'],
      ['rappi', 'Rappi', 'Rappi Developers (portal de parceiros)'],
      ['aiqfome', 'aiqfome', 'parceria de integração do aiqfome'],
    ] as const
  ).map(([id, name, where]): CredDef => ({
    id: `channel_${id}`,
    title: `${name} · aplicativo do Comandou`,
    group: 'painel',
    purpose: `Opcional. Recebe os pedidos do ${name} quando a integração com ele estiver pronta no Comandou.`,
    fields: [
      { name: 'Client ID', text: <>o identificador do aplicativo do Comandou.</> },
      { name: 'Client Secret', text: <>o segredo do aplicativo.</> },
      {
        name: 'Segredo do webhook',
        text: <>só se o aplicativo assinar os avisos com um segredo diferente do Client Secret.</>,
      },
    ],
    check: <>Salvo, este cartão fica verde com o final do segredo.</>,
    steps: [<>Peça as credenciais na {where} e cole aqui embaixo.</>],
  })),
  {
    id: 'openrouter_clients',
    title: 'OpenRouter · chave dos restaurantes',
    group: 'painel',
    purpose:
      'O assistente do chat e do WhatsApp de cada restaurante, a importação do cardápio, a busca no Google Maps e o site montado pela IA no comandou.com gastam desta chave.',
    fields: [
      {
        name: 'Colar a chave',
        text: (
          <>
            a chave inteira, começando com {code('sk-or-v1-')}. O OpenRouter mostra uma vez só: se
            perdeu, crie outra e apague a antiga.
          </>
        ),
      },
    ],
    check: (
      <>
        O <strong>Testar</strong> responde “Funcionou em X s” e os tokens gastos (centavos). Salva,
        Super Admin › Tokens de IA passa a mostrar o gasto de hoje, do mês e o limite da chave.
      </>
    ),
    steps: [
      <>
        Crie a conta em{' '}
        <a href="https://openrouter.ai" target="_blank" rel="noreferrer">
          openrouter.ai
        </a>{' '}
        e coloque créditos em <strong>Settings › Credits</strong>.
      </>,
      <>
        Em <strong>Settings › Keys › Create Key</strong>, crie uma chave chamada{' '}
        {code('Comandou restaurantes')}. Dica: ponha um limite de gasto na própria chave.
      </>,
      <>Copie a chave (começa com {code('sk-or-v1-')}), cole abaixo, teste e salve.</>,
      <>O limite de tokens de cada restaurante e o modelo ficam em Super Admin › Tokens de IA.</>,
      <>
        Os sites com IA usam esta mesma chave; os limites e o modelo deles ficam em Super Admin ›
        Site › Site com IA.
      </>,
    ],
    links: [
      { label: 'Chaves do OpenRouter', href: 'https://openrouter.ai/settings/keys' },
      { label: 'Créditos', href: 'https://openrouter.ai/settings/credits' },
    ],
  },
  {
    id: 'openrouter_owner',
    title: 'OpenRouter · sua chave (sistema e esteira)',
    group: 'painel',
    purpose:
      'Opcional. Esteira de chamados, testes e o que o sistema fizer por você. Sem ela, usa a chave dos restaurantes.',
    fields: [
      {
        name: 'Colar a chave',
        text: <>outra chave do OpenRouter ({code('sk-or-v1-…')}), só para o sistema.</>,
      },
    ],
    check: (
      <>
        O <strong>Testar</strong> responde “Funcionou”. Em Tokens de IA, o cartão Sua chave mostra o
        gasto do sistema separado do dos restaurantes. <strong>Apagar</strong> volta a usar a chave
        dos restaurantes.
      </>
    ),
    steps: [
      <>
        Em <strong>openrouter.ai › Settings › Keys</strong>, crie outra chave (ex.:{' '}
        {code('Comandou sistema')}), com limite se quiser. Separar ajuda a ver quanto o sistema
        gasta sem os restaurantes.
      </>,
      <>Cole abaixo, teste e salve.</>,
    ],
    links: [{ label: 'Chaves do OpenRouter', href: 'https://openrouter.ai/settings/keys' }],
  },
  {
    id: 'openrouter_admin',
    title: 'OpenRouter · chave de gerenciamento (saldo)',
    group: 'painel',
    purpose:
      'Opcional, mas é o único jeito de ver o saldo da conta. O OpenRouter só mostra os créditos (comprados e gastos) para uma chave de gerenciamento; ela não faz chamada de IA.',
    fields: [
      {
        name: 'Colar a chave',
        text: (
          <>
            a chave de gerenciamento inteira ({code('sk-or-v1-…')}), criada em Management Keys, não
            em Keys.
          </>
        ),
      },
    ],
    check: (
      <>
        O <strong>Testar</strong> responde “Funcionou” com o saldo da conta. Salva, o quadro{' '}
        <em>Saldo no OpenRouter</em> de Tokens de IA passa a mostrar quanto sobra dos créditos e de
        quanto foi a compra.
      </>
    ),
    steps: [
      <>
        Em <strong>openrouter.ai › Settings › Management Keys</strong>, crie uma chave (ex.:{' '}
        {code('Comandou saldo')}).
      </>,
      <>
        Cole abaixo, teste e salve. Ela fica cifrada e só é usada para ler o saldo, de minuto em
        minuto quando a aba Tokens está aberta.
      </>,
    ],
    links: [
      {
        label: 'Chaves de gerenciamento',
        href: 'https://openrouter.ai/settings/management-keys',
      },
    ],
  },
  {
    id: 'resend',
    title: 'Resend · chave de envio de e-mail',
    group: 'painel',
    purpose:
      'Todo e-mail do sistema sai por aqui: acesso do restaurante novo, códigos de senha, avisos de teste grátis e cobrança.',
    fields: [
      {
        name: 'API Key',
        text: (
          <>
            começa com {code('re_')}, com permissão <em>Sending access</em>. O Resend mostra uma vez
            só.
          </>
        ),
      },
      {
        name: 'Mandar um e-mail de teste para',
        text: <>um e-mail seu, para ver se chega (olhe também o spam).</>,
      },
    ],
    check: (
      <>
        O e-mail de teste chega na caixa de entrada. Em Super Admin › E-mail, o Resend aparece como{' '}
        <em>Funcionando</em> e a aba Envios mostra o e-mail entregue. Caiu no spam: falta o SPF ou o
        DKIM no DNS do domínio.
      </>
    ),
    steps: [
      <>
        Crie a conta em{' '}
        <a href="https://resend.com" target="_blank" rel="noreferrer">
          resend.com
        </a>
        .
      </>,
      <>
        Em <strong>Domains › Add Domain</strong>, adicione o seu domínio (ex.:{' '}
        {code('comandou.com')}) e crie no DNS os registros que o Resend mostrar (SPF, DKIM e, se
        quiser, DMARC). Espere ficar <em>Verified</em>.
      </>,
      <>
        Em <strong>API Keys › Create API Key</strong>, permissão <em>Sending access</em>, só para
        esse domínio. Copie a chave (começa com {code('re_')}): ela aparece uma vez só.
      </>,
      <>
        Cole abaixo e salve. Depois, em Super Admin › E-mail, escreva o remetente (um endereço do
        domínio verificado, ex.: {code('nao-responda@comandou.com')}), deixe ligado{' '}
        <em>Enviar e-mails pelo Resend</em> e salve. Por fim, mande o e-mail de teste aqui embaixo.
      </>,
    ],
    links: [
      { label: 'Domínios no Resend', href: 'https://resend.com/domains' },
      { label: 'Chaves de API do Resend', href: 'https://resend.com/api-keys' },
    ],
  },
  {
    id: 'asaas',
    title: 'Asaas · chave da API',
    group: 'painel',
    purpose:
      'Cobra a mensalidade dos restaurantes: gera as faturas (Pix, boleto e cartão), manda por e-mail e dá baixa sozinho.',
    fields: [
      {
        name: 'Ambiente',
        text: (
          <>
            <strong>Sandbox</strong> para testar (não cobra de verdade) ou <strong>Produção</strong>
            . A chave precisa ser do mesmo ambiente.
          </>
        ),
      },
      {
        name: 'Chave da API',
        text: <>começa com {code('$aact_')}. O Asaas mostra uma vez só.</>,
      },
    ],
    check: (
      <>
        <strong>Testar conexão</strong> responde “Conta (nome) conectada” e o saldo. Depois de{' '}
        <strong>Cadastrar webhook no Asaas</strong>, este cartão mostra “webhook cadastrado”; no
        Asaas, ele aparece em Integrações › Webhooks.
      </>
    ),
    steps: [
      <>
        Crie a conta da Comandou no{' '}
        <a href="https://www.asaas.com" target="_blank" rel="noreferrer">
          Asaas
        </a>{' '}
        (para testar antes, crie também uma no{' '}
        <a href="https://sandbox.asaas.com" target="_blank" rel="noreferrer">
          Sandbox
        </a>
        , que não cobra de verdade).
      </>,
      <>
        Entre como administrador e abra <strong>Integrações › Chaves de API › Gerar chave</strong>.
        A chave começa com {code('$aact_')} e aparece uma vez só. A de sandbox só funciona no
        ambiente Sandbox, e a de produção só em Produção.
      </>,
      <>
        Escolha o ambiente abaixo, cole a chave, salve e clique em <strong>Testar conexão</strong>.
      </>,
      <>
        Clique em <strong>Cadastrar webhook no Asaas</strong>: é assim que o pagamento libera o
        restaurante sozinho. Prazos, bloqueio e cartão automático ficam em Super Admin › Cobrança.
      </>,
    ],
    links: [
      {
        label: 'Chaves de API no Asaas',
        href: 'https://www.asaas.com/customerApiAccessToken/index',
      },
      { label: 'Documentação das chaves', href: 'https://docs.asaas.com/docs/chaves-de-api' },
    ],
  },
  {
    id: 'pagbank',
    title: 'PagBank · conta e aplicação do Connect',
    group: 'painel',
    purpose:
      'Opcional. Pagamento por cartão e Pix no cardápio online, com a taxa da Comandou separada na hora pelo PagBank.',
    fields: [
      {
        name: 'Ambiente',
        text: <>Sandbox para testar ou Produção, o mesmo do token.</>,
      },
      {
        name: 'Token da conta PagBank',
        text: <>o token gerado em Venda online › Integrações.</>,
      },
      {
        name: 'Conta que recebe a taxa',
        text: (
          <>
            o id da sua conta PagBank (começa com {code('ACCO_')}). Às vezes vem sozinho ao criar a
            aplicação.
          </>
        ),
      },
      {
        name: 'Client id e client secret',
        text: (
          <>
            deixe em branco e clique em <strong>Criar aplicação no PagBank</strong>. Só preencha se
            você já tem uma aplicação do Connect.
          </>
        ),
      },
    ],
    check: (
      <>
        Com a aplicação criada, este cartão fica verde com o ambiente e a conta. Em Pagamentos pelo
        app, libere um restaurante de teste e pague um Pix pequeno no cardápio dele.
      </>
    ),
    steps: [
      <>
        Peça ao comercial do PagBank para liberar na sua conta a{' '}
        <em>divisão de pagamento (split)</em> e o <em>PagBank Connect</em>. Sem isso, o pagamento
        com taxa é recusado.
      </>,
      <>
        Entre em{' '}
        <a href="https://acesso.pagbank.com.br" target="_blank" rel="noreferrer">
          acesso.pagbank.com.br
        </a>{' '}
        e abra <strong>Venda online › Integrações › Gerar token</strong>. O token de sandbox só
        funciona no Sandbox.
      </>,
      <>
        Cole o token e o id da sua conta (começa com {code('ACCO_')}) abaixo e salve. Depois clique
        em <strong>Criar aplicação no PagBank</strong>: o client id e o client secret vêm sozinhos.
        Se já tiver uma aplicação, cole os dois.
      </>,
      <>A taxa da Comandou e quem pode cobrar ficam em Super Admin › Pagamentos pelo app.</>,
    ],
    links: [
      { label: 'Portal do desenvolvedor PagBank', href: 'https://developer.pagbank.com.br' },
      { label: 'Entrar no PagBank', href: 'https://acesso.pagbank.com.br' },
    ],
  },
  {
    id: 'backblaze',
    title: 'Backblaze B2 · bucket dos backups',
    group: 'painel',
    purpose:
      'Opcional, mas recomendado. Leva a cópia diária de todos os bancos para fora do servidor. Sem ele, o backup fica só no próprio servidor.',
    fields: [
      {
        name: 'Endereço S3 (Endpoint)',
        text: (
          <>
            o Endpoint que aparece no bucket, ex.: {code('s3.us-east-005.backblazeb2.com')} (a
            região sai dele).
          </>
        ),
      },
      { name: 'Nome do bucket', text: <>o nome exato do bucket que você criou.</> },
      { name: 'keyID', text: <>o keyID da Application Key (não o da conta).</> },
      {
        name: 'applicationKey',
        text: <>a chave que aparece uma vez só ao criar a Application Key.</>,
      },
    ],
    check: (
      <>
        <strong>Testar conexão</strong> responde “Bucket funcionando” com cada passo (gravar, ler e
        apagar). Depois, em Infraestrutura › Backups, ligue o envio e confira no dia seguinte o
        último backup enviado.
      </>
    ),
    steps: [
      <>
        Em{' '}
        <a href="https://secure.backblaze.com/b2_buckets.htm" target="_blank" rel="noreferrer">
          B2 Cloud Storage › Buckets › Create a Bucket
        </a>
        : nome único, arquivos <strong>Private</strong>. Copie o <strong>Endpoint</strong> que
        aparece no bucket.
      </>,
      <>
        Em <strong>Lifecycle Settings</strong> do bucket, escolha{' '}
        <em>Keep only the last version of the file</em>.
      </>,
      <>
        Em{' '}
        <a href="https://secure.backblaze.com/app_keys.htm" target="_blank" rel="noreferrer">
          Application Keys › Add a New Application Key
        </a>
        : acesso só a esse bucket, <em>Read and Write</em>. Copie o <strong>keyID</strong> e a{' '}
        <strong>applicationKey</strong> (ela aparece uma vez só).
      </>,
      <>
        Cole abaixo, clique em <strong>Testar conexão</strong> e salve. Horário, retenção e o liga e
        desliga ficam em Super Admin › Infraestrutura › Backups.
      </>,
    ],
    links: [
      { label: 'Buckets do B2', href: 'https://secure.backblaze.com/b2_buckets.htm' },
      { label: 'Application Keys', href: 'https://secure.backblaze.com/app_keys.htm' },
    ],
  },
  {
    id: 'github_pipeline',
    title: 'GitHub · token da esteira de chamados',
    group: 'painel',
    purpose:
      'Opcional. A esteira de chamados cria a branch e abre o PR no repositório com ele (repositório privado).',
    fields: [
      {
        name: 'Token do GitHub',
        text: (
          <>
            começa com {code('github_pat_')}. O repositório (dono/nome) e a branch ficam em Chamados
            › Configurar.
          </>
        ),
      },
    ],
    check: (
      <>
        <strong>Testar GitHub</strong> mostra cada permissão com um visto verde. Se uma falhar,
        edite o token no GitHub, marque a permissão que faltou e teste de novo.
      </>
    ),
    steps: [
      <>
        Com a conta dona do repositório, abra{' '}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
        >
          Settings › Developer settings › Fine-grained tokens › Generate new token
        </a>
        .
      </>,
      <>
        Nome {code('Comandou esteira')}, expiração de 1 ano (anote para renovar),{' '}
        <strong>Only select repositories</strong> com o repositório do Comandou.
      </>,
      <>
        Permissões do repositório: <strong>Contents: Read and write</strong>,{' '}
        <strong>Pull requests: Read and write</strong> e <strong>Actions: Read-only</strong>.
      </>,
      <>
        Gere, copie (começa com {code('github_pat_')}), cole abaixo, clique em{' '}
        <strong>Testar GitHub</strong> e salve. Repositório, branch e regras ficam em Super Admin ›
        Chamados › Configurar.
      </>,
    ],
    links: [
      {
        label: 'Criar token no GitHub',
        href: 'https://github.com/settings/personal-access-tokens/new',
      },
    ],
  },

  // ------------------------------------------------------------------ servidor: instalador
  {
    id: 'integrations_key',
    title: 'Chave mestra (INTEGRATIONS_KEY)',
    group: 'instalador',
    purpose:
      'Cifra todas as chaves deste painel, os tokens fiscais e do WhatsApp de cada restaurante e os backups. É a mais importante de todas.',
    where: ['comandou_integrations_key'],
    steps: [
      <>O instalador gera sozinha na primeira subida (32 bytes aleatórios).</>,
      <>
        Guarde uma cópia fora do servidor (num gerenciador de senhas). Sem ela, nenhum backup abre e
        todas as chaves salvas precisam ser cadastradas de novo. Para copiar:{' '}
        {code(
          'docker exec $(docker ps -q -f label=com.docker.swarm.service.name=comandou_api | head -1) cat /run/secrets/comandou_integrations_key',
        )}
      </>,
      <>Nunca troque esta chave num servidor que já tem dados.</>,
    ],
  },
  {
    id: 'database',
    title: 'Senhas do banco de dados',
    group: 'instalador',
    purpose: 'Senhas dos papéis do PostgreSQL (superusuário, dono, aplicação e painel).',
    where: [
      'comandou_pg_password',
      'comandou_owner_password',
      'comandou_app_password',
      'comandou_platform_password',
      'comandou_db_app_url',
      'comandou_db_owner_url',
      'comandou_db_platform_url',
    ],
    steps: [
      <>O instalador gera todas, aleatórias, e nunca grava em arquivo.</>,
      <>Não há nada para você fazer. Só não apague esses secrets.</>,
    ],
  },
  {
    id: 'platform_admin',
    title: 'Seu acesso ao Super Admin',
    group: 'instalador',
    purpose: 'Seu e-mail, senha e o código do autenticador para entrar em admin.<domínio>.',
    where: ['comandou_platform_admin_password', 'comandou_platform_admin_totp'],
    steps: [
      <>
        O instalador pergunta o e-mail e a senha (12 caracteres ou mais) e mostra o QR Code do
        autenticador. Leia com o Google Authenticator, Authy ou 1Password.
      </>,
      <>
        Esqueceu a senha ou perdeu o celular: rode{' '}
        {code('sudo bash /opt/comandou/scripts/admin-reset.sh')} no servidor.
      </>,
    ],
  },
  {
    id: 'whatsapp_gateway',
    title: 'WhatsApp · token do gateway',
    group: 'instalador',
    purpose: 'A API e o serviço do WhatsApp (QR Code) conversam com este token.',
    where: ['comandou_wa_gateway_token'],
    steps: [<>O instalador gera sozinho. Nada para fazer.</>],
  },
  {
    id: 'whatsapp_session',
    title: 'WhatsApp · chave das sessões',
    group: 'instalador',
    purpose:
      'Cifra as sessões do WhatsApp de cada restaurante. Perder esta chave obriga todos a ler o QR Code de novo.',
    where: ['comandou_wa_session_key'],
    steps: [<>O instalador gera sozinho. Daqui não dá para conferir: ela fica só no gateway.</>],
  },
  {
    id: 'traefik_provider',
    title: 'Traefik · token dos endereços',
    group: 'instalador',
    purpose:
      'O Traefik pergunta à API quais endereços existem (admin, cada restaurante e domínios próprios) e pede o HTTPS de cada um.',
    where: ['comandou_traefik_provider_token'],
    steps: [
      <>
        O instalador gera e, se for instalar o Traefik junto ({code('INSTALL_TRAEFIK=1')}), já põe
        na configuração dele.
      </>,
      <>
        Traefik que você já tinha: o endereço do provider HTTP leva este token. Passo a passo em{' '}
        {code('docs/deploy.md')}.
      </>,
    ],
  },
  {
    id: 'host_agent',
    title: 'Agente do servidor',
    group: 'instalador',
    purpose: 'Botão Atualizar, reiniciar serviços e ver logs pela tela Infraestrutura.',
    where: ['comandou_agent_token'],
    steps: [
      <>
        O instalador gera e sobe o agente junto. Para não ter o agente: {code('COMANDOU_AGENT=off')}{' '}
        no {code('/etc/comandou/deploy.env')}.
      </>,
    ],
  },
  {
    id: 'metrics',
    title: 'Métricas (Prometheus)',
    group: 'instalador',
    purpose: 'Protege o endereço /api/v1/metrics, usado pelo monitoramento.',
    where: ['comandou_metrics_token'],
    steps: [
      <>
        O instalador gera. No Prometheus, mande {code('Authorization: Bearer <token>')} ao ler as
        métricas.
      </>,
    ],
  },
  {
    id: 'crowdsec',
    title: 'CrowdSec · chave do bloqueio',
    group: 'instalador',
    purpose: 'Opcional. Bloqueia IPs que atacam o servidor, no Traefik.',
    where: ['comandou_crowdsec_bouncer_key'],
    steps: [
      <>
        Rode {code('sudo bash /opt/comandou/scripts/crowdsec.sh')}: ele cria a chave, sobe o
        CrowdSec e liga o bloqueio.
      </>,
      <>
        Opcional: para ver os ataques no painel do CrowdSec, crie a conta em{' '}
        <a href="https://app.crowdsec.net" target="_blank" rel="noreferrer">
          app.crowdsec.net
        </a>{' '}
        e ponha {code('CROWDSEC_ENROLL_KEY=<chave>')} no {code('/etc/comandou/deploy.env')}.
      </>,
    ],
    links: [{ label: 'Console do CrowdSec', href: 'https://app.crowdsec.net' }],
  },

  // ------------------------------------------------------------------ servidor: você informa
  {
    id: 'dns',
    title: 'DNS do domínio',
    group: 'servidor',
    purpose: 'Faz o domínio, o admin e cada restaurante chegarem a este servidor.',
    check: (
      <>
        No seu computador, {code('nslookup admin.seudominio.com.br')} responde o IP do servidor.
        Depois do instalador, o admin abre com o cadeado do HTTPS.
      </>
    ),
    steps: [
      <>
        No painel do seu domínio (Registro.br, Cloudflare ou outro), crie registros{' '}
        <strong>A</strong> de {code('@')}, {code('*')} e {code('admin')} apontando para o IP do
        servidor.
      </>,
      <>Na Cloudflare, deixe a nuvem cinza (só DNS) até os certificados saírem.</>,
      <>
        Os registros do e-mail (SPF e DKIM do Resend) também ficam aqui: veja o passo a passo do
        Resend acima.
      </>,
    ],
    links: [
      { label: 'Registro.br', href: 'https://registro.br' },
      { label: 'Cloudflare', href: 'https://dash.cloudflare.com' },
    ],
  },
  {
    id: 'acme_email',
    title: 'E-mail do Let’s Encrypt',
    group: 'servidor',
    purpose: 'Recebe os avisos dos certificados HTTPS (só quando o instalador instala o Traefik).',
    where: ['COMANDOU_ACME_EMAIL'],
    steps: [<>O instalador pergunta. Use um e-mail que você lê.</>],
  },
  {
    id: 'update_github',
    title: 'GitHub · token das atualizações',
    group: 'servidor',
    purpose:
      'Opcional. Só com o repositório privado: o painel acha as versões novas no GitHub com ele.',
    where: ['UPDATE_GITHUB_TOKEN'],
    steps: [
      <>
        Crie um{' '}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
        >
          fine-grained token
        </a>{' '}
        só do repositório do Comandou, com <strong>Contents: Read-only</strong>.
      </>,
      <>
        Ponha {code('UPDATE_GITHUB_TOKEN=github_pat_…')} no {code('/etc/comandou/deploy.env')} e
        rode {code(INSTALL)}.
      </>,
    ],
  },
  {
    id: 'ghcr_agent',
    title: 'GitHub · leitura das imagens (GHCR)',
    group: 'servidor',
    purpose:
      'Opcional. Só se as imagens do Comandou no GitHub forem privadas: o instalador e o agente baixam as versões com ele.',
    where: ['GITHUB_TOKEN (instalação)', 'GHCR_USER', 'GHCR_TOKEN'],
    steps: [
      <>
        Crie um{' '}
        <a
          href="https://github.com/settings/tokens/new?scopes=read:packages&description=Comandou%20imagens"
          target="_blank"
          rel="noreferrer"
        >
          token clássico com read:packages
        </a>
        .
      </>,
      <>
        Na instalação: {code('GITHUB_TOKEN=ghp_… ' + INSTALL)}. Para o agente atualizar sozinho:{' '}
        {code('GHCR_USER=<seu usuário>')} e {code('GHCR_TOKEN=ghp_…')} no{' '}
        {code('/etc/comandou/deploy.env')}.
      </>,
    ],
  },

  // ------------------------------------------------------------------ GitHub Actions
  {
    id: 'github_deploy',
    title: 'GitHub Actions · implantar pelo GitHub',
    group: 'github',
    purpose:
      'Opcional. Só para o workflow manual "Deploy (produção)". O botão Atualizar do painel não precisa disto.',
    where: ['DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_PATH'],
    steps: [
      <>
        No servidor, crie uma chave SSH só para isso ({code('ssh-keygen -t ed25519 -f deploy')}) e
        ponha a pública em {code('~/.ssh/authorized_keys')} do usuário que roda o Docker.
      </>,
      <>
        No repositório, em{' '}
        <a
          href="https://github.com/dhqdev/comandou/settings/secrets/actions"
          target="_blank"
          rel="noreferrer"
        >
          Settings › Secrets and variables › Actions
        </a>
        , crie os secrets {code('DEPLOY_SSH_KEY')} (a chave privada), {code('DEPLOY_KNOWN_HOSTS')}{' '}
        (saída de {code('ssh-keyscan -H <ip do servidor>')}), {code('DEPLOY_HOST')} e{' '}
        {code('DEPLOY_USER')}.
      </>,
      <>
        Opcional: a variável {code('DEPLOY_PATH')} (padrão {code('/opt/comandou')}).
      </>,
    ],
    links: [
      {
        label: 'Secrets do repositório',
        href: 'https://github.com/dhqdev/comandou/settings/secrets/actions',
      },
    ],
  },
];

/** Credenciais que cada restaurante cadastra no sistema dele (só para você saber). */
export const TENANT_CREDENTIALS: { title: string; where: string; what: string }[] = [
  {
    title: 'Nota fiscal',
    where: 'Fiscal › Configuração › Empresa',
    what: 'Certificado digital A1 (.pfx e senha), CSC da SEFAZ e inscrição estadual. O Comandou cadastra a empresa na Focus com o seu Token Master.',
  },
  {
    title: 'Pagamento pelo app',
    where: 'Loja online › Pagamentos',
    what: 'Conecta a conta PagBank do restaurante (autoriza sem passar senha).',
  },
  {
    title: 'WhatsApp',
    where: 'Sistema › WhatsApp',
    what: 'Lê o QR Code com o celular do restaurante.',
  },
  {
    title: 'iFood',
    where: 'Cardápio › Cardápios (cardápio do iFood)',
    what: 'Autoriza a loja no Portal do Parceiro (ou com o código, no modo distribuído).',
  },
];
