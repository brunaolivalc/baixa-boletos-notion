/**
 * Rotina diária de TÍTULOS: Sankhya -> base "Posição de Cobrança" no Notion.
 *
 * 1. Lê a carteira inteira no Sankhya: a receber, em aberto, cliente externo, empresas 1 a 9,
 *    tudo que vence até hoje + DIAS_A_VENCER (a vencer e vencidos). O Notion separa as visões
 *    sozinho pela "Faixa de vencimento". Se a leitura falhar, para sem mexer no Notion.
 * 2. Lê todos os cards de títulos do Notion (Chave Sankhya = TIT:<NUFIN>).
 * 3. Chave nova -> cria o card (Em aberto / A tratar + cabeçalho "Histórico de tratativas").
 *    Chave que já existe -> não altera nada (fotografia da inclusão).
 * 4. Card cujo título saiu da carteira -> confere o NUFIN no Sankhya:
 *    - baixa integral confirmada: manda o card para a lixeira;
 *    - baixa parcial, renegociação, título não encontrado ou vencimento alterado:
 *      mantém o card e registra a exceção para revisão.
 */
import { config } from './config.js';
import { chaveDoTitulo, LOJAS, POLOS } from './campos.js';
import { buscarTitulosVencidos, consultarSituacao } from './titulos.js';
import {
  criarClienteNotion, abrirBase, listarPaginas, vencimentoNoNotion,
  montarPropriedades, criarPagina, excluirPagina,
} from './notion.js';
import { agora, log, dataBR, brl, emParalelo, salvarPlanilha } from './util.js';

function descreverRegra() {
  const prazo = config.diasAVencer > 0
    ? `vencidos e a vencer até ${config.diasAVencer} dias`
    : `vencidos há mais de ${config.diasAtraso} dias`;
  return `empresas ${config.empresas.join(',')} | a receber | em aberto | cliente externo | ${prazo}` +
    (config.diasAtrasoMaximo != null ? ` | atraso máximo ${config.diasAtrasoMaximo} dias` : '') +
    (config.tiposTitulo.length ? ` | só tipos ${config.tiposTitulo.join(',')}` : '') +
    (config.tiposTituloIgnorar.length ? ` | sem os tipos ${config.tiposTituloIgnorar.join(',')}` : '') +
    (config.parceirosIgnorar.length ? ` | sem os parceiros ${config.parceirosIgnorar.join(',')}` : '');
}

/** Decide o que fazer com um card cujo título não veio na carteira de hoje. */
function classificarSaida(s) {
  if (!s) return { manter: 'título não encontrado no Sankhya (excluído ou estornado?)' };
  if (s.renegociado) {
    return { manter: `título renegociado${s.nuReneg ? ` (renegociação ${s.nuReneg})` : ''}; validar com o financeiro` };
  }
  if (s.baixado && s.nufinSaldo) {
    return { manter: `baixa parcial em ${dataBR(s.dataBaixa)}; saldo em aberto no NUFIN ${s.nufinSaldo}` };
  }
  if (s.baixado) return { remover: `baixa integral em ${dataBR(s.dataBaixa)} (${brl(s.valorBaixa)})` };
  if (s.naCarteira) return { manter: 'em aberto e dentro da regra, mas não veio na consulta de hoje' };
  return { manter: `em aberto, mas saiu da regra (vencimento atual ${dataBR(s.vencimento)})` };
}

function faixa(diasAtraso) {
  if (diasAtraso < 0) return 'A vencer';
  if (diasAtraso === 0) return 'Vence hoje';
  if (diasAtraso <= 7) return 'Vencido até 7 dias';
  return 'Vencido há mais de 7 dias';
}

function planilhaConferencia(novos, remocoes, excecoes) {
  const linhas = [[
    'Ação', 'Chave Sankhya', 'Faixa', 'Código da empresa', 'Loja', 'Polo', 'Cliente', 'Código do parceiro',
    'Nro Nota', 'Desdobramento', 'Vencimento', 'Dias de atraso', 'Valor do desdobramento',
    'Valor líquido', 'Tipo de título', 'Código de operação', 'Histórico', 'Motivo',
  ]];
  for (const t of novos) {
    linhas.push([
      'Incluir', chaveDoTitulo(t), faixa(t.DIAS_ATRASO), t.CODEMP, LOJAS[t.CODEMP] ?? '', POLOS[t.CODEMP] ?? '',
      t.NOMEPARC, t.CODPARC, t.NUMNOTA || '', t.DESDOBRAMENTO, dataBR(t.DTVENC), t.DIAS_ATRASO,
      t.VLRDESDOB, t.VLRLIQUIDO, `${t.CODTIPTIT} - ${t.DESCRTIPTIT ?? ''}`, t.CODTIPOPER, t.HISTORICO, '',
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
      v.status?.name ?? v.date?.start ?? v.number ?? '(vazio)';
    log(`  ${coluna.padEnd(28)} ${String(valor).slice(0, 90)}`);
  }
}

export async function sincronizarTitulos({ simular = false, notion = criarClienteNotion() } = {}) {
  log(`Rotina de títulos${simular ? ' (MODO CONFERÊNCIA: nada será gravado no Notion)' : ''}`);
  log(`Regra: ${descreverRegra()}`);

  const base = await abrirBase(notion);
  log(`Notion: "${base.nome}" | ${base.colunas.length} colunas preenchidas na inclusão`);
  for (const aviso of base.avisos) log(`  aviso: ${aviso}`);

  // Leituras completas antes de qualquer gravação
  const titulos = await buscarTitulosVencidos();
  const porFaixa = {};
  for (const t of titulos) porFaixa[faixa(t.DIAS_ATRASO)] = (porFaixa[faixa(t.DIAS_ATRASO)] ?? 0) + 1;
  log(`Sankhya: ${titulos.length} títulos na carteira ${JSON.stringify(porFaixa)}`);
  const { porChave, duplicadas } = await listarPaginas(notion, base);
  log(`Notion: ${porChave.size + duplicadas.size} chaves de títulos na base`);

  const excecoes = [];
  const excecao = (chave, motivo) => excecoes.push({ chave, motivo });
  for (const [chave, paginas] of duplicadas) {
    excecao(chave, `chave repetida em ${paginas.length} cards; nenhum deles foi alterado`);
  }

  // Inclusões
  const naCarteira = new Map(titulos.map((t) => [chaveDoTitulo(t), t]));
  const novos = [];
  let jaExistentes = 0;
  for (const [chave, titulo] of naCarteira) {
    if (duplicadas.has(chave)) continue;
    const existente = porChave.get(chave);
    if (!existente) {
      novos.push(titulo);
      continue;
    }
    jaExistentes++;
    const vencNotion = vencimentoNoNotion(base, existente.pagina);
    if (vencNotion && vencNotion !== titulo.DTVENC) {
      excecao(chave, `vencimento mudou no Sankhya: ${dataBR(vencNotion)} -> ${dataBR(titulo.DTVENC)}`);
    }
  }

  // Saídas: confere no Sankhya, pelo NUFIN, cada card que não veio na carteira
  const fora = [...porChave].filter(([chave]) => !naCarteira.has(chave));
  const situacao = fora.length > 0 ? await consultarSituacao(fora.map(([, v]) => v.id)) : new Map();
  const remocoes = [];
  for (const [chave, { id: nufin, pagina }] of fora) {
    const decisao = classificarSaida(situacao.get(nufin));
    if (decisao.remover) remocoes.push({ chave, pagina, motivo: decisao.remover });
    else excecao(chave, `${decisao.manter}; card mantido`);
  }

  log(`Plano: incluir ${novos.length} | já existentes ${jaExistentes} | remover ${remocoes.length} | exceções ${excecoes.length}`);

  const resumo = {
    horario: agora(),
    rotina: 'títulos',
    simulacao: simular,
    consultados: titulos.length,
    incluidos: 0,
    jaExistentes,
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
      `${chaveDoTitulo(t)} | ${faixa(t.DIAS_ATRASO)} | empresa ${t.CODEMP} | venc ${dataBR(t.DTVENC)} | ${brl(t.VLRDESDOB)} | ${t.DESCRTIPTIT ?? ''}`);
    exemplos('Seriam removidos', remocoes, (r) => `${r.chave} | ${r.motivo}`);

    // Monta os cards sem gravar, para conferir as opções das colunas de seleção
    const cards = novos.map((t) => montarPropriedades(base, t));
    if (cards[0]) mostrarCard(chaveDoTitulo(novos[0]), cards[0]);
    log(`Planilha da conferência: ${await planilhaConferencia(novos, remocoes, excecoes)}`);
  } else {
    await emParalelo(novos, async (titulo) => {
      try {
        const pagina = await criarPagina(notion, base, titulo);
        resumo.incluidos++;
        log(`  incluído ${chaveDoTitulo(titulo)} -> página ${pagina.id}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao incluir ${chaveDoTitulo(titulo)}: ${erro.message}`);
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
