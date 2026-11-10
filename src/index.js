/**
 * Uso:
 *   npm start              -> roda as duas rotinas (títulos e depois sucata)
 *   npm run conferir       -> modo conferência: mostra o que faria, sem gravar no Notion
 *   node src/index.js --so-titulos | --so-sucata   (pode juntar com --simular)
 *
 * As rotinas rodam uma depois da outra, nunca ao mesmo tempo sobre a base.
 * Se uma falhar, a outra roda mesmo assim, e o processo termina com erro.
 */
import { sincronizarTitulos } from './sync.js';
import { sincronizarSucata } from './sync-sucata.js';

const simular = process.argv.includes('--simular');
const rotinas = [];
if (!process.argv.includes('--so-sucata')) rotinas.push(['títulos', sincronizarTitulos]);
if (!process.argv.includes('--so-titulos')) rotinas.push(['sucata', sincronizarSucata]);

let falhou = false;
for (const [nome, rotina] of rotinas) {
  try {
    const resumo = await rotina({ simular });
    if (resumo.erros > 0) falhou = true;
  } catch (erro) {
    falhou = true;
    console.error(`ERRO na rotina de ${nome}: ${erro.message}`);
  }
  console.log('');
}
process.exitCode = falhou ? 1 : 0;
