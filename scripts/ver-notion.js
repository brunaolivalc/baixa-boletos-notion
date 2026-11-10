/**
 * Mostra as colunas da base do Notion e quais delas a automação preenche na inclusão.
 * Uso: npm run ver:notion
 */
import { criarClienteNotion, abrirBase, listarPaginas } from '../src/notion.js';

const notion = criarClienteNotion();
const base = await abrirBase(notion);
const { porChave, duplicadas, total } = await listarPaginas(notion, base);

console.log(`Base: ${base.nome}`);
console.log(`Link: ${base.url}`);
console.log(`Fonte de dados: ${base.dataSourceId}`);
console.log(`Cards na base: ${total} | com chave de título (TIT:): ${porChave.size + duplicadas.size} | chaves repetidas: ${duplicadas.size}\n`);

const preenchidas = new Set(base.colunas.map((c) => c.prop.name));
console.log('Colunas da base:');
for (const prop of Object.values(base.propriedades)) {
  const marca = preenchidas.has(prop.name) ? 'automação preenche' : '-';
  const opcoes = prop[prop.type]?.options;
  const extra = opcoes ? `  opções: ${opcoes.map((o) => o.name).join(' | ')}` : '';
  console.log(`  ${prop.name.padEnd(30)} ${prop.type.padEnd(14)} ${marca}${extra}`);
}

if (base.avisos.length) {
  console.log('\nAvisos:');
  for (const aviso of base.avisos) console.log(`  ${aviso}`);
}
