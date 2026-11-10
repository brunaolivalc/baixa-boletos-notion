/**
 * Cliente da API Gateway do Sankhya.
 * Mesmo esquema dos outros projetos da LC (lc-forca-vendas/src/lib/sankhya.ts):
 * login OAuth com X-Token e consultas SQL pelo DbExplorerSP.executeQuery.
 */
import { config } from './config.js';

const BASE_URL = 'https://api.sankhya.com.br';
const SERVICE_URL = `${BASE_URL}/gateway/v1/mge/service.sbr`;
const CODIGOS_DE_LOGIN = new Set(['GTW3401', 'GTW3402', 'GTW3403', 'MGE-0100']);
const TIMEOUT_MS = 60_000;

let token = null;
let tokenValidoAte = 0;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function erroDeLogin(data) {
  const msg = data?.statusMessage ?? data?.error?.descricao ?? '';
  const codigo = data?.error?.codigo ?? '';
  return CODIGOS_DE_LOGIN.has(codigo) || /token|autoriza|autenti|session|expired|expirado/i.test(msg);
}

async function autenticar(forcar = false) {
  if (!forcar && token && Date.now() < tokenValidoAte) return token;

  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Token': config.sankhya.xToken,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.sankhya.clientId,
      client_secret: config.sankhya.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login no Sankhya falhou (${res.status}): ${JSON.stringify(data)}`);

  const novo = data.access_token ?? data.bearerToken ?? data.token;
  if (!novo) throw new Error(`Login no Sankhya não devolveu token. Campos: ${Object.keys(data).join(', ')}`);

  token = novo;
  // Renova 1 minuto antes de vencer
  tokenValidoAte = Date.now() + ((data.expires_in ?? 300) - 60) * 1000;
  return token;
}

/**
 * Roda um SELECT no banco do Sankhya (Oracle) e devolve as linhas como objetos.
 * Tenta de novo em falha de rede/instabilidade e refaz o login se a sessão cair.
 */
export async function consultarSQL(sql, tentativa = 1) {
  const MAX_TENTATIVAS = 3;
  let data;

  try {
    const bearer = await autenticar();
    const res = await fetch(`${SERVICE_URL}?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
        'X-Token': config.sankhya.xToken,
      },
      body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await res.json().catch(() => ({ status: '0', statusMessage: `Resposta inválida (HTTP ${res.status})` }));
    if (res.status === 401) data = { ...data, status: '0', error: { codigo: 'GTW3401' } };
  } catch (erroDeRede) {
    if (tentativa < MAX_TENTATIVAS) {
      await esperar(1500 * tentativa);
      return consultarSQL(sql, tentativa + 1);
    }
    throw new Error(`Sankhya fora do ar ou sem resposta: ${erroDeRede.message}`);
  }

  if (data.status !== '1') {
    const motivo = data.statusMessage ?? data.error?.descricao ?? JSON.stringify(data).slice(0, 300);
    // Erro de SQL (ORA-...) não melhora tentando de novo
    const erroDeSQL = /ORA-\d+/.test(motivo);
    if (!erroDeSQL && tentativa < MAX_TENTATIVAS) {
      if (erroDeLogin(data)) token = null;
      await esperar(1500 * tentativa);
      return consultarSQL(sql, tentativa + 1);
    }
    throw new Error(`Sankhya recusou a consulta: ${motivo}`);
  }

  const colunas = (data.responseBody?.fieldsMetadata ?? []).map((f) => f.name);
  const linhas = data.responseBody?.rows ?? [];
  return linhas.map((linha) => Object.fromEntries(colunas.map((c, i) => [c, linha[i] ?? null])));
}
