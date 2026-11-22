/**
 * Rotina diária de TÍTULOS: Sankhya -> base "Posição de Cobrança" no Notion.
 *
 * 1. Lê a carteira inteira no Sankhya: a receber, em aberto, cliente externo, empresas 1 a 9,
 *    vencimento até ontem (data de Brasília). O Notion separa sozinho, pela "Faixa de vencimento",
 *    as visões de 1 a 7 dias e de +7 dias. Se a leitura falhar, para sem mexer no Notion.
 * 2. Lê todos os cards de títulos do Notion (Chave Sankhya = TIT:<NUFIN>) e a base de clientes.
 * 3. Chave nova -> garante o cliente e cria o card já com o vínculo (Em aberto / A tratar +
 *    cabeçalho "Histórico de tratativas").
 *    Chave que já existe -> preserva tudo; só completa o que estiver vazio (vínculo com o cliente,
 *    vendedor e campos do Sankhya que faltaram).
 * 4. Card cujo título saiu da carteira -> confere o NUFIN no Sankhya:
 *    - baixa integral confirmada: manda o card para a lixeira;
 *    - vencimento hoje ou futuro e o card entrou assim (carga antiga de "a vencer"): lixeira;
 *    - baixa parcial, renegociação, título não encontrado, vencimento repactuado:
 *      mantém o card e registra a exceção para revisão.
 */
import { config } from './config.js';
import {
  chaveDoTitulo, LOJAS, POLOS, CAMPOS_DO_ERP_TITULO, COLUNA_PARCEIRO, COLUNA_VENDEDOR,
} from './campos.js';
import { buscarTitulosVencidos, buscarTitulosPorNufin, consultarSituacao } from './titulos.js';
import {
  criarClienteNotion, abrirBase, listarPaginas, vencimentoNoNotion, valorDaColuna,
  montarPropriedades, criarPagina, atualizarPagina, excluirPagina,
  camposParaCompletar, clientesDaPagina, propriedadeCliente,
} from './notion.js';
import { abrirClientes, garantirClientes } from './clientes.js';
import { buscarSucataDevendo } from './sucata.js';
import { agora, hojeISO, log, dataBR, brl, emParalelo, salvarPlanilha } from './util.js';

function descreverRegra() {
  return `empresas ${config.empresas.join(',')} | a receber | em aberto | cliente externo | vencimento até ontem` +
    (config.diasAtrasoMaximo != null ? ` | atraso máximo ${config.diasAtrasoMaximo} dias` : '') +
    (config.tiposTitulo.length ? ` | só tipos ${config.tiposTitulo.join(',')}` : '') +
    (config.tiposTituloIgnorar.length ? ` | sem os tipos ${config.tiposTituloIgnorar.join(',')}` : '') +
    (config.parceirosIgnorar.length ? ` | sem os parceiros ${config.parceirosIgnorar.join(',')}` : '');
}

const dataCriacao = (pagina) =>
  new Date(pagina.created_time).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Decide o que fazer com um card cujo título não veio na carteira de hoje. */
function classificarSaida(s, pagina, vencNotion) {
  if (!s) return { manter: 'título não encontrado no Sankhya (excluído ou estornado?)' };
  // Card que entrou antes de vencer (carga antiga de "a vencer") e cujo vencimento, confirmado
  // na origem, é hoje ou futuro: não pertence à carteira de vencidos até ontem
  if (!s.baixado && s.vencimento && s.vencimento >= hojeISO() && (!vencNotion || vencNotion >= dataCriacao(pagina))) {
    return { remover: `vence em ${dataBR(s.vencimento)}: fora da carga de vencidos até ontem`, tipo: 'correcao' };
  }
  if (s.renegociado) {
    return { manter: `título renegociado${s.nuReneg ? ` (renegociação ${s.nuReneg})` : ''}; validar com o financeiro` };
  }
  if (s.baixado && s.nufinSaldo) {
    return { manter: `baixa parcial em ${dataBR(s.dataBaixa)}; saldo em aberto no NUFIN ${s.nufinSaldo}` };
  }
  if (s.baixado) return { remover: `baixa integral em ${dataBR(s.dataBaixa)} (${brl(s.valorBaixa)})`, tipo: 'baixa' };
  if (s.passouParaCartao) {
    return { remover: `pago no cartão: o título passou para a operadora (parceiro ${s.codparc})`, tipo: 'cartao' };
  }
  if (!s.receita) {
    return { manter: `deixou de ser título a receber do cliente (RECDESP=${s.recdesp}, parceiro ${s.codparc}); validar com o financeiro` };
  }
  if (s.naCarteira) return { manter: 'em aberto e dentro da regra, mas não veio na consulta de hoje' };

  // Em aberto e fora da carteira porque vence hoje ou depois
  if (s.vencimento && s.vencimento >= hojeISO()) {
    // Entrou no Notion antes de vencer (carga antiga de "a vencer"): sai da base
    if (!vencNotion || vencNotion >= dataCriacao(pagina)) {
      return { remover: `vence em ${dataBR(s.vencimento)}: fora da carga de vencidos até ontem`, tipo: 'correcao' };
    }
    // Já estava vencido quando entrou e o vencimento foi para frente: repactuado
    return { manter: `vencimento repactuado: ${dataBR(vencNotion)} -> ${dataBR(s.vencimento)}` };
  }
  return { manter: `em aberto, mas saiu da regra (vencimento atual ${dataBR(s.vencimento)})` };
}

function planilhaConferencia(novos, remocoes, excecoes) {
  const linhas = [[
    'Ação', 'Chave Sankhya', 'Dias de atraso', 'Empresa', 'Loja', 'Polo', 'Cliente', 'Parceiro',
    'Nota', 'Desd', 'Venc.', 'Valor', 'Valor líquido', 'Tipo de título', 'Operação', 'Vendedor', 'Histórico', 'Motivo',
  ]];
  for (const t of novos) {
    linhas.push([
      'Incluir', chaveDoTitulo(t), t.DIAS_ATRASO, t.CODEMP, LOJAS[t.CODEMP] ?? '', POLOS[t.CODEMP] ?? '',
      t.NOMEPARC, t.CODPARC, t.NUMNOTA || '', t.DESDOBRAMENTO, dataBR(t.DTVENC), t.VLRDESDOB, t.VLRLIQUIDO,
      `${t.CODTIPTIT} - ${t.DESCRTIPTIT ?? ''}`, t.CODTIPOPER, t.VENDEDOR ?? '', t.HISTORICO, '',
    ]);
  }
  for (const r of remocoes) linhas.push(['Remover', r.chave, ...Array(15).fill(''), r.motivo]);
  for (const e of excecoes) linhas.push(['Revisar', e.chave, ...Array(15).fill(''), e.motivo]);
  return salvarPlanilha('conferencia-titulos', linhas);
}

export function mostrarCard(chave, props) {
  log(`Exemplo de card (${chave}):`);
  for (const [coluna, v] of Object.entries(props)) {
    const valor = v.title?.[0]?.text.content ?? v.rich_text?.[0]?.text.content ?? v.select?.name ??
      v.status?.name ?? v.date?.start ?? v.number ?? (v.relation ? `vínculo ${v.relation[0]?.id}` : '(vazio)');
    log(`  ${coluna.padEnd(28)} ${String(valor).slice(0, 90)}`);
  }
}

export async function sincronizarTitulos({ simular = false, notion = criarClienteNotion() } = {}) {
  log(`Rotina de títulos${simular ? ' (MODO CONFERÊNCIA: nada será gravado no Notion)' : ''}`);
  log(`Regra: ${descreverRegra()}`);

  const base = await abrirBase(notion);
  log(`Notion: "${base.nome}" | ${base.colunas.length} colunas preenchidas na inclusão`);
  for (const aviso of base.avisos) log(`  aviso: ${aviso}`);
  const clientes = await abrirClientes(notion, base);
  if (clientes.aviso) log(`  aviso: vínculo com clientes desligado: ${clientes.aviso}`);
  else log(`Notion: base de clientes com ${clientes.porCodigo.size} clientes`);

  // Leituras completas antes de qualquer gravação
  const titulos = await buscarTitulosVencidos();
  const ate7 = titulos.filter((t) => t.DIAS_ATRASO <= 7).length;
  log(`Sankhya: ${titulos.length} títulos na carteira (${ate7} de 1 a 7 dias, ${titulos.length - ate7} com +7 dias)`);
  const { porChave, duplicadas } = await listarPaginas(notion, base);
  log(`Notion: ${porChave.size + duplicadas.size} chaves de títulos na base`);

  const excecoes = [];
  const excecao = (chave, motivo) => excecoes.push({ chave, motivo });
  for (const [chave, paginas] of duplicadas) {
    excecao(chave, `chave repetida em ${paginas.length} cards; nenhum deles foi alterado`);
  }
  for (const codigo of clientes.conflitos ?? []) {
    excecao(`CLIENTE:${codigo}`, 'código de parceiro repetido em mais de um cliente na base de clientes');
  }

  // Inclusões
  const naCarteira = new Map(titulos.map((t) => [chaveDoTitulo(t), t]));
  const novos = [];
  const existentes = [];
  for (const [chave, titulo] of naCarteira) {
    if (duplicadas.has(chave)) continue;
    const existente = porChave.get(chave);
    if (!existente) {
      novos.push(titulo);
      continue;
    }
    existentes.push({ chave, ...existente });
    const vencNotion = vencimentoNoNotion(base, existente.pagina);
    if (vencNotion && vencNotion !== titulo.DTVENC) {
      excecao(chave, `vencimento mudou no Sankhya: ${dataBR(vencNotion)} -> ${dataBR(titulo.DTVENC)}`);
    }
  }

  // Saídas: confere no Sankhya, pelo NUFIN, cada card que não veio na carteira
  const fora = [...porChave].filter(([chave]) => !naCarteira.has(chave));
  const situacao = fora.length > 0 ? await consultarSituacao(fora.map(([, v]) => v.id)) : new Map();
  const remocoes = [];
  const mantidosFora = [];
  for (const [chave, { id: nufin, pagina }] of fora) {
    const decisao = classificarSaida(situacao.get(nufin), pagina, vencimentoNoNotion(base, pagina));
    if (decisao.remover) remocoes.push({ chave, pagina, motivo: decisao.remover, tipo: decisao.tipo });
    else {
      excecao(chave, `${decisao.manter}; card mantido`);
      mantidosFora.push({ chave, id: nufin, pagina });
    }
  }

  // Completar cards que ficam: vínculo com cliente, vendedor e campos do Sankhya vazios
  const ficam = [...existentes, ...mantidosFora];
  const codigoDoCard = (pagina) => {
    const c = String(valorDaColuna(base, pagina, COLUNA_PARCEIRO) ?? '').trim();
    return /^\d+$/.test(c) ? c : null;
  };
  const erpIncompleto = ficam.filter(({ pagina }) =>
    CAMPOS_DO_ERP_TITULO.some((nome) => valorDaColuna(base, pagina, nome) == null) || !codigoDoCard(pagina));
  const semVinculo = clientes.aviso ? [] : ficam.filter(({ pagina }) => clientesDaPagina(base, pagina).length === 0);
  const paraBuscar = [...new Set([...erpIncompleto, ...semVinculo].map((p) => p.id))];
  const dados = paraBuscar.length > 0 ? await buscarTitulosPorNufin(paraBuscar) : new Map();

  // O cliente da pendência é o do campo Parceiro do card (o Sankhya pode trocar o parceiro do título
  // depois, ex.: garantia que vira despesa de outro parceiro); sem ele, o parceiro atual do Sankhya
  const codigoCliente = ({ id, pagina }) => codigoDoCard(pagina) ?? (dados.get(id) ? String(dados.get(id).CODPARC) : null);
  const nomeCliente = ({ id, pagina }) => valorDaColuna(base, pagina, 'Nome') ?? dados.get(id)?.NOMEPARC;

  // Vínculo com cliente de outro código: conflito para revisão (não troca sozinho)
  if (!clientes.aviso) {
    for (const { chave, pagina } of ficam) {
      const ids = clientesDaPagina(base, pagina);
      if (ids.length > 1) excecao(chave, `ligado a ${ids.length} clientes; cada pendência deve ter um só`);
      else if (ids.length === 1) {
        const vinculado = clientes.codigoDaPagina(ids[0]);
        const doCard = codigoDoCard(pagina);
        if (vinculado && doCard && vinculado !== doCard) {
          excecao(chave, `vinculado ao cliente ${vinculado}, mas o Parceiro do card é ${doCard}`);
        }
      }
    }
  }

  // Clientes: resolve todos antes de gravar qualquer pendência. Quem também deve sucata já nasce
  // com a visualização de sucata (se a consulta de sucata falhar, a rotina de sucata acrescenta depois)
  if (!clientes.aviso) {
    const comSucata = new Set(await buscarSucataDevendo().then((l) => l.map((s) => String(s.CODPARC))).catch(() => []));
    const pedidos = [
      ...novos.map((t) => ({ codigo: String(t.CODPARC), nome: t.NOMEPARC })),
      ...semVinculo.map((c) => ({ codigo: codigoCliente(c), nome: nomeCliente(c) })),
    ].filter((p) => p.codigo).map((p) => ({ ...p, sucata: comSucata.has(p.codigo) }));
    const r = await garantirClientes(notion, clientes, pedidos, { simular });
    log(`Clientes: ${r.faltavam} a criar${simular ? '' : ` | criados ${r.criados} | erros ${r.erros}`}`);
  }
  // Na conferência os clientes novos não são criados: conta o vínculo como se fossem
  const vinculo = (codparc) => (clientes.aviso || !codparc ? {}
    : propriedadeCliente(base, clientes.porCodigo.get(String(codparc)) ?? (simular ? '(cliente novo)' : null)));

  const completar = [];
  const contagem = {};
  const semVinculoIds = new Set(semVinculo.map((c) => c.id));
  for (const c of [...new Map([...erpIncompleto, ...semVinculo].map((x) => [x.id, x])).values()]) {
    const titulo = dados.get(c.id);
    const props = titulo ? camposParaCompletar(base, c.pagina, titulo, CAMPOS_DO_ERP_TITULO, COLUNA_PARCEIRO) : {};
    if (semVinculoIds.has(c.id)) Object.assign(props, vinculo(codigoCliente(c)));
    if (Object.keys(props).length === 0) continue;
    for (const nome of Object.keys(props)) contagem[nome] = (contagem[nome] ?? 0) + 1;
    completar.push({ chave: c.chave, pagina: c.pagina, props });
  }

  const semVendedor = novos.filter((t) => !t.VENDEDOR);
  log(`Plano: incluir ${novos.length} | já existentes ${existentes.length} | completar ${completar.length} ` +
    `${JSON.stringify(contagem)} | remover ${remocoes.length} ` +
    `(${remocoes.filter((r) => r.tipo === 'baixa').length} baixas, ${remocoes.filter((r) => r.tipo === 'cartao').length} pagos no cartão, ` +
    `${remocoes.filter((r) => r.tipo === 'correcao').length} a vencer/vence hoje) ` +
    `| exceções ${excecoes.length}`);
  if (semVendedor.length > 0) {
    log(`  sem vendedor identificado na origem (campo fica vazio): ${semVendedor.length} novos, ex.: ` +
      semVendedor.slice(0, 5).map(chaveDoTitulo).join(', '));
  }

  const resumo = {
    horario: agora(),
    rotina: 'títulos',
    simulacao: simular,
    consultados: titulos.length,
    incluidos: 0,
    jaExistentes: existentes.length,
    completados: 0,
    removidos: 0,
    excecoes: excecoes.length,
    erros: 0,
  };

  if (simular) {
    const exemplos = (rotulo, lista, descrever) => {
      if (lista.length === 0) return;
      log(`${rotulo} (${Math.min(15, lista.length)} de ${lista.length}):`);
      for (const item of lista.slice(0, 15)) log(`  ${descrever(item)}`);
    };
    exemplos('Seriam incluídos', novos, (t) =>
      `${chaveDoTitulo(t)} | ${t.DIAS_ATRASO} dias | empresa ${t.CODEMP} | venc ${dataBR(t.DTVENC)} | ${brl(t.VLRDESDOB)} | ${t.VENDEDOR ?? '(sem vendedor)'}`);
    exemplos('Seriam completados', completar, (c) => `${c.chave} | ${Object.keys(c.props).join(', ')}`);
    exemplos('Seriam removidos', remocoes, (r) => `${r.chave} | ${r.motivo}`);
    const cards = novos.map((t) => montarPropriedades(base, t));
    if (cards[0]) mostrarCard(chaveDoTitulo(novos[0]), cards[0]);
    log(`Planilha da conferência: ${await planilhaConferencia(novos, remocoes, excecoes)}`);
  } else {
    await emParalelo(novos, async (titulo) => {
      try {
        const pagina = await criarPagina(notion, base, titulo, vinculo(titulo.CODPARC));
        resumo.incluidos++;
        log(`  incluído ${chaveDoTitulo(titulo)} -> página ${pagina.id}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao incluir ${chaveDoTitulo(titulo)}: ${erro.message}`);
      }
    });

    await emParalelo(completar, async ({ chave, pagina, props }) => {
      try {
        await atualizarPagina(notion, pagina, props);
        resumo.completados++;
        log(`  completado ${chave} (página ${pagina.id}): ${Object.keys(props).join(', ')}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao completar ${chave} (página ${pagina.id}): ${erro.message}`);
      }
    });

    await emParalelo(remocoes, async ({ chave, pagina, motivo }) => {
      try {
        await excluirPagina(notion, pagina);
        resumo.removidos++;
        log(`  removido ${chave} (página ${pagina.id}): ${motivo}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao remover ${chave} (página ${pagina.id}): ${erro.message}`);
      }
    });
  }

  for (const aviso of base.avisosDeOpcao) log(`  aviso: ${aviso}`);
  if (excecoes.length > 0) {
    log(`Exceções para revisão (${excecoes.length}):`);
    for (const { chave, motivo } of excecoes) log(`  ${chave} | ${motivo}`);
  }

  log(`Resumo: ${JSON.stringify(resumo)}`);
  return resumo;
}

// Nome antigo, usado pelos testes
export const sincronizar = sincronizarTitulos;
