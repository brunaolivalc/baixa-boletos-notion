/**
 * Uso:
 *   npm start          -> sincroniza de verdade
 *   npm run conferir   -> modo conferência: mostra o que faria, sem gravar no Notion
 */
import { sincronizar } from './sync.js';

const simular = process.argv.includes('--simular');

try {
  const resultado = await sincronizar({ simular });
  process.exitCode = resultado.erros > 0 ? 1 : 0;
} catch (erro) {
  console.error(`ERRO: ${erro.message}`);
  process.exitCode = 1;
}
