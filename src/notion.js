/**
 * Acesso à base do Notion pela API oficial (@notionhq/client).
 */
import { Client, collectPaginatedAPI } from '@notionhq/client';
import { config } from './config.js';
import { CAMPOS, COLUNA_CHAVE, PREFIXO_CHAVE, COLUNA_VENCIMENTO, CORPO_CARD_NOVO } from './campos.js';

const TIPOS_GRAVAVEIS = new Set([
  'title', 'rich_text', 'number', 'date', 'select', 'multi_select',
  'status', 'phone_number', 'email', 'url', 'checkbox',
]);
const NAO_ACHOU = ['object_not_found', 'validation_error'];

export function criarClienteNotion() {
  return new Client({ auth: config.notion.token, retry: { maxRetries: 5 } });
}

const normalizarNome = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Aceita link ou ID da base, da fonte de dados ou da página que contém a base. */
function extrairId(entrada) {
  const comHifens = entrada.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (comHifens) return comHifens[0];
  const caminho = entrada.split(/[?#]/)[0].replace(/\/+$/, '');
  const id = caminho.split('/').pop().match(/([0-9a-f]{32})$/i);
  if (!id) throw new Error(`NOTION_DATABASE inválido: não achei um ID do Notion em "${entrada}"`);
  return id[1];
}

const SEM_ACESSO =
  'Confira se o ID/link está certo e se a integração foi conectada à base no Notion ' +
  '(menu ••• da página > Conexões > escolher a integração).';

async function tentar(fn) {
  try {
    return await fn();
  } catch (erro) {
    if (NAO_ACHOU.includes(erro.code)) return null;
    if (erro.code === 'unauthorized') throw new Error('Token do Notion inválido (NOTION_TOKEN).');
    throw erro;
  }
}

async function acharFonteDeDados(notion, id) {
  // 1. ID da fonte de dados (o que está no roteiro)
  const fonte = await tentar(() => notion.dataSources.retrieve({ data_source_id: id }));
  if (fonte) return fonte;

  // 2. ID/link da base
  let database = await tentar(() => notion.databases.retrieve({ database_id: id }));

  // 3. Página que contém a base
  if (!database) {
    const filhos = await tentar(() => collectPaginatedAPI(notion.blocks.children.list, { block_id: id }));
    if (!filhos) throw new Error(`Não consegui abrir a base do Notion. ${SEM_ACESSO}`);
    const bases = filhos.filter((b) => b.type === 'child_database');
    if (bases.length !== 1) {
      throw new Error(`A página tem ${bases.length} bases de dados; use o link ou ID da base certa.`);
    }
    database = await notion.databases.retrieve({ database_id: bases[0].id });
  }

  const fontes = database.data_sources ?? [];
  if (fontes.length === 0) throw new Error('A base do Notion não tem nenhuma fonte de dados.');
  if (fontes.length > 1) {
    throw new Error(`A base tem ${fontes.length} fontes de dados; use o ID da fonte certa em NOTION_DATABASE.`);
  }
  return notion.dataSources.retrieve({ data_source_id: fontes[0].id });
}

/**
 * Abre a base e confere quais colunas do de-para existem nela.
 */
export async function abrirBase(notion) {
  const fonte = await acharFonteDeDados(notion, extrairId(config.notion.base));
  const props = Object.values(fonte.properties);
  const porNome = new Map(props.map((p) => [normalizarNome(p.name), p]));
  // Segunda tentativa sem o que está entre parênteses e sem pontuação: "Valor líquido (R$)" = "Valor líquido"
  const simplificar = (s) =>
    normalizarNome(String(s).replace(/\([^)]*\)/g, ' ')).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const porNomeSimples = new Map();
  for (const p of props) {
    const k = simplificar(p.name);
    porNomeSimples.set(k, porNomeSimples.has(k) ? null : p); // nome ambíguo não vale
  }
  const acharProp = (nome) => porNome.get(normalizarNome(nome)) ?? porNomeSimples.get(simplificar(nome)) ?? null;

  const colunas = [];
  const avisos = [];

  for (const campo of CAMPOS) {
    let prop = campo.nomes.map(acharProp).find(Boolean);
    if (!prop && campo.titulo) prop = props.find((p) => p.type === 'title');
    if (!prop) {
      avisos.push(`Coluna "${campo.nomes[0]}" não existe no Notion (ignorada).`);
    } else if (!TIPOS_GRAVAVEIS.has(prop.type)) {
      avisos.push(`Coluna "${prop.name}" é do tipo ${prop.type}, que não dá para preencher pela API (ignorada).`);
    } else {
      colunas.push({ prop, valorDoTitulo: campo.valor });
    }
  }

  const colunaChave = acharProp(COLUNA_CHAVE);
  if (!colunaChave) throw new Error(`A base do Notion precisa da coluna "${COLUNA_CHAVE}".`);
  if (!['rich_text', 'title'].includes(colunaChave.type)) {
    throw new Error(`A coluna "${COLUNA_CHAVE}" precisa ser de texto (hoje é ${colunaChave.type}).`);
  }

  return {
    nome: fonte.title?.map((t) => t.plain_text).join('') || '(sem nome)',
    url: fonte.url,
    dataSourceId: fonte.id,
    propriedades: fonte.properties,
    colunas,
    colunaChave,
    colunaVencimento: acharProp(COLUNA_VENCIMENTO),
    avisos,
    avisosDeOpcao: new Set(),
  };
}

// ---------- conversão de valores ----------

/** Acha a opção existente de uma coluna de seleção (igual ou contida, ex.: "1 — Brasília"). */
function acharOpcao(opcoes, valor) {
  const alvo = normalizarNome(valor);
  return (
    opcoes.find((o) => normalizarNome(o.name) === alvo) ??
    opcoes.find((o) => normalizarNome(o.name).includes(alvo) || alvo.includes(normalizarNome(o.name)))
  );
}

function paraNotion(base, prop, valor) {
  const vazio = valor == null || valor === '';
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return { [prop.type]: vazio ? [] : [{ type: 'text', text: { content: String(valor).slice(0, 2000) } }] };
    case 'number':
      return { number: vazio || Number.isNaN(Number(valor)) ? null : Number(valor) };
    case 'date':
      return { date: vazio ? null : { start: String(valor).slice(0, 10) } };
    case 'phone_number':
    case 'email':
    case 'url':
      return { [prop.type]: vazio ? null : String(valor) };
    case 'checkbox':
      return { checkbox: Boolean(valor) };
    case 'select':
    case 'multi_select':
    case 'status': {
      if (vazio) return prop.type === 'status' ? undefined : { [prop.type]: prop.type === 'select' ? null : [] };
      const opcao = acharOpcao(prop[prop.type]?.options ?? [], valor);
      if (!opcao) {
        base.avisosDeOpcao.add(`Coluna "${prop.name}" não tem a opção "${valor}"` +
          (prop.type === 'status' ? ' (campo deixado em branco).' : ' (o Notion vai criar a opção).'));
        if (prop.type === 'status') return undefined;
      }
      const nome = opcao?.name ?? String(valor).replace(/,/g, ' ').slice(0, 100);
      if (prop.type === 'multi_select') return { multi_select: [{ name: nome }] };
      return { [prop.type]: { name: nome } };
    }
    default:
      return undefined;
  }
}

/** Lê o valor "simples" de uma propriedade de página. */
function valorSimples(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return (prop[prop.type] ?? []).map((r) => r.plain_text ?? '').join('').trim() || null;
    case 'number':
      return prop.number ?? null;
    case 'date':
      return prop.date?.start?.slice(0, 10) ?? null;
    case 'select':
    case 'status':
      return prop[prop.type]?.name ?? null;
    default:
      return null;
  }
}

export function montarPropriedades(base, titulo) {
  const props = {};
  for (const { prop, valorDoTitulo } of base.colunas) {
    const valor = paraNotion(base, prop, valorDoTitulo(titulo));
    if (valor !== undefined) props[prop.name] = valor;
  }
  return props;
}

export function vencimentoNoNotion(base, pagina) {
  return base.colunaVencimento ? valorSimples(pagina.properties[base.colunaVencimento.name]) : null;
}

/**
 * Todas as páginas de títulos da base, indexadas pela Chave Sankhya.
 * Só considera chaves "TIT:<número>"; cards de sucata e cards sem chave ficam de fora.
 */
export async function listarPaginas(notion, base) {
  const paginas = await collectPaginatedAPI(notion.dataSources.query, {
    data_source_id: base.dataSourceId,
    page_size: 100,
  });

  const porChave = new Map();
  const duplicadas = new Map(); // chave -> lista de páginas

  for (const pagina of paginas) {
    if (pagina.object !== 'page' || pagina.in_trash) continue;
    const chave = valorSimples(pagina.properties[base.colunaChave.name])?.toUpperCase().replace(/\s+/g, '');
    if (!chave?.startsWith(PREFIXO_CHAVE)) continue;
    const nufin = Number(chave.slice(PREFIXO_CHAVE.length));
    if (!Number.isInteger(nufin) || nufin <= 0) continue;

    const normal = `${PREFIXO_CHAVE}${nufin}`;
    if (duplicadas.has(normal)) duplicadas.get(normal).push(pagina);
    else if (porChave.has(normal)) {
      duplicadas.set(normal, [porChave.get(normal), pagina]);
      porChave.delete(normal);
    } else porChave.set(normal, { nufin, pagina });
  }

  return { porChave, duplicadas, total: paginas.length };
}

export function criarPagina(notion, base, titulo) {
  return notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: base.dataSourceId },
    properties: montarPropriedades(base, titulo),
    children: CORPO_CARD_NOVO,
  });
}

/** Manda a página para a lixeira do Notion e confirma na resposta. */
export async function excluirPagina(notion, pagina) {
  const resposta = await notion.pages.update({ page_id: pagina.id, in_trash: true });
  if (resposta.in_trash !== true) throw new Error('o Notion não confirmou o envio para a lixeira');
  return resposta;
}
