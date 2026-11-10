/**
 * De-para entre os dados do título no Sankhya e as colunas da base "Posição de Cobrança"
 * no Notion, conforme o roteiro da equipe.
 *
 * - `nomes`: nomes aceitos para a coluna no Notion (usa o primeiro que existir;
 *   maiúsculas e acentos não importam).
 * - O tipo da coluna (texto, número, data, seleção...) é lido do próprio Notion.
 * - Coluna que não existir na base é ignorada com um aviso.
 * - Os campos só são gravados quando o card é criado (fotografia da inclusão).
 *   O que a equipe preencher depois nunca é alterado pela automação.
 */

// Coluna que identifica o card. Obrigatória na base.
export const COLUNA_CHAVE = 'Chave Sankhya';
export const PREFIXO_CHAVE = 'TIT:';
export const chaveDoTitulo = (t) => `${PREFIXO_CHAVE}${t.NUFIN}`;

// Coluna de vencimento usada para avisar quando o Sankhya alterar o vencimento
export const COLUNA_VENCIMENTO = 'Vencimento';

export const LOJAS = {
  1: 'Brasília',
  2: 'Goiânia',
  3: 'Minas',
  4: 'Varejo',
  5: 'Salvador',
  6: 'Feira de Santana',
  7: 'Barreiras',
  8: 'Tocantins',
  9: 'Target Comércio de Baterias',
};

// Unidades sem polo definido ficam em branco até a equipe decidir
export const POLOS = {
  1: 'Brasília',
  2: 'Brasília',
  5: 'Salvador',
  7: 'Barreiras',
  8: 'Barreiras',
};

// Tipos de título que indicam que o título já está com uma assessoria de cobrança
export const ASSESSORIAS = {
  38: 'Uninova',
  39: 'Consulte',
};

const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const codigo = (v) => (v == null ? null : String(v));

export const CAMPOS = [
  // Comuns
  { nomes: ['Nome'], titulo: true, valor: (t) => texto(t.NOMEPARC) },
  { nomes: ['Parceiro'], valor: (t) => texto(t.RAZAOSOCIAL) ?? texto(t.NOMEPARC) },
  { nomes: [COLUNA_CHAVE], valor: chaveDoTitulo },
  { nomes: ['Tipo de pendência'], valor: () => 'Título' },
  { nomes: ['Situação da pendência'], valor: () => 'Em aberto' },
  { nomes: ['Andamento da cobrança'], valor: () => 'A tratar' },
  { nomes: ['Loja'], valor: (t) => LOJAS[t.CODEMP] ?? null },
  { nomes: ['Polo de alinhamento'], valor: (t) => POLOS[t.CODEMP] ?? null },
  { nomes: ['Código da empresa'], valor: (t) => codigo(t.CODEMP) },
  { nomes: ['Código do parceiro'], valor: (t) => codigo(t.CODPARC) },
  // Títulos
  { nomes: ['Nro Único (NUFIN)', 'Nro Único', 'NUFIN'], valor: (t) => t.NUFIN },
  { nomes: ['Nro Nota', 'Nro. Nota'], valor: (t) => (t.NUMNOTA ? t.NUMNOTA : null) },
  { nomes: ['Desdobramento', 'Desdob.'], valor: (t) => texto(t.DESDOBRAMENTO) },
  { nomes: [COLUNA_VENCIMENTO, 'Dt. Vencimento'], valor: (t) => t.DTVENC },
  { nomes: ['Código de operação', 'Código da operação', 'TOP'], valor: (t) => codigo(t.CODTIPOPER) },
  { nomes: ['Valor do desdobramento', 'Vlr. desdobramento', 'Vlr desdobramento', 'Valor desdobramento'], valor: (t) => t.VLRDESDOB },
  { nomes: ['Valor líquido', 'Vlr. líquido', 'Vlr líquido'], valor: (t) => t.VLRLIQUIDO },
  { nomes: ['Código do tipo de título', 'Código tipo de título', 'Cód. tipo de título'], valor: (t) => codigo(t.CODTIPTIT) },
  { nomes: ['Tipo de título', 'Nome do tipo de título', 'Descrição do tipo de título'], valor: (t) => texto(t.DESCRTIPTIT) },
  { nomes: ['Histórico', 'Histórico do Sankhya', 'Histórico Sankhya'], valor: (t) => texto(t.HISTORICO) },
  { nomes: ['Assessoria'], valor: (t) => ASSESSORIAS[t.CODTIPTIT] ?? null },
];

// ---------- Sucata ----------
// O saldo oficial é por cliente (matriz + filiais), não por loja; por isso a chave é SUC:<CODPARC do grupo>.
// A loja é a do movimento mais recente do cliente e serve só para apresentação.
export const PREFIXO_SUCATA = 'SUC:';
export const chaveDaSucata = (s) => `${PREFIXO_SUCATA}${s.CODPARC}`;

export const CAMPOS_SUCATA = [
  { nomes: ['Nome'], titulo: true, valor: (s) => texto(s.NOMEPARC) },
  { nomes: ['Parceiro'], valor: (s) => texto(s.RAZAOSOCIAL) ?? texto(s.NOMEPARC) },
  { nomes: [COLUNA_CHAVE], valor: chaveDaSucata },
  { nomes: ['Tipo de pendência'], valor: () => 'Sucata' },
  { nomes: ['Situação da pendência'], valor: () => 'Em aberto' },
  { nomes: ['Andamento da cobrança'], valor: () => 'A tratar' },
  { nomes: ['Loja'], valor: (s) => LOJAS[s.CODEMP] ?? null },
  { nomes: ['Polo de alinhamento'], valor: (s) => POLOS[s.CODEMP] ?? null },
  { nomes: ['Código da empresa'], valor: (s) => codigo(s.CODEMP) },
  { nomes: ['Código do parceiro'], valor: (s) => codigo(s.CODPARC) },
  { nomes: ['Localidade'], valor: (s) => texto(s.LOCALIDADE) },
  { nomes: ['Saldo de sucata (kg)'], valor: (s) => s.SALDO_KG },
  { nomes: ['Dias no negativo'], valor: (s) => s.DIAS_NEGATIVO },
];

// Colunas usadas para encerrar e reabrir pendências de sucata
export const SUCATA_ENCERRAMENTO = {
  situacao: 'Situação da pendência',
  andamento: 'Andamento da cobrança',
  motivo: 'Motivo do encerramento',
  data: 'Data de encerramento',
  saldo: 'Saldo de sucata (kg)',
  dias: 'Dias no negativo',
};

// Conteúdo inicial do corpo de cada card novo
export const CORPO_CARD_NOVO = [
  {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Histórico de tratativas' } }] },
  },
];
