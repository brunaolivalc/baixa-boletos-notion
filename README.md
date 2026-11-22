# Posição de Cobrança: Sankhya → Notion

Duas rotinas diárias que alimentam a base **Posição de Cobrança** do Notion, conforme o roteiro da equipe. Elas rodam uma depois da outra (títulos, depois sucata), nunca ao mesmo tempo. Cada pendência fica vinculada ao seu cliente na **base por cliente**.

## Rotina de títulos

1. **Lê a carteira inteira no Sankhya**: receita a receber (`RECDESP = 1`), em aberto, cliente externo (o parceiro não é uma das empresas do grupo), empresas 1 a 9, sem REDECARD, **vencimento até ontem** pela data de Brasília. O Notion separa sozinho, pela "Faixa de vencimento", as visões *Títulos vencidos de 1 a 7 dias* e *Títulos vencidos +7 dias*. Se a leitura falhar, a rotina para sem mexer no Notion.
2. **Lê todos os cards de títulos** pela coluna **Chave Sankhya** (`TIT:<NUFIN>`) e a base de clientes.
3. **Chave nova:** localiza (ou cria) o cliente pelo código do parceiro e cria o card já vinculado, com *Em aberto*, *A tratar*, os campos do Sankhya, o **Vendedor** e o cabeçalho **Histórico de tratativas**.
4. **Chave que já existe:** preserva o card. Só completa o que estiver **vazio**: vínculo com o cliente, vendedor e campos do Sankhya que faltaram. Nunca sobrescreve.
5. **Card cujo título saiu da carteira:** confere o NUFIN no Sankhya.
   - **Baixa integral** confirmada: manda o card para a lixeira e confere `in_trash: true`.
   - **Pago no cartão** (o Sankhya passou o título para a operadora e guardou o cliente em `AD_CODPARCORI`): lixeira.
   - **Vence hoje ou depois** e o card entrou assim (carga antiga de "a vencer"): lixeira.
   - Baixa parcial, renegociação, título não encontrado, vencimento repactuado, título que virou despesa: **mantém o card** e registra a exceção.

**Vendedor:** o apelido do vendedor da nota de origem (`TGFCAB.CODVEND` → `TGFVEN.APELIDO`); sem nota, o do financeiro. Ficam vazios (e vão para o log) os "vendedores" que marcam assessoria, advogado ou ausência: `<SEM VENDEDOR>`, `UNINOVA…`, `CONSULTH…`, `ADVOGADO…`.

## Rotina de sucata

O saldo vem da SQL oficial **SALDO_SUCATA_GRUPO** (a mesma do lc-forca-vendas), calculada para todos os clientes de uma vez. Matriz e filiais somam juntas; saldo negativo é sucata devida.

1. **Entra** o cliente externo devendo mais de **10 kg**, cuja loja (a do movimento mais recente) é de 1 a 9. Chave: `SUC:<CODPARC>`. O card nasce vinculado ao cliente.
2. **Card em aberto:** preservado; só completa o que estiver vazio.
3. **Cliente que regularizou** (saldo zerado ou positivo): *Encerrada*, *Sucata regularizada*, com a data. Aparece no **Histórico**. Nunca vai para a lixeira.
4. **Encerrado que voltou a dever:** reabre a **mesma página** (*Em aberto*, *A tratar*, novo saldo), preservando as tratativas.

## Base por cliente

- Chave: **Código do parceiro** (`CODPARC` como texto). Um código = uma página, compartilhada pelas lojas.
- Cliente que falta é criado **antes** da pendência, e a pendência já nasce com a relação **Cliente**.
- Cliente novo ganha no corpo as mesmas visualizações vinculadas do cliente-modelo (**Matias Pimentel, 3317**), com o filtro trocado para o novo cliente. Se a visualização falhar, o cliente é desfeito e recriado na próxima rodada.
- Os totais do cliente (quantidade, total vencido, +7 dias, 1 a 7 dias, sucata) são calculados pelo próprio Notion.

## Segurança

- Se uma coluna do de-para sumir ou for renomeada no Notion, a rotina **para antes de gravar** e mostra quais colunas faltam. O de-para fica em [src/campos.js](src/campos.js).
- O que a equipe preenche (última posição, andamento, assessoria, próximo retorno, tratativas) nunca é alterado.
- Chave repetida em mais de um card: nenhum deles é alterado e a chave vai para as exceções.
- Cada execução termina com um **Resumo** no log: horário, rotina, consultados, incluídos, já existentes, completados, removidos/encerrados, reabertos, exceções e erros.

## Configurar o Notion

1. Integração interna **AutomateX** com permissão de ler, inserir e atualizar conteúdo.
2. Conectar a integração nas **duas bases**: Posição de Cobrança e a base por cliente (menu **•••** > **Conexões**). Sem a base de clientes, a rotina roda sem os vínculos e completa tudo quando o acesso for liberado.
3. No `.env`: `NOTION_TOKEN`, `NOTION_DATABASE` e `NOTION_CLIENTES` (já com os IDs do roteiro).

## Comandos

```bash
npm install
npm run testar:sankhya   # só leitura: quantos títulos entram hoje, por empresa, atraso e tipo
npm run ver:notion       # colunas da base e o que a automação preenche
npm run conferir         # modo conferência das duas rotinas: mostra o que faria e gera planilhas em saida/
npm start                # roda as duas rotinas de verdade
node src/index.js --so-titulos   # ou --so-sucata (pode juntar com --simular)
```

## Regras ajustáveis (no `.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `EMPRESAS` | `1,2,3,4,5,6,7,8,9` | Empresas/lojas que entram |
| `DIAS_ATRASO_MAXIMO` | vazio | Não traz títulos vencidos há mais de X dias |
| `TIPOS_TITULO` | vazio | Só estes tipos de título (CODTIPTIT) |
| `TIPOS_TITULO_IGNORAR` | vazio | Ignora estes tipos de título |
| `PARCEIROS_IGNORAR` | `4262` | Ignora estes parceiros (4262 = REDECARD) |
| `SUCATA_SALDO_MINIMO_KG` | `10` | Sucata: entra quem deve mais que X kg (0 = qualquer saldo negativo) |

## Rodar todo dia (Railway)

O [railway.toml](railway.toml) agenda para 7h de Brasília (`0 10 * * *` em UTC). O serviço no Railway está ligado ao repositório do GitHub: cada push faz um deploy novo. As variáveis ficam na aba **Variables** do serviço (`NOTION_CLIENTES` já tem o valor padrão no código).
