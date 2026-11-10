import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FUSO = 'America/Sao_Paulo';
const PASTA_SAIDA = fileURLToPath(new URL('../saida/', import.meta.url));
const SIMULTANEOS = 3; // a API do Notion aceita ~3 chamadas por segundo

export const agora = () => new Date().toLocaleString('pt-BR', { timeZone: FUSO });
export const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
export const log = (...args) => console.log(`[${agora()}]`, ...args);
export const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '?');
export const brl = (v) => (v == null ? '?' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const kg = (v) => (v == null ? '?' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`);

export async function emParalelo(itens, fn) {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEOS, itens.length) }, trabalhador));
}

/** Salva uma planilha CSV que abre direto no Excel em português. */
export async function salvarPlanilha(nome, linhas) {
  const cel = (v) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/\s+/g, ' ').trim();
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  await mkdir(PASTA_SAIDA, { recursive: true });
  const arquivo = `${PASTA_SAIDA}${nome}-${hojeISO()}.csv`;
  await writeFile(arquivo, '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n'), 'utf8');
  return arquivo;
}
