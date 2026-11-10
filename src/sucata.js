/**
 * Saldo de sucata dos clientes no Sankhya.
 *
 * É a SQL oficial SALDO_SUCATA_GRUPO (lc-forca-vendas/src/server/actions/cotacao-vendedor.ts,
 * sqlSucataSaldo), adaptada para calcular todos os clientes de uma vez.
 * Matriz e filiais somam juntas (grupo = CODPARCMATRIZ ou o próprio CODPARC).
 * Saldo negativo = o cliente deve sucata (kg). Se a regra mudar lá, mudar aqui.
 */
import { config } from './config.js';
import { consultarSQL } from './sankhya.js';

function inteiros(lista) {
  const nums = lista.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length === 0) throw new Error('Lista de códigos vazia');
  return nums.join(',');
}

function sqlSaldos(filtroGrupos = '') {
  const PARC = `JOIN PARC PA ON PA.CODPARC`;
  const ITENS = `FROM TGFCAB CAB JOIN TGFITE ITE ON ITE.NUNOTA=CAB.NUNOTA JOIN TGFPRO PRO ON PRO.CODPROD=ITE.CODPROD`;
  return `
WITH PARC AS (
  SELECT P.CODPARC, NVL(NULLIF(P.CODPARCMATRIZ,0), P.CODPARC) AS CODGRUPO
  FROM TGFPAR P WHERE P.CLIENTE='S' ${filtroGrupos}
),
MOV AS (
  /* Faturamento — negativo */
  SELECT PA.CODGRUPO, CAB.CODEMP, CAB.DTNEG AS DT,
    ROUND(CASE WHEN CAB.AD_BASETROCA='S' THEN (ITE.QTDNEG*PRO.PESOLIQ) ELSE 0 END,2)*-1 AS SKG
  ${ITENS} ${PARC} = CAB.CODPARC
  WHERE CAB.STATUSNFE='A' AND CAB.CODTIPOPER IN(1101,1102,1107,3005)
  UNION ALL
  /* Devoluções de venda — positivo */
  SELECT PA.CODGRUPO, CAB.CODEMP, CAB.DTNEG,
    ROUND(CASE WHEN CAB.AD_BASETROCA='S' THEN (ITE.QTDNEG*PRO.PESOLIQ) ELSE 0 END,2)
  ${ITENS} ${PARC} = CAB.CODPARC
  WHERE ((CAB.CODTIPOPER=1201 AND CAB.STATUSNFE='A') OR (CAB.CODTIPOPER=1202 AND CAB.STATUSNOTA='L'))
  UNION ALL
  /* Entradas / recolhas / saldo inicial — positivo (em kg) */
  SELECT PA.CODGRUPO, CAB.CODEMP, CAB.DTNEG, ROUND(ITE.QTDNEG,2)
  ${ITENS} ${PARC} = CAB.CODPARC
  WHERE CAB.STATUSNOTA='L' AND CAB.CODTIPOPER IN(3001,3002,3009)
  UNION ALL
  /* Transferências TOP 1150 — negativo */
  SELECT PA.CODGRUPO, CAB.CODEMP, CAB.DTNEG, ROUND(ITE.QTDNEG*PRO.PESOLIQ,2)*-1
  ${ITENS} ${PARC} = CAB.CODPARC
  WHERE CAB.STATUSNOTA='L' AND CAB.CODTIPOPER IN(1150)
  UNION ALL
  /* Financeiro não rateado — cartão ÷5,5 */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG, ROUND((FIN.VLRDESDOB*FIN.RECDESP)/5.5,2)
  FROM TGFFIN FIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N'
    AND NVL(FIN.RATEADO,'N')='N' AND FIN.CODTIPOPER IN(3003) AND FIN.CODIGOBARRA IS NULL
  UNION ALL
  /* Financeiro não rateado — boleto ÷6,3 */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG, ROUND((FIN.VLRDESDOB*FIN.RECDESP)/6.3,2)
  FROM TGFFIN FIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N'
    AND NVL(FIN.RATEADO,'N')='N' AND FIN.CODTIPOPER IN(3003) AND FIN.CODIGOBARRA IS NOT NULL
  UNION ALL
  /* Financeiro pagamento de sucata — débito */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG,
    ROUND((FIN.VLRDESDOB*FIN.RECDESP)/(FIN.VLRDESDOB/NULLIF(FIN.AD_QTDKG,0)),2)
  FROM TGFFIN FIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=-1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N'
    AND FIN.RATEADO='N' AND FIN.CODTIPOPER IN(3003) AND FIN.CODIGOBARRA IS NULL
  UNION ALL
  /* Financeiro rateado — cartão ÷5,5 */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG, ROUND((FIN.VLRDESDOB*FIN.RECDESP*RAT.PERCRATEIO/100)/5.5,2)
  FROM TGFFIN FIN JOIN TGFRAT RAT ON RAT.NUFIN=FIN.NUFIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N' AND FIN.RATEADO='S'
    AND RAT.CODNAT IN(1010104) AND FIN.CODTIPTIT IN(101,102,201,202) AND FIN.CODIGOBARRA IS NULL
  UNION ALL
  /* Financeiro rateado — boleto ÷6,3 */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG, ROUND((FIN.VLRDESDOB*FIN.RECDESP*RAT.PERCRATEIO/100)/6.3,2)
  FROM TGFFIN FIN JOIN TGFRAT RAT ON RAT.NUFIN=FIN.NUFIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N' AND FIN.RATEADO='S'
    AND RAT.CODNAT IN(1010104) AND FIN.CODIGOBARRA IS NOT NULL
  UNION ALL
  /* Financeiro rateado — demais tipos ÷5,5 */
  SELECT PA.CODGRUPO, FIN.CODEMP, FIN.DTNEG, ROUND((FIN.VLRDESDOB*FIN.RECDESP*RAT.PERCRATEIO/100)/5.5,2)
  FROM TGFFIN FIN JOIN TGFRAT RAT ON RAT.NUFIN=FIN.NUFIN ${PARC} = NVL(FIN.AD_CODPARCORI,FIN.CODPARC)
  WHERE FIN.RECDESP=1 AND FIN.ORIGEM='F' AND FIN.PROVISAO='N' AND FIN.RATEADO='S'
    AND RAT.CODNAT IN(1010104) AND FIN.CODTIPTIT NOT IN(101,102,201,202) AND FIN.CODIGOBARRA IS NULL
),
TOTAIS AS (
  SELECT CODGRUPO, ROUND(SUM(SKG),2) AS SALDO_KG,
    /* Loja responsável: a do movimento mais recente do cliente */
    MAX(CODEMP) KEEP (DENSE_RANK LAST ORDER BY DT) AS CODEMP
  FROM MOV GROUP BY CODGRUPO
),
SALDO_DIARIO AS (SELECT CODGRUPO, TRUNC(DT) AS DIA, SUM(SKG) AS SALDO_DIA FROM MOV GROUP BY CODGRUPO, TRUNC(DT)),
SALDO_ACUM AS (
  SELECT CODGRUPO, DIA, SUM(SALDO_DIA) OVER (PARTITION BY CODGRUPO ORDER BY DIA) AS SACUM FROM SALDO_DIARIO
),
ULT_NAO_NEG AS (SELECT CODGRUPO, MAX(DIA) AS DT_OK FROM SALDO_ACUM WHERE SACUM >= 0 GROUP BY CODGRUPO),
DIAS_NEG AS (
  SELECT A.CODGRUPO, TRUNC(SYSDATE) - MIN(A.DIA) AS DIAS
  FROM SALDO_ACUM A LEFT JOIN ULT_NAO_NEG U ON U.CODGRUPO = A.CODGRUPO
  WHERE A.SACUM < 0 AND (U.DT_OK IS NULL OR A.DIA > U.DT_OK)
  GROUP BY A.CODGRUPO
)
SELECT
  T.CODGRUPO AS CODPARC,
  P.NOMEPARC,
  P.RAZAOSOCIAL,
  CID.NOMECID,
  UFS.UF,
  T.CODEMP,
  T.SALDO_KG,
  NVL(D.DIAS, 0) AS DIAS_NEGATIVO
FROM TOTAIS T
JOIN TGFPAR P ON P.CODPARC = T.CODGRUPO
LEFT JOIN TSICID CID ON CID.CODCID = P.CODCID
LEFT JOIN TSIUFS UFS ON UFS.CODUF = CID.UF
LEFT JOIN DIAS_NEG D ON D.CODGRUPO = T.CODGRUPO`;
}

function normalizar(l) {
  const cidade = l.NOMECID ? String(l.NOMECID).trim() : null;
  return {
    CODPARC: Number(l.CODPARC),
    NOMEPARC: l.NOMEPARC,
    RAZAOSOCIAL: l.RAZAOSOCIAL,
    LOCALIDADE: cidade ? `${cidade}${l.UF ? ` - ${String(l.UF).trim()}` : ''}` : null,
    CODEMP: l.CODEMP == null ? null : Number(l.CODEMP),
    SALDO_KG: Number(l.SALDO_KG),
    DIAS_NEGATIVO: Number(l.DIAS_NEGATIVO),
  };
}

/** Clientes das lojas mapeadas devendo sucata (saldo abaixo do limite configurado). */
export async function buscarSucataDevendo() {
  const linhas = await consultarSQL(`
    SELECT * FROM (${sqlSaldos()})
    WHERE SALDO_KG < ${-Math.abs(Number(config.sucataSaldoMinimoKg))}
      AND CODEMP IN (${inteiros(config.empresas)})
      AND CODPARC NOT IN (SELECT E.CODPARC FROM TSIEMP E WHERE E.CODPARC IS NOT NULL)
    ORDER BY CODPARC`);
  return linhas.map(normalizar);
}

/**
 * Saldo atual de grupos específicos (para confirmar regularização ou reabertura).
 * Grupo ausente no Map = sem nenhum movimento de sucata no Sankhya.
 */
export async function consultarSaldosSucata(grupos) {
  const saldos = new Map();
  const unicos = [...new Set(grupos)];
  for (let i = 0; i < unicos.length; i += 300) {
    const bloco = inteiros(unicos.slice(i, i + 300));
    const filtro = `AND NVL(NULLIF(P.CODPARCMATRIZ,0), P.CODPARC) IN (${bloco})`;
    const linhas = await consultarSQL(sqlSaldos(filtro));
    for (const l of linhas) saldos.set(Number(l.CODPARC), normalizar(l));
  }
  return saldos;
}
