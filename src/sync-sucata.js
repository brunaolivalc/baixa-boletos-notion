/**
 * Rotina diária de SUCATA: Sankhya -> base "Posição de Cobrança" no Notion.
 *
 * 1. Calcula no Sankhya o saldo de sucata de todos os clientes (SQL oficial SALDO_SUCATA_GRUPO).
 *    Entra quem deve mais que SUCATA_SALDO_MINIMO_KG, é cliente externo e cuja loja é de 1 a 9.
 * 2. Lê todos os cards de sucata do Notion, inclusive os encerrados (Chave Sankhya = SUC:<CODPARC>).
 * 3. Chave nova -> garante o cliente e cria o card já com o vínculo (Em aberto / A tratar +
 *    cabeçalho "Histórico de tratativas").
 *    Card em aberto -> não altera nada (fotografia da inclusão); só completa o que estiver vazio.
 *    Card encerrado que voltou a dever -> reabre a mesma página com o novo saldo.
 * 4. Card em aberto cujo cliente saiu da lista -> confere o saldo no Sankhya:
 *    - saldo zerado ou positivo: Encerrada / Sucata regularizada / data de hoje (vai para o Histórico);
 *    - ainda negativo: mantém o card em aberto;
 *    - sem movimento de sucata: mantém e registra exceção.
 */
import { config } from './config.js';
import {
  CAMPOS_SUCATA, CAMPOS_DO_ERP_SUCATA, PREFIXO_SUCATA, chaveDaSucata, COLUNA_PARCEIRO,
  SUCATA_ENCERRAMENTO as COL, LOJAS, POLOS,
} from './campos.js';
import { buscarSucataDevendo, consultarSaldosSucata } from './sucata.js';
import {
  criarClienteNotion, abrirBase, listarPaginas, montarPropriedades, valorDaColuna,
  criarPagina, atualizarPagina, propriedadesAvulsas, camposParaCompletar, clientesDaPagina, propriedadeCliente,
} from './notion.js';
import { abrirClientes, garantirClientes } from './clientes.js';
import { agora, hojeISO, log, kg, emParalelo, salvarPlanilha } from './util.js';
import { mostrarCard } from './sync.js';

const ENCERRADA = 'encerrada';
const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function planilhaConferencia(novos, reaberturas, encerramentos, excecoes) {
  const linhas = [['Ação', 'Chave Sankhya', 'Empresa', 'Loja', 'Polo', 'Cliente', 'Parceiro',
    'Localidade', 'Saldo Sucata', 'Dias no negativo', 'Motivo']];
  const linha = (acao, s, motivo = '') => [acao, chaveDaSucata(s), s.CODEMP, LOJAS[s.CODEMP] ?? '', POLOS[s.CODEMP] ?? '',
    s.NOMEPARC, s.CODPARC, s.LOCALIDADE, s.SALDO_KG, s.DIAS_NEGATIVO, motivo];
  for (const s of novos) linhas.push(linha('Incluir', s));
  for (const r of reaberturas) linhas.push(linha('Reabrir', r.sucata, 'voltou a dever'));
  for (const e of encerramentos) linhas.push(['Encerrar', e.chave, ...Array(8).fill(''), e.motivo]);
  for (const e of excecoes) linhas.push(['Revisar', e.chave, ...Array(8).fill(''), e.motivo]);
  return salvarPlanilha('conferencia-sucata', linhas);
}

export async function sincronizarSucata({ simular = false, notion = criarClienteNotion() } = {}) {
  log(`Rotina de sucata${simular ? ' (MODO CONFERÊNCIA: nada será gravado no Notion)' : ''}`);
  log(`Regra: lojas ${config.empresas.join(',')} | cliente externo | devendo mais de ${config.sucataSaldoMinimoKg} kg de sucata`);

  const base = await abrirBase(notion, CAMPOS_SUCATA);
  log(`Notion: "${base.nome}" | ${base.colunas.length} colunas preenchidas na inclusão`);
  for (const aviso of base.avisos) log(`  aviso: ${aviso}`);
  const clientes = await abrirClientes(notion, base);
  if (clientes.aviso) log(`  aviso: vínculo com clientes desligado: ${clientes.aviso}`);

  // Leituras completas antes de qualquer gravação
  const devendo = await buscarSucataDevendo();
  log(`Sankhya: ${devendo.length} clientes devendo sucata`);
  const { porChave, duplicadas } = await listarPaginas(notion, base, PREFIXO_SUCATA);
  const situacao = (pagina) => normal(valorDaColuna(base, pagina, COL.situacao));
  const abertos = [...porChave.values()].filter((v) => situacao(v.pagina) !== ENCERRADA).length;
  log(`Notion: ${porChave.size + duplicadas.size} cards de sucata (${abertos} em aberto)`);

  const excecoes = [];
  const excecao = (chave, motivo) => excecoes.push({ chave, motivo });
  for (const [chave, paginas] of duplicadas) {
    excecao(chave, `chave repetida em ${paginas.length} cards; nenhum deles foi alterado`);
  }

  // Inclusões e reaberturas
  const naLista = new Map(devendo.map((s) => [chaveDaSucata(s), s]));
  const novos = [];
  const reaberturas = [];
  const abertosNaLista = [];
  for (const [chave, sucata] of naLista) {
    if (duplicadas.has(chave)) continue;
    const existente = porChave.get(chave);
    if (!existente) novos.push(sucata);
    else if (situacao(existente.pagina) === ENCERRADA) reaberturas.push({ chave, pagina: existente.pagina, sucata });
    else abertosNaLista.push({ chave, ...existente, sucata });
  }

  // Encerramentos: confere no Sankhya o saldo de cada card em aberto que saiu da lista
  const fora = [...porChave].filter(([chave, v]) => !naLista.has(chave) && situacao(v.pagina) !== ENCERRADA);
  const saldos = fora.length > 0 ? await consultarSaldosSucata(fora.map(([, v]) => v.id)) : new Map();
  const encerramentos = [];
  const abertosFora = [];
  for (const [chave, { id, pagina }] of fora) {
    const s = saldos.get(id);
    if (!s) excecao(chave, 'cliente sem movimento de sucata no Sankhya; card mantido');
    else if (s.SALDO_KG >= 0) encerramentos.push({ chave, pagina, motivo: `sucata regularizada (saldo atual ${kg(s.SALDO_KG)})` });
    else abertosFora.push({ chave, id, pagina, sucata: s }); // ainda devendo, abaixo do limite ou em outra loja
  }
  const jaExistentes = abertosNaLista.length + abertosFora.length;

  // Clientes: resolve todos antes de gravar. Quem tem sucata nova, reaberta ou vinculada agora
  // ganha também a visualização de sucata na página do cliente
  if (!clientes.aviso) {
    const semVinculo = [...abertosNaLista, ...abertosFora].filter((a) => clientesDaPagina(base, a.pagina).length === 0);
    const comSucataNova = [...novos, ...reaberturas.map((r) => r.sucata), ...semVinculo.map((a) => a.sucata)];
    const pedidos = [...comSucataNova, ...abertosNaLista.map((a) => a.sucata), ...abertosFora.map((a) => a.sucata)]
      .map((s) => ({ codigo: s.CODPARC, nome: s.NOMEPARC, sucata: true }));
    const r = await garantirClientes(notion, clientes, pedidos, {
      simular,
      sucataGarantir: comSucataNova.map((s) => s.CODPARC),
    });
    log(`Clientes: ${r.faltavam} a criar${simular ? '' : ` | criados ${r.criados} | visualizações de sucata acrescentadas ${r.visoesSucata} | erros ${r.erros}`}`);
  }
  // Na conferência os clientes novos não são criados: conta o vínculo como se fossem
  const vinculo = (codparc) => (clientes.aviso ? {}
    : propriedadeCliente(base, clientes.porCodigo.get(String(codparc)) ?? (simular ? '(cliente novo)' : null)));

  // Completar cards abertos: vínculo com cliente e campos do Sankhya vazios
  const completar = [];
  for (const { chave, pagina, sucata } of [...abertosNaLista, ...abertosFora]) {
    const props = camposParaCompletar(base, pagina, sucata, CAMPOS_DO_ERP_SUCATA, COLUNA_PARCEIRO);
    if (!clientes.aviso && clientesDaPagina(base, pagina).length === 0) Object.assign(props, vinculo(sucata.CODPARC));
    if (Object.keys(props).length > 0) completar.push({ chave, pagina, props });
  }

  log(`Plano: incluir ${novos.length} | já existentes ${jaExistentes} | completar ${completar.length} | ` +
    `reabrir ${reaberturas.length} | encerrar ${encerramentos.length} | exceções ${excecoes.length}`);

  const resumo = {
    horario: agora(),
    rotina: 'sucata',
    simulacao: simular,
    consultados: devendo.length,
    incluidos: 0,
    jaExistentes,
    completados: 0,
    reabertos: 0,
    encerrados: 0,
    excecoes: excecoes.length,
    erros: 0,
  };

  const propsEncerrar = () => propriedadesAvulsas(base, {
    [COL.situacao]: 'Encerrada',
    [COL.motivo]: 'Sucata regularizada',
    [COL.data]: hojeISO(),
  });
  const propsReabrir = (pagina, s) => ({
    ...propriedadesAvulsas(base, {
      [COL.situacao]: 'Em aberto',
      [COL.andamento]: 'A tratar',
      [COL.motivo]: null,
      [COL.data]: null,
      [COL.saldo]: s.SALDO_KG,
      [COL.dias]: s.DIAS_NEGATIVO,
    }),
    ...(!clientes.aviso && clientesDaPagina(base, pagina).length === 0 ? vinculo(s.CODPARC) : {}),
  });

  if (simular) {
    const exemplos = (rotulo, lista, descrever) => {
      if (lista.length === 0) return;
      log(`${rotulo} (${Math.min(15, lista.length)} de ${lista.length}):`);
      for (const item of lista.slice(0, 15)) log(`  ${descrever(item)}`);
    };
    exemplos('Seriam incluídos', novos, (s) =>
      `${chaveDaSucata(s)} | loja ${s.CODEMP} | ${s.LOCALIDADE ?? ''} | ${kg(s.SALDO_KG)} | ${s.DIAS_NEGATIVO} dias no negativo`);
    exemplos('Seriam completados', completar, (c) => `${c.chave} | ${Object.keys(c.props).join(', ')}`);
    exemplos('Seriam reabertos', reaberturas, (r) => `${r.chave} | ${kg(r.sucata.SALDO_KG)}`);
    exemplos('Seriam encerrados', encerramentos, (e) => `${e.chave} | ${e.motivo}`);

    const cards = novos.map((s) => montarPropriedades(base, s));
    propsEncerrar();
    if (cards[0]) mostrarCard(chaveDaSucata(novos[0]), cards[0]);
    log(`Planilha da conferência: ${await planilhaConferencia(novos, reaberturas, encerramentos, excecoes)}`);
  } else {
    await emParalelo(novos, async (sucata) => {
      try {
        const pagina = await criarPagina(notion, base, sucata, vinculo(sucata.CODPARC));
        resumo.incluidos++;
        log(`  incluído ${chaveDaSucata(sucata)} -> página ${pagina.id}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao incluir ${chaveDaSucata(sucata)}: ${erro.message}`);
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

    await emParalelo(reaberturas, async ({ chave, pagina, sucata }) => {
      try {
        await atualizarPagina(notion, pagina, propsReabrir(pagina, sucata));
        resumo.reabertos++;
        log(`  reaberto ${chave} (página ${pagina.id}): voltou a dever ${kg(sucata.SALDO_KG)}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao reabrir ${chave} (página ${pagina.id}): ${erro.message}`);
      }
    });

    await emParalelo(encerramentos, async ({ chave, pagina, motivo }) => {
      try {
        await atualizarPagina(notion, pagina, propsEncerrar());
        resumo.encerrados++;
        log(`  encerrado ${chave} (página ${pagina.id}): ${motivo}`);
      } catch (erro) {
        resumo.erros++;
        log(`  ERRO ao encerrar ${chave} (página ${pagina.id}): ${erro.message}`);
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
