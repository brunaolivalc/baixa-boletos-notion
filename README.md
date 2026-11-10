# Títulos vencidos: Sankhya → Notion (Posição de Cobrança)

Rotina diária de **títulos** do roteiro da equipe. A rotina de **sucata** ainda não foi feita: depende de validar a consulta de sucata com quem mantém o relatório.

## O que a rotina faz

1. **Lê a carteira inteira no Sankhya**: receita a receber (`RECDESP = 1`), em aberto, cliente externo (o parceiro não é uma das empresas do grupo), empresas 1 a 9, vencido há **mais de 7 dias** (entra no 8º dia). Se a leitura falhar no meio, a rotina para sem mexer no Notion.
2. **Lê todos os cards de títulos do Notion** pela coluna **Chave Sankhya** (`TIT:<NUFIN>`). Cards de sucata (`SUC:...`) e cards sem chave são ignorados.
3. **Chave nova:** cria o card com Situação da pendência = *Em aberto*, Andamento da cobrança = *A tratar*, os campos do Sankhya e o cabeçalho **Histórico de tratativas** no corpo.
4. **Chave que já existe:** não altera nada (fotografia da inclusão). Se o vencimento mudou no Sankhya, registra para revisão.
5. **Card cujo título saiu da carteira:** confere o NUFIN no Sankhya.
   - Baixa integral confirmada: manda o card para a lixeira do Notion e confere `in_trash: true` na resposta.
   - Baixa parcial (o Sankhya criou outro título com o saldo), renegociação, título não encontrado, vencimento alterado: **mantém o card** e registra a exceção.
6. **Resumo da execução** no log: horário, consultados, incluídos, já existentes, removidos, exceções e erros.

Chave repetida em mais de um card: nenhum deles é alterado e a chave vai para as exceções.

## Configurar o Notion

1. Em https://www.notion.so/profile/integrations, crie uma integração **interna** com permissão de ler, inserir e atualizar conteúdo. Copie o token.
2. Na página da base **Posição de Cobrança**, menu **•••** > **Conexões** > adicione a integração.
3. No `.env`, preencha `NOTION_TOKEN`. O `NOTION_DATABASE` já está com o ID da fonte de dados do roteiro.
4. Rode `npm run ver:notion` para conferir as colunas que a automação vai preencher.

O de-para das colunas está em [src/campos.js](src/campos.js).

## Comandos

```bash
npm install
npm run testar:sankhya   # só leitura: quantos títulos entram hoje, por empresa, atraso e tipo
npm run ver:notion       # colunas da base e o que a automação preenche
npm run conferir         # modo conferência: mostra o que faria, sem gravar nada
npm start                # roda de verdade
```

## Regras ajustáveis (no `.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `EMPRESAS` | `1,2,3,4,5,6,7,8,9` | Empresas do Sankhya que entram |
| `DIAS_ATRASO` | `7` | Entra o título vencido há mais de X dias |
| `DIAS_ATRASO_MAXIMO` | vazio | Não traz títulos mais antigos que X dias |
| `TIPOS_TITULO` | vazio | Só estes tipos de título (CODTIPTIT) |
| `TIPOS_TITULO_IGNORAR` | vazio | Ignora estes tipos de título |
| `PARCEIROS_IGNORAR` | `4262` | Ignora estes parceiros (4262 = REDECARD) |

## Rodar todo dia (Railway)

O [railway.toml](railway.toml) agenda para 7h de Brasília. No Railway, crie o serviço a partir desta pasta e cadastre as mesmas variáveis do `.env`. Uma execução por vez: o Railway não começa outra enquanto a anterior está rodando.
