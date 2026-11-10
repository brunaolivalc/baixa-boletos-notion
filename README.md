# Posição de Cobrança: Sankhya → Notion

Duas rotinas diárias que alimentam a base **Posição de Cobrança** do Notion, conforme o roteiro da equipe. Elas rodam uma depois da outra (títulos, depois sucata), nunca ao mesmo tempo.

## Rotina de títulos

1. **Lê a carteira inteira no Sankhya**: receita a receber (`RECDESP = 1`), em aberto, cliente externo (o parceiro não é uma das empresas do grupo), empresas 1 a 9, sem REDECARD, **vencidos e a vencer nos próximos 7 dias**. O Notion separa sozinho, pela coluna "Faixa de vencimento", as visões *Títulos a vencer* e *Títulos vencidos +7 dias*: o mesmo card troca de visão conforme os dias passam. Se a leitura falhar, a rotina para sem mexer no Notion.
2. **Lê todos os cards de títulos** pela coluna **Chave Sankhya** (`TIT:<NUFIN>`).
3. **Chave nova:** cria o card com *Em aberto*, *A tratar*, os campos do Sankhya e o cabeçalho **Histórico de tratativas**.
4. **Chave que já existe:** não altera nada (fotografia da inclusão). Se o vencimento mudou no Sankhya, registra para revisão.
5. **Card cujo título saiu da carteira:** confere o NUFIN no Sankhya.
   - Baixa integral confirmada: manda o card para a lixeira e confere `in_trash: true`.
   - Baixa parcial, renegociação, título não encontrado, vencimento alterado: **mantém o card** e registra a exceção.

## Rotina de sucata

O saldo vem da SQL oficial **SALDO_SUCATA_GRUPO** (a mesma do lc-forca-vendas), calculada para todos os clientes de uma vez. Matriz e filiais somam juntas; saldo negativo é sucata devida.

1. **Entra** o cliente externo devendo mais de **10 kg**, cuja loja (a do movimento mais recente) é de 1 a 9. Chave: `SUC:<CODPARC>`.
2. **Card novo:** *Em aberto*, *A tratar*, loja, polo, localidade, saldo (com o sinal) e dias no negativo.
3. **Card em aberto:** não altera nada (fotografia da inclusão).
4. **Cliente que regularizou** (saldo zerado ou positivo): o card vira *Encerrada*, motivo *Sucata regularizada*, com a data, e aparece na visão **Histórico**. Nunca vai para a lixeira.
5. **Encerrado que voltou a dever:** reabre a **mesma página** (*Em aberto*, *A tratar*, novo saldo), preservando as tratativas.
6. Cliente ainda devendo, mas abaixo de 10 kg: o card segue em aberto. Cliente sem movimento de sucata: exceção para revisão.

## Regras gerais

- A automação só escreve nas colunas do de-para em [src/campos.js](src/campos.js). O que a equipe preenche (última posição, assessoria, próximo retorno, tratativas) nunca é alterado.
- Chave repetida em mais de um card: nenhum deles é alterado e a chave vai para as exceções.
- Cada execução termina com um **Resumo** no log: horário, rotina, consultados, incluídos, já existentes, removidos/encerrados, reabertos, exceções e erros.

## Configurar o Notion

1. Em https://www.notion.so/profile/integrations, crie uma integração **interna** com permissão de ler, inserir e atualizar conteúdo. Copie o token.
2. Na página da base **Posição de Cobrança**, menu **•••** > **Conexões** > adicione a integração.
3. No `.env`, preencha `NOTION_TOKEN`. O `NOTION_DATABASE` já está com o ID da fonte de dados do roteiro.
4. Rode `npm run ver:notion` para conferir as colunas.

## Comandos

```bash
npm install
npm run testar:sankhya   # só leitura: quantos títulos entram hoje, por empresa, faixa e tipo
npm run ver:notion       # colunas da base e o que a automação preenche
npm run conferir         # modo conferência das duas rotinas: mostra o que faria e gera planilhas em saida/
npm start                # roda as duas rotinas de verdade
node src/index.js --so-titulos   # ou --so-sucata (pode juntar com --simular)
```

## Regras ajustáveis (no `.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `EMPRESAS` | `1,2,3,4,5,6,7,8,9` | Empresas/lojas que entram |
| `DIAS_A_VENCER` | `7` | Carrega também os títulos que vencem nos próximos X dias (0 = só vencidos) |
| `DIAS_ATRASO` | `7` | Com `DIAS_A_VENCER=0`: entra o título vencido há mais de X dias |
| `DIAS_ATRASO_MAXIMO` | vazio | Não traz títulos mais antigos que X dias |
| `TIPOS_TITULO` | vazio | Só estes tipos de título (CODTIPTIT) |
| `TIPOS_TITULO_IGNORAR` | vazio | Ignora estes tipos de título |
| `PARCEIROS_IGNORAR` | `4262` | Ignora estes parceiros (4262 = REDECARD) |
| `SUCATA_SALDO_MINIMO_KG` | `10` | Sucata: entra quem deve mais que X kg (0 = qualquer saldo negativo) |

## Rodar todo dia (Railway)

O [railway.toml](railway.toml) agenda para 7h de Brasília (`0 10 * * *` em UTC). O serviço no Railway está ligado ao repositório do GitHub: cada push faz um deploy novo. As variáveis do `.env` ficam cadastradas na aba **Variables** do serviço.
