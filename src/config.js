import { fileURLToPath } from 'node:url';

// Em produção (Railway) as variáveis vêm do painel; localmente, do arquivo .env
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // sem .env: segue com as variáveis de ambiente do sistema
}

function obrigatoria(nome) {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`Variável ${nome} não configurada (veja o .env.example)`);
  return valor;
}

function listaDeNumeros(texto) {
  return (texto || '')
    .split(',')
    .filter((s) => s.trim() !== '')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

export const config = {
  sankhya: {
    get xToken() { return obrigatoria('SANKHYA_X_TOKEN'); },
    get clientId() { return obrigatoria('SANKHYA_CLIENT_ID'); },
    get clientSecret() { return obrigatoria('SANKHYA_CLIENT_SECRET'); },
  },
  notion: {
    get token() { return obrigatoria('NOTION_TOKEN'); },
    // Fonte de dados da base "Posição de Cobrança" (títulos e sucata)
    get base() { return obrigatoria('NOTION_DATABASE'); },
    // Fonte de dados da base por cliente (seção 7 do roteiro)
    clientes: process.env.NOTION_CLIENTES?.trim() || '41f9fe7c-432e-81bf-90e3-000ba27aa0e8',
  },
  // Empresas do Sankhya que entram na sincronização
  empresas: listaDeNumeros(process.env.EMPRESAS || '1,2,3,4,5,6,7,8,9'),
  // Títulos: entra tudo que venceu até ontem. Opcional: não traz títulos vencidos há mais de X dias
  diasAtrasoMaximo: process.env.DIAS_ATRASO_MAXIMO ? Number(process.env.DIAS_ATRASO_MAXIMO) : null,
  // Opcional: só estes tipos de título (CODTIPTIT). Vazio = todos
  tiposTitulo: listaDeNumeros(process.env.TIPOS_TITULO),
  // Opcional: ignora estes tipos de título (CODTIPTIT)
  tiposTituloIgnorar: listaDeNumeros(process.env.TIPOS_TITULO_IGNORAR),
  // Sucata: entra o cliente devendo mais que X kg (0 = qualquer saldo negativo)
  sucataSaldoMinimoKg: Number(process.env.SUCATA_SALDO_MINIMO_KG ?? 10),
  // Opcional: ignora estes parceiros (CODPARC), ex.: 4262 = REDECARD
  parceirosIgnorar: listaDeNumeros(process.env.PARCEIROS_IGNORAR ?? '4262'),
};
