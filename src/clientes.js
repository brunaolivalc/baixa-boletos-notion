/**
 * Base por cliente (seção 7 do roteiro).
 *
 * - Chave do cliente: "Código do parceiro" (CODPARC como texto). Um código = uma página,
 *   compartilhada pelas lojas.
 * - Toda pendência (título ou sucata) aponta para o cliente pela relação "Cliente" da base principal.
 * - Cliente novo ganha no corpo as visualizações vinculadas da base principal, copiadas do
 *   cliente-modelo (Matias Pimentel, código 3317), trocando só o filtro do cliente.
 *
 * Se a integração não enxergar a base de clientes, tudo isso é pulado com aviso e as pendências
 * são criadas sem o vínculo; a rotina completa os vínculos quando o acesso for liberado.
 */
import { collectPaginatedAPI } from '@notionhq/client';
import { config } from './config.js';
import { log } from './util.js';

export const CLIENTE_MODELO = '3317';
const COLUNA_CODIGO = 'Código do parceiro';

const normalizar = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const semHifen = (id) => String(id).replace(/-/g, '');
const texto = (p) => (p?.title ?? p?.rich_text ?? []).map((r) => r.plain_text).join('').trim();

/**
 * Abre a base de clientes e carrega todos os clientes por código.
 * Devolve null (com o motivo em `aviso`) quando não dá para usar a base.
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
    modelos: null, // visualizações do cliente-modelo, carregadas sob demanda
  };
}

// ---------- visualizações vinculadas na página do cliente ----------

/** Lê as visualizações vinculadas que estão no corpo da página do cliente-modelo. */
async function carregarModelos(notion, clientes) {
  if (clientes.modelos) return clientes.modelos;
  const paginaModelo = clientes.porCodigo.get(CLIENTE_MODELO);
  clientes.modelos = { paginaId: paginaModelo, visoes: [] };
  if (!paginaModelo) return clientes.modelos;

  const blocos = await collectPaginatedAPI(notion.blocks.children.list, { block_id: paginaModelo });
  for (const bloco of blocos.filter((b) => b.type === 'child_database')) {
    const lista = await notion.views.list({ database_id: bloco.id });
    for (const ref of lista.results ?? []) {
      const visao = await notion.views.retrieve({ view_id: ref.id });
      clientes.modelos.visoes.push(visao);
    }
  }
  return clientes.modelos;
}

/** Troca o ID da página do cliente-modelo pelo do novo cliente em qualquer lugar do objeto. */
function trocarCliente(objeto, idModelo, idNovo) {
  if (objeto == null) return objeto;
  let json = JSON.stringify(objeto);
  json = json.split(idModelo).join(idNovo).split(semHifen(idModelo)).join(semHifen(idNovo));
  return JSON.parse(json);
}

/**
 * Cria no corpo da página do cliente as mesmas visualizações do cliente-modelo.
 * Confere se a página já tem visualizações antes de criar (para não duplicar após uma falha).
 */
export async function criarVisoesDoCliente(notion, clientes, paginaClienteId) {
  const modelos = await carregarModelos(notion, clientes);
  if (!modelos.paginaId || modelos.visoes.length === 0) {
    return { criadas: 0, aviso: 'cliente-modelo sem visualização vinculada para copiar' };
  }

  const existentes = await collectPaginatedAPI(notion.blocks.children.list, { block_id: paginaClienteId });
  if (existentes.some((b) => b.type === 'child_database')) return { criadas: 0 };

  let criadas = 0;
  for (const modelo of modelos.visoes) {
    const visao = await notion.views.create({
      data_source_id: modelo.data_source_id ?? config.notion.base,
      name: modelo.name,
      type: modelo.type,
      filter: trocarCliente(modelo.filter, modelos.paginaId, paginaClienteId) ?? undefined,
      sorts: modelo.sorts ?? undefined,
      configuration: modelo.configuration ?? undefined,
      create_database: { parent: { type: 'page_id', page_id: paginaClienteId } },
    });
    if (!visao?.id) throw new Error('o Notion não devolveu o ID da visualização criada');
    criadas++;
  }
  return { criadas };
}

// ---------- localizar ou criar ----------

/**
 * Garante uma página de cliente para cada código pedido. Clientes que faltam são criados
 * um código por vez (nunca dois iguais em paralelo), com as visualizações no corpo.
 * Devolve o Map código -> ID da página e os erros.
 */
export async function garantirClientes(notion, clientes, pedidos, { simular = false } = {}) {
  const resultado = { criados: 0, erros: 0, faltavam: 0 };
  const faltando = new Map();
  for (const { codigo, nome } of pedidos) {
    const chave = String(codigo);
    if (!clientes.porCodigo.has(chave) && !faltando.has(chave)) faltando.set(chave, nome);
  }
  resultado.faltavam = faltando.size;
  if (simular || faltando.size === 0) return resultado;

  for (const [codigo, nome] of faltando) {
    try {
      // Consulta de novo pelo código antes de criar (resposta incerta numa execução anterior)
      const jaExiste = await notion.dataSources.query({
        data_source_id: clientes.dataSourceId,
        filter: { property: clientes.colunaCodigo.name, rich_text: { equals: codigo } },
        page_size: 1,
      });
      if (jaExiste.results?.[0]) {
        clientes.porCodigo.set(codigo, jaExiste.results[0].id);
        continue;
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
        visoes = await criarVisoesDoCliente(notion, clientes, pagina.id);
      } catch (erroVisao) {
        // Sem a visualização o cliente fica incompleto: desfaz para a próxima rodada criar tudo de novo
        await notion.pages.update({ page_id: pagina.id, in_trash: true }).catch(() => {});
        throw new Error(`visualização não criada (${erroVisao.message}); cliente desfeito para nova tentativa`);
      }
      clientes.porCodigo.set(codigo, pagina.id);
      resultado.criados++;
      log(`  cliente criado ${codigo} -> página ${pagina.id} (${visoes.criadas} visualizações)` +
        (visoes.aviso ? `; aviso: ${visoes.aviso}` : ''));
    } catch (erro) {
      resultado.erros++;
      log(`  ERRO ao criar o cliente ${codigo}: ${erro.message}`);
    }
  }
  return resultado;
}
