/**
 * Consultas dos títulos a receber no Sankhya (tabela TGFFIN).
 */
import { config } from './config.js';
import { consultarSQL } from './sankhya.js';
import { hojeISO } from './util.js';

// A API de SQL do Sankhya devolve no máximo 5000 linhas por chamada; busca em blocos menores
const TAMANHO_BLOCO = 2000;

// "Hoje" sempre pela data civil de Brasília
const HOJE = () => `TO_DATE('${hojeISO()}', 'YYYY-MM-DD')`;

// Vendedores que não são vendedores de verdade: marcam envio para assessoria/advogado ou ausência
const VENDEDOR_VALIDO = (v) => `(${v}.CODVEND <> 0
    AND UPPER(${v}.APELIDO) NOT LIKE 'UNINOVA%'
    AND UPPER(${v}.APELIDO) NOT LIKE 'CONSULTH%'
    AND UPPER(${v}.APELIDO) NOT LIKE 'ADVOGADO%'
    AND UPPER(${v}.APELIDO) NOT LIKE '<SEM%')`;

const COLUNAS = () => `
  FIN.NUFIN,
  FIN.CODEMP,
  EMP.NOMEFANTASIA AS NOMEEMPRESA,
  FIN.NUMNOTA,
  FIN.DESDOBRAMENTO,
  FIN.CODPARC,
  PAR.NOMEPARC,
  PAR.RAZAOSOCIAL,
  TO_CHAR(FIN.DTVENC, 'YYYY-MM-DD') AS DTVENC,
  FIN.VLRDESDOB,
  NVL(FIN.VLRDESDOB, 0) + NVL(FIN.VLRJURO, 0) + NVL(FIN.VLRMULTA, 0) + NVL(FIN.DESPCART, 0)
    + NVL(FIN.VLRVENDOR, 0) - NVL(FIN.VLRDESC, 0) - NVL(FIN.VLRIRF, 0) - NVL(FIN.VLRISS, 0)
    - NVL(FIN.VLRINSS, 0) AS VLRLIQUIDO,
  FIN.CODTIPOPER,
  FIN.CODTIPTIT,
  TIT.DESCRTIPTIT,
  FIN.HISTORICO,
  /* Vendedor da operação de origem: o da nota; sem nota, o do financeiro */
  CASE
    WHEN VN.CODVEND IS NOT NULL AND ${VENDEDOR_VALIDO('VN')} THEN VN.APELIDO
    WHEN VF.CODVEND IS NOT NULL AND ${VENDEDOR_VALIDO('VF')} THEN VF.APELIDO
  END AS VENDEDOR,
  ${HOJE()} - TRUNC(FIN.DTVENC) AS DIAS_ATRASO`;

const JUNCOES = `
  FROM TGFFIN FIN
  LEFT JOIN TGFPAR PAR ON PAR.CODPARC = FIN.CODPARC
  LEFT JOIN TSIEMP EMP ON EMP.CODEMP = FIN.CODEMP
  LEFT JOIN TGFTIT TIT ON TIT.CODTIPTIT = FIN.CODTIPTIT
  LEFT JOIN TGFCAB CAB ON CAB.NUNOTA = FIN.NUNOTA
  LEFT JOIN TGFVEN VN ON VN.CODVEND = CAB.CODVEND
  LEFT JOIN TGFVEN VF ON VF.CODVEND = FIN.CODVEND`;

function inteiros(lista) {
  const nums = lista.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length === 0) throw new Error('Lista de códigos vazia');
  return nums.join(',');
}

/**
 * Regra da carteira: receita a receber, em aberto, não é provisão, empresa da lista,
 * cliente externo (o parceiro não é uma das empresas do grupo) e vencimento até ontem.
 * O Notion separa sozinho, pela "Faixa de vencimento", os vencidos de 1 a 7 dias e os de +7 dias.
 * Títulos renegociados saem sozinhos: o Sankhya tira o original da carteira a receber.
 */
function regraCarteira() {
  const partes = [
    'FIN.RECDESP = 1',
    'FIN.DHBAIXA IS NULL',
    "NVL(FIN.PROVISAO, 'N') = 'N'",
    `FIN.CODEMP IN (${inteiros(config.empresas)})`,
    'FIN.CODPARC NOT IN (SELECT E.CODPARC FROM TSIEMP E WHERE E.CODPARC IS NOT NULL)',
    `TRUNC(FIN.DTVENC) < ${HOJE()}`,
  ];
  if (config.diasAtrasoMaximo != null) {
    partes.push(`TRUNC(FIN.DTVENC) >= ${HOJE()} - ${Number(config.diasAtrasoMaximo)}`);
  }
  if (config.tiposTitulo.length > 0) {
    partes.push(`NVL(FIN.CODTIPTIT, 0) IN (${config.tiposTitulo.map(Number).join(',')})`);
  }
  if (config.tiposTituloIgnorar.length > 0) {
    partes.push(`NVL(FIN.CODTIPTIT, 0) NOT IN (${config.tiposTituloIgnorar.map(Number).join(',')})`);
  }
  if (config.parceirosIgnorar.length > 0) {
    partes.push(`FIN.CODPARC NOT IN (${inteiros(config.parceirosIgnorar)})`);
  }
  return partes.join('\n    AND ');
}

const numero = (v) => (v == null ? null : Number(v));

function normalizar(linha) {
  return {
    ...linha,
    NUFIN: Number(linha.NUFIN),
    CODEMP: numero(linha.CODEMP),
    CODPARC: numero(linha.CODPARC),
    NUMNOTA: numero(linha.NUMNOTA),
    CODTIPOPER: numero(linha.CODTIPOPER),
    CODTIPTIT: numero(linha.CODTIPTIT),
    VLRDESDOB: numero(linha.VLRDESDOB),
    VLRLIQUIDO: linha.VLRLIQUIDO == null ? null : Math.round(Number(linha.VLRLIQUIDO) * 100) / 100,
    DIAS_ATRASO: numero(linha.DIAS_ATRASO),
    VENDEDOR: linha.VENDEDOR ? String(linha.VENDEDOR).trim() : null,
  };
}

/**
 * Todos os títulos da carteira de hoje. Lê todos os blocos até o fim;
 * se qualquer bloco falhar, lança erro (e a sincronização não remove nada).
 */
export async function buscarTitulosVencidos() {
  const titulos = [];
  let ultimoNufin = 0;

  for (;;) {
    const linhas = await consultarSQL(`
      SELECT * FROM (
        SELECT ${COLUNAS()}
        ${JUNCOES}
        WHERE ${regraCarteira()}
          AND FIN.NUFIN > ${ultimoNufin}
        ORDER BY FIN.NUFIN
      ) WHERE ROWNUM <= ${TAMANHO_BLOCO}`);

    titulos.push(...linhas.map(normalizar));
    if (linhas.length < TAMANHO_BLOCO) break;
    ultimoNufin = titulos[titulos.length - 1].NUFIN;
  }

  return titulos;
}

/** Dados atuais de títulos específicos, estejam ou não na carteira (para completar cards). */
export async function buscarTitulosPorNufin(nufins) {
  const porNufin = new Map();
  const unicos = [...new Set(nufins)];
  for (let i = 0; i < unicos.length; i += 500) {
    const linhas = await consultarSQL(`
      SELECT ${COLUNAS()}
      ${JUNCOES}
      WHERE FIN.NUFIN IN (${inteiros(unicos.slice(i, i + 500))})`);
    for (const l of linhas.map(normalizar)) porNufin.set(l.NUFIN, l);
  }
  return porNufin;
}

/**
 * Situação atual, pelo NUFIN, dos títulos que estão no Notion mas não vieram na carteira.
 * Devolve um Map NUFIN -> situação. NUFIN ausente no Map = título não existe mais no Sankhya.
 *
 * Baixa parcial: o Sankhya baixa o título original com o valor pago e cria outro título,
 * do mesmo parceiro, mesma nota e mesmo vencimento, com o saldo. NUFIN_SALDO aponta para ele.
 */
export async function consultarSituacao(nufins) {
  const situacao = new Map();
  const unicos = [...new Set(nufins)];

  // Oracle aceita no máximo 1000 itens num IN
  for (let i = 0; i < unicos.length; i += 500) {
    const bloco = unicos.slice(i, i + 500);
    const linhas = await consultarSQL(`
      SELECT
        FIN.NUFIN,
        FIN.RECDESP,
        FIN.CODPARC,
        FIN.AD_CODPARCORI,
        FIN.NURENEG,
        TO_CHAR(FIN.DHBAIXA, 'YYYY-MM-DD') AS DHBAIXA,
        TO_CHAR(FIN.DTVENC, 'YYYY-MM-DD') AS DTVENC,
        FIN.VLRDESDOB,
        FIN.VLRBAIXA,
        CASE WHEN EXISTS (SELECT 1 FROM TGFREN R WHERE R.NUFIN = FIN.NUFIN) THEN 'S' ELSE 'N' END AS RENEGOCIADO,
        (SELECT MIN(F2.NUFIN) FROM TGFFIN F2
          WHERE F2.CODPARC = FIN.CODPARC AND F2.CODEMP = FIN.CODEMP
            AND F2.NUMNOTA = FIN.NUMNOTA AND F2.DTVENC = FIN.DTVENC
            AND F2.NUFIN > FIN.NUFIN AND F2.RECDESP = 1 AND F2.DHBAIXA IS NULL
            AND (FIN.NUMNOTA <> 0 OR (F2.DESDOBRAMENTO = FIN.DESDOBRAMENTO AND F2.CODTIPOPER = FIN.CODTIPOPER))
        ) AS NUFIN_SALDO,
        CASE WHEN ${regraCarteira()} THEN 'S' ELSE 'N' END AS NA_CARTEIRA
      FROM TGFFIN FIN
      WHERE FIN.NUFIN IN (${inteiros(bloco)})`);

    for (const l of linhas) {
      situacao.set(Number(l.NUFIN), {
        receita: Number(l.RECDESP) === 1,
        recdesp: numero(l.RECDESP),
        codparc: numero(l.CODPARC),
        // Pagamento no cartão: o Sankhya passa o título para a operadora e guarda o cliente em AD_CODPARCORI
        passouParaCartao: l.AD_CODPARCORI != null && Number(l.AD_CODPARCORI) !== Number(l.CODPARC)
          && config.parceirosIgnorar.includes(Number(l.CODPARC)),
        baixado: l.DHBAIXA != null,
        dataBaixa: l.DHBAIXA,
        vencimento: l.DTVENC,
        valor: numero(l.VLRDESDOB),
        valorBaixa: numero(l.VLRBAIXA),
        renegociado: l.RENEGOCIADO === 'S',
        nuReneg: numero(l.NURENEG),
        nufinSaldo: numero(l.NUFIN_SALDO),
        naCarteira: l.NA_CARTEIRA === 'S',
      });
    }
  }

  return situacao;
}
