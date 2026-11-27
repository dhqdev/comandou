import { foldText } from '../search/search';

/**
 * Palavras que não ajudam a achar nada no cadastro ("onde fica o campo de...", "me leva no..."). O
 * que sobra da pergunta vai para a busca global, e o assistente recebe os itens achados com o
 * link que leva até eles (e faz piscar). Lista sem acento (a pergunta é comparada sem acento).
 */
const STOP = new Set(
  `a o as os um uma uns umas de da do das dos em no na nos nas num numa para pra pro pras pros
   por pelo pela pelos pelas com sem e ou mas que qual quais quem como onde aonde quando quanto
   quanta quantos quantas cade porque pq se ja nao sim mais menos muito muita pouco tudo todo toda
   todos todas algum alguma nenhum nenhuma outro outra mesmo ai la aqui ali isso isto esse essa
   esses essas este esta estes estas aquele aquela eu voce vc voces me mim meu minha meus minhas
   seu sua seus suas nosso nossa ele ela eles elas lhe ola oi bom boa dia tarde noite obrigado
   obrigada favor ajuda ajudar fica ficam ficou esta estao estou estava tem tinha tenho temos ter
   ha foi ser sou era fazer faco faz fiz feito consigo consegue conseguir posso pode podem poder
   quero queria quer preciso precisa leva levar leve levo mostra mostrar mostre mostrou ver vejo
   veja vi abrir abre abra abri abro ir vai vou va vamos achar acho acha encontrar encontro mudar mudo
   muda trocar troco troca alterar altero editar edito colocar coloco por cadastrar cadastro
   cadastrado criar crio vender vendo vende novo nova novos novas tela telas campo campos botao botoes aba abas menu
   parte lugar sistema comandou item itens produto produtos mesa mesas cliente clientes pedido
   pedidos insumo insumos comanda comandas tabela lista agora hoje ontem amanha certo errado
   aparece aparecer sumiu funciona funcionando cardapio estoque caixa financeiro relatorio
   relatorios configuracao configuracoes ajuste ajustes salao cozinha entrega entregas reserva
   reservas equipe conta tela loja online pagina`.split(/\s+/),
);

/**
 * Até três buscas a partir da pergunta: as palavras que sobram juntas (até quatro) e depois as
 * duas mais compridas sozinhas. Número ("mesa 12", "pedido 345") entra como está.
 */
export function lookupQueries(question: string): string[] {
  const words = foldText(question)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w) && (w.length >= 3 || /^\d+$/.test(w)));
  const uniq = [...new Set(words)];
  if (!uniq.length) return [];
  const out = [uniq.slice(0, 4).join(' ')];
  if (uniq.length > 1)
    for (const w of [...uniq].sort((a, b) => b.length - a.length).slice(0, 2)) out.push(w);
  return [...new Set(out)].slice(0, 3);
}
