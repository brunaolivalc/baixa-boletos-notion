/**
 * Base por cliente "Cobrança por cliente" (seção 7 do roteiro).
 *
 * - Chave do cliente: "Código do parceiro" (CODPARC como texto). Um código = uma página,
 *   compartilhada pelas lojas.
 * - Toda pendência (título ou sucata) aponta para o cliente pela relação "Cliente" da base principal.
 *   A relação inversa "Pendências" e os totais do cliente são calculados pelo Notion.
 * - Cliente novo ganha no corpo a visualização vinculada "Títulos vencidos do cliente", copiada do
 *   cliente-modelo (Matias Pimentel, código 3317) trocando só o cliente do filtro. Quem tem sucata
 *   ganha também a visualização "Sucata do cliente", com os kg em coluna própria.
 *
 * Se a integração não enxergar a base de clientes, tudo isso é pulado com aviso e as pendências
 * são criadas sem o vínculo; a rotina completa os vínculos quando o acesso for liberado.
 */
import { collectPaginatedAPI } from '@notionhq/client';
import { config } from './config.js';
import { log, emParalelo } from './util.js';

export const CLIENTE_MODELO = '3317';

// Clientes que já receberam a visualização de sucata nesta execução (evita conferir a página de novo)
const comVisaoDeSucata = new Set();
const COLUNA_CODIGO = 'Código do parceiro';
export const VISAO_SUCATA = 'Sucata do cliente';

// Colunas da visualização de sucata, na ordem
const COLUNAS_VISAO_SUCATA = [
  'Nome', 'Andamento', 'Última posição', 'Próximo retorno', 'Loja', 'Localidade',
  'Saldo Sucata', 'Dias no negativo', 'Assessoria',
];

const normalizar = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const semHifen = (id) => String(id).replace(/-/g, '');
const texto = (p) => (p?.title ?? p?.rich_text ?? []).map((r) => r.plain_text).join('').trim();

/**
 * Abre a base de clientes e carrega todos os clientes por código.
 * Devolve { aviso } quando não dá para usar a base.
 */
export async function abrirClientes(notion, base) {
  if (!base.colunaCliente) {
    return { aviso: 'a relação "Cliente" não aparece para a integração: conecte a AutomateX na base de clientes' };
  }
  let fonte;
  try {
    fonte = await notion.dataSources.retrieve({ data_source_id: config.notion.clientes });
  } catch (erro) {
    if (['object_not_found', 'validation_error'].includes(erro.code)) {
      return { aviso: 'a integração não enxerga a base de clientes: conecte a AutomateX nela' };
    }
    throw erro;
  }

  const props = Object.values(fonte.properties);
  const colunaTitulo = props.find((p) => p.type === 'title');
  const colunaCodigo = props.find((p) => normalizar(p.name) === normalizar(COLUNA_CODIGO));
  if (!colunaCodigo || !['rich_text', 'title'].includes(colunaCodigo.type)) {
    throw new Error(`A base de clientes precisa da coluna de texto "${COLUNA_CODIGO}".`);
  }

  const paginas = await collectPaginatedAPI(notion.dataSources.query, { data_source_id: fonte.id, page_size: 100 });
  const porCodigo = new Map();
  const conflitos = [];
  for (const pagina of paginas) {
    if (pagina.object !== 'page' || pagina.in_trash) continue;
    const codigo = texto(pagina.properties[colunaCodigo.name]).replace(/\D/g, '');
    if (!codigo) continue;
    if (porCodigo.has(codigo)) conflitos.push(codigo);
    else porCodigo.set(codigo, pagina.id);
  }

  return {
    dataSourceId: fonte.id,
    colunaTitulo,
    colunaCodigo,
    porCodigo,
    conflitos: [...new Set(conflitos)],
    principal: base, // schema da base principal (IDs das colunas para a visão de sucata)
    modelos: null, // visualizações do cliente-modelo, carregadas sob demanda
  };
}

// ---------- visualizações vinculadas na página do cliente ----------

/** Só os campos que a API aceita na criação (a leitura traz nomes, larguras negativas etc.). */
function limparConfiguracao(conf) {
  if (!conf) return undefined;
  const limpa = { type: conf.type };
  if (Array.isArray(conf.properties)) {
    limpa.properties = conf.properties.map((p) => {
      const c = { property_id: p.property_id };
      for (const k of ['visible', 'width', 'wrap']) if (p[k] !== undefined) c[k] = p[k];
      return c;
    });
  }
  if (typeof conf.wrap_cells === 'boolean') limpa.wrap_cells = conf.wrap_cells;
  if (Number.isInteger(conf.frozen_column_index) && conf.frozen_column_index >= 0) {
    limpa.frozen_column_index = conf.frozen_column_index;
  }
  return limpa;
}

/** Troca o ID da página do cliente-modelo pelo do novo cliente em qualquer lugar do objeto. */
function trocarCliente(objeto, idModelo, idNovo) {
  if (objeto == null) return undefined;
  const json = JSON.stringify(objeto).split(idModelo).join(idNovo).split(semHifen(idModelo)).join(semHifen(idNovo));
  return JSON.parse(json);
}

/** Lê a visualização "Títulos vencidos do cliente" que está na página do cliente-modelo. */
async function carregarModelos(notion, clientes) {
  if (clientes.modelos) return clientes.modelos;
  const paginaModelo = clientes.porCodigo.get(CLIENTE_MODELO);
  const modelos = { paginaId: paginaModelo, visoes: [] };
  if (paginaModelo) {
    for (const visao of await visoesDaPagina(notion, paginaModelo)) modelos.visoes.push(visao);
  }
  clientes.modelos = modelos;
  return modelos;
}

/** Todas as visualizações vinculadas no corpo de uma página. */
async function visoesDaPagina(notion, paginaId) {
  const visoes = [];
  const blocos = await collectPaginatedAPI(notion.blocks.children.list, { block_id: paginaId });
  for (const bloco of blocos.filter((b) => b.type === 'child_database')) {
    const lista = await notion.views.list({ database_id: bloco.id });
    for (const ref of lista.results ?? []) visoes.push(await notion.views.retrieve({ view_id: ref.id }));
  }
  return visoes;
}

/** Visualização de sucata do cliente, montada com os IDs das colunas da base principal. */
function visaoDeSucata(clientes, paginaClienteId) {
  const props = clientes.principal.propriedades;
  const id = (nome) => clientes.principal.acharProp(nome)?.id;
  const visiveis = COLUNAS_VISAO_SUCATA.map(id).filter(Boolean);
  const ocultas = Object.values(props).map((p) => p.id).filter((pid) => !visiveis.includes(pid));
  return {
    name: VISAO_SUCATA,
    type: 'table',
    filter: {
      and: [
        { property: clientes.principal.colunaCliente.id, relation: { contains: paginaClienteId } },
        { property: id('Tipo de pendência'), select: { equals: 'Sucata' } },
        { property: id('Situação da pendência'), select: { equals: 'Em aberto' } },
      ],
    },
    sorts: id('Saldo Sucata') ? [{ property: id('Saldo Sucata'), direction: 'ascending' }] : undefined,
    configuration: {
      type: 'table',
      properties: [
        ...visiveis.map((pid) => ({ property_id: pid, visible: true })),
        ...ocultas.map((pid) => ({ property_id: pid, visible: false })),
      ],
    },
  };
}

async function criarVisao(notion, paginaClienteId, definicao) {
  const visao = await notion.views.create({
    data_source_id: config.notion.base,
    name: definicao.name,
    type: definicao.type,
    ...(definicao.filter ? { filter: definicao.filter } : {}),
    ...(definicao.sorts ? { sorts: definicao.sorts } : {}),
    ...(definicao.configuration ? { configuration: definicao.configuration } : {}),
    create_database: { parent: { type: 'page_id', page_id: paginaClienteId } },
  });
  if (!visao?.id) throw new Error('o Notion não devolveu o ID da visualização criada');
  return visao.id;
}

/**
 * Cria no corpo da página do cliente as visualizações que faltam: a de títulos (copiada do
 * cliente-modelo) e, se o cliente tem sucata, a de sucata. Confere as que já existem antes,
 * para não duplicar depois de uma falha.
 */
export async function criarVisoesDoCliente(notion, clientes, paginaClienteId, { sucata = false } = {}) {
  const modelos = await carregarModelos(notion, clientes);
  const existentes = new Set((await visoesDaPagina(notion, paginaClienteId)).map((v) => normalizar(v.name)));
  const criadas = [];

  for (const modelo of modelos.visoes) {
    if (existentes.has(normalizar(modelo.name))) continue;
    await criarVisao(notion, paginaClienteId, {
      name: modelo.name,
      type: modelo.type,
      filter: trocarCliente(modelo.filter, modelos.paginaId, paginaClienteId),
      sorts: modelo.sorts ?? undefined,
      configuration: limparConfiguracao(modelo.configuration),
    });
    criadas.push(modelo.name);
  }
  if (sucata && !existentes.has(normalizar(VISAO_SUCATA))) {
    await criarVisao(notion, paginaClienteId, visaoDeSucata(clientes, paginaClienteId));
    criadas.push(VISAO_SUCATA);
  }
  return { criadas, aviso: modelos.visoes.length === 0 ? 'cliente-modelo sem visualização para copiar' : null };
}

// ---------- localizar ou criar ----------

/**
 * Garante uma página de cliente para cada código pedido. Clientes que faltam são criados
 * (nunca dois do mesmo código ao mesmo tempo), com as visualizações no corpo.
 * `sucataGarantir`: códigos de clientes JÁ existentes que precisam da visualização de sucata
 * (cliente que passou a ter sucata).
 */
export async function garantirClientes(notion, clientes, pedidos, { simular = false, sucataGarantir = [] } = {}) {
  const resultado = { criados: 0, visoesSucata: 0, erros: 0, faltavam: 0 };
  const faltando = new Map(); // código -> { nome, sucata }
  for (const { codigo, nome, sucata = false } of pedidos) {
    const chave = String(codigo);
    if (clientes.porCodigo.has(chave)) continue;
    const atual = faltando.get(chave);
    faltando.set(chave, { nome: atual?.nome ?? nome, sucata: Boolean(atual?.sucata || sucata) });
  }
  resultado.faltavam = faltando.size;
  if (simular) return resultado;

  await emParalelo([...faltando], async ([codigo, { nome, sucata }]) => {
    try {
      // Consulta de novo pelo código antes de criar (resposta incerta numa execução anterior)
      const jaExiste = await notion.dataSources.query({
        data_source_id: clientes.dataSourceId,
        filter: { property: clientes.colunaCodigo.name, rich_text: { equals: codigo } },
        page_size: 1,
      });
      if (jaExiste.results?.[0]) {
        clientes.porCodigo.set(codigo, jaExiste.results[0].id);
        return;
      }

      const pagina = await notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: clientes.dataSourceId },
        properties: {
          [clientes.colunaTitulo.name]: { title: [{ type: 'text', text: { content: String(nome || codigo).slice(0, 2000) } }] },
          [clientes.colunaCodigo.name]: { rich_text: [{ type: 'text', text: { content: codigo } }] },
        },
      });

      let visoes;
      try {
        visoes = await criarVisoesDoCliente(notion, clientes, pagina.id, { sucata });
      } catch (erroVisao) {
        // Sem a visualização o cliente fica incompleto: desfaz para a próxima rodada criar tudo de novo
        await notion.pages.update({ page_id: pagina.id, in_trash: true }).catch(() => {});
        throw new Error(`visualização não criada (${erroVisao.message}); cliente desfeito para nova tentativa`);
      }
      clientes.porCodigo.set(codigo, pagina.id);
      if (sucata) comVisaoDeSucata.add(codigo);
      resultado.criados++;
      log(`  cliente criado ${codigo} -> página ${pagina.id} (visualizações: ${visoes.criadas.join(', ') || 'nenhuma'})` +
        (visoes.aviso ? `; aviso: ${visoes.aviso}` : ''));
    } catch (erro) {
      resultado.erros++;
      log(`  ERRO ao criar o cliente ${codigo}: ${erro.message}`);
    }
  });

  // Clientes que já existiam e passaram a ter sucata: acrescenta a visualização de sucata
  const garantir = [...new Set(sucataGarantir.map(String))]
    .filter((c) => clientes.porCodigo.has(c) && !faltando.has(c) && !comVisaoDeSucata.has(c));
  await emParalelo(garantir, async (codigo) => {
    try {
      const r = await criarVisoesDoCliente(notion, clientes, clientes.porCodigo.get(codigo), { sucata: true });
      comVisaoDeSucata.add(codigo);
      if (r.criadas.length > 0) {
        resultado.visoesSucata++;
        log(`  cliente ${codigo}: visualizações acrescentadas (${r.criadas.join(', ')})`);
      }
    } catch (erro) {
      resultado.erros++;
      log(`  ERRO ao acrescentar a visualização de sucata no cliente ${codigo}: ${erro.message}`);
    }
  });

  return resultado;
}
