/**
 * Teste só de leitura: mostra quantos títulos entrariam no Notion hoje.
 * Uso: npm run testar:sankhya
 */
import { config } from '../src/config.js';
import { buscarTitulosVencidos } from '../src/titulos.js';

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inicio = Date.now();
const titulos = await buscarTitulosVencidos();
const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

console.log(`Regra: empresas ${config.empresas.join(',')} | a receber | em aberto | vencidos há mais de ${config.diasAtraso} dias` +
  (config.diasAtrasoMaximo != null ? ` e no máximo ${config.diasAtrasoMaximo}` : '') +
  (config.tiposTitulo.length ? ` | só tipos ${config.tiposTitulo.join(',')}` : '') +
  (config.tiposTituloIgnorar.length ? ` | sem os tipos ${config.tiposTituloIgnorar.join(',')}` : ''));
console.log(`Títulos encontrados: ${titulos.length} (consulta levou ${segundos}s)`);
console.log(`Valor total: ${brl(titulos.reduce((s, t) => s + (t.VLRDESDOB || 0), 0))}\n`);

const porEmpresa = new Map();
for (const t of titulos) {
  const chave = `${t.CODEMP} - ${t.NOMEEMPRESA ?? '?'}`;
  const atual = porEmpresa.get(chave) ?? { qtd: 0, valor: 0 };
  atual.qtd += 1;
  atual.valor += t.VLRDESDOB || 0;
  porEmpresa.set(chave, atual);
}
console.log('Por empresa:');
for (const [empresa, { qtd, valor }] of [...porEmpresa].sort()) {
  console.log(`  ${empresa.padEnd(40)} ${String(qtd).padStart(6)}  ${brl(valor)}`);
}

const faixas = [
  ['8 a 30 dias', (d) => d <= 30],
  ['31 a 90 dias', (d) => d <= 90],
  ['91 a 365 dias', (d) => d <= 365],
  ['mais de 1 ano', () => true],
];
const contagem = Object.fromEntries(faixas.map(([nome]) => [nome, 0]));
for (const t of titulos) contagem[faixas.find(([, cabe]) => cabe(t.DIAS_ATRASO))[0]] += 1;
console.log('\nPor tempo de atraso:');
for (const [nome, qtd] of Object.entries(contagem)) console.log(`  ${nome.padEnd(16)} ${qtd}`);

const tipos = new Map();
for (const t of titulos) {
  const chave = `${t.CODTIPTIT} - ${t.DESCRTIPTIT ?? '?'}`;
  tipos.set(chave, (tipos.get(chave) ?? 0) + 1);
}
console.log('\nPor tipo de título:');
for (const [tipo, qtd] of [...tipos].sort((a, b) => b[1] - a[1])) console.log(`  ${tipo.padEnd(40)} ${qtd}`);

if (titulos[0]) {
  // Exemplo com dados pessoais escondidos, só para conferir os campos
  const ex = { ...titulos[0] };
  for (const campo of ['NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'TELEFONE', 'EMAIL']) {
    if (ex[campo]) ex[campo] = `${String(ex[campo]).slice(0, 3)}***`;
  }
  console.log('\nExemplo de título (dados pessoais escondidos):');
  console.log(ex);
}
