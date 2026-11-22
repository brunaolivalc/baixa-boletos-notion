/**
 * De-para entre os dados do Sankhya e as colunas da base "Posição de Cobrança" no Notion,
 * conforme o roteiro da equipe (seção 5, nomes atuais da base).
 *
 * - `nomes`: nomes aceitos para a coluna no Notion (usa o primeiro que existir;
 *   maiúsculas, acentos e o que estiver entre parênteses não importam).
 * - O tipo da coluna (texto, número, data, seleção...) é lido do próprio Notion.
 * - Coluna obrigatória que não existir na base faz a rotina parar ANTES de gravar qualquer coisa
 *   (assim uma coluna renomeada não gera cards incompletos). `opcional: true` só gera aviso.
 * - Os campos são gravados quando o card é criado (fotografia da inclusão). Depois disso a
 *   automação só preenche o que estiver vazio (vínculo com o cliente, vendedor, dados que faltaram).
 */

// Coluna que identifica o card. Obrigatória na base.
export const COLUNA_CHAVE = 'Chave Sankhya';
export const PREFIXO_CHAVE = 'TIT:';
export const chaveDoTitulo = (t) => `${PREFIXO_CHAVE}${t.NUFIN}`;

// Colunas usadas pela lógica da rotina
export const COLUNA_VENCIMENTO = 'Venc.';
export const COLUNA_CLIENTE = 'Cliente'; // relação com a base por cliente
export const COLUNA_PARCEIRO = 'Parceiro'; // CODPARC
export const COLUNA_VENDEDOR = 'Vendedor';

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
  39: 'Consulth',
};

const texto = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const codigo = (v) => (v == null ? null : String(v));

// Campos comuns a títulos e sucata
const comuns = (tipo) => [
  { nomes: ['Nome'], titulo: true, valor: (x) => texto(x.NOMEPARC) },
  { nomes: ['Razão Social'], opcional: true, valor: (x) => texto(x.RAZAOSOCIAL) ?? texto(x.NOMEPARC) },
  { nomes: [COLUNA_PARCEIRO, 'Código do parceiro'], valor: (x) => codigo(x.CODPARC) },
  { nomes: ['Empresa', 'Código da empresa'], valor: (x) => codigo(x.CODEMP) },
  { nomes: ['Loja'], valor: (x) => (LOJAS[x.CODEMP] ? `${x.CODEMP} — ${LOJAS[x.CODEMP]}` : null) },
  { nomes: ['Polo de alinhamento'], valor: (x) => POLOS[x.CODEMP] ?? null },
  { nomes: ['Tipo de pendência'], valor: () => tipo },
  { nomes: ['Situação da pendência'], valor: () => 'Em aberto' },
  { nomes: ['Andamento', 'Andamento da cobrança'], valor: () => 'A tratar' },
];

export const CAMPOS = [
  ...comuns('Título'),
  { nomes: [COLUNA_CHAVE], valor: chaveDoTitulo },
  { nomes: ['Único', 'Nro Único (NUFIN)', 'Nro Único', 'NUFIN'], valor: (t) => codigo(t.NUFIN) },
  { nomes: ['Nota', 'Nro Nota'], valor: (t) => (t.NUMNOTA ? codigo(t.NUMNOTA) : null) },
  { nomes: ['Desd', 'Desdobramento'], valor: (t) => texto(t.DESDOBRAMENTO) },
  { nomes: [COLUNA_VENCIMENTO, 'Vencimento'], valor: (t) => t.DTVENC },
  { nomes: ['Operação', 'Código de operação'], valor: (t) => codigo(t.CODTIPOPER) },
  { nomes: ['Valor', 'Valor do desdobramento'], valor: (t) => t.VLRDESDOB },
  { nomes: ['Valor líquido (R$)', 'Valor líquido'], valor: (t) => t.VLRLIQUIDO },
  { nomes: ['Cód. Tipo Título', 'Código do tipo de título'], valor: (t) => codigo(t.CODTIPTIT) },
  { nomes: ['Tipo de título'], valor: (t) => texto(t.DESCRTIPTIT) },
  { nomes: ['Histórico Sankhya', 'Histórico'], valor: (t) => texto(t.HISTORICO) },
  { nomes: [COLUNA_VENDEDOR], valor: (t) => texto(t.VENDEDOR) },
  { nomes: ['Assessoria'], opcional: true, valor: (t) => ASSESSORIAS[t.CODTIPTIT] ?? null },
];

// Campos que vêm do Sankhya: os únicos que a automação completa em cards já existentes (se vazios)
export const CAMPOS_DO_ERP_TITULO = [
  'Nome', 'Razão Social', COLUNA_PARCEIRO, 'Empresa', 'Loja', 'Polo de alinhamento',
  'Único', 'Nota', 'Desd', COLUNA_VENCIMENTO, 'Operação', 'Valor', 'Valor líquido (R$)',
  'Cód. Tipo Título', 'Tipo de título', 'Histórico Sankhya', COLUNA_VENDEDOR,
];

// ---------- Sucata ----------
// O saldo oficial é por cliente (matriz + filiais), não por loja; por isso a chave é SUC:<CODPARC do grupo>.
// A loja é a do movimento mais recente do cliente e serve só para apresentação.
export const PREFIXO_SUCATA = 'SUC:';
export const chaveDaSucata = (s) => `${PREFIXO_SUCATA}${s.CODPARC}`;

export const CAMPOS_SUCATA = [
  ...comuns('Sucata'),
  { nomes: [COLUNA_CHAVE], valor: chaveDaSucata },
  { nomes: ['Localidade'], valor: (s) => texto(s.LOCALIDADE) },
  { nomes: ['Saldo Sucata', 'Saldo de sucata (kg)'], valor: (s) => s.SALDO_KG },
  { nomes: ['Dias no negativo'], valor: (s) => s.DIAS_NEGATIVO },
];

export const CAMPOS_DO_ERP_SUCATA = [
  'Nome', 'Razão Social', COLUNA_PARCEIRO, 'Empresa', 'Loja', 'Polo de alinhamento',
  'Localidade', 'Saldo Sucata', 'Dias no negativo',
];

// Colunas usadas para encerrar e reabrir pendências de sucata
export const SUCATA_ENCERRAMENTO = {
  situacao: 'Situação da pendência',
  andamento: 'Andamento',
  motivo: 'Motivo do encerramento',
  data: 'Data de encerramento',
  saldo: 'Saldo Sucata',
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
