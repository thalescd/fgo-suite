# FGO Tools

Busca, dados e calculadora de dano para Fate/Grand Order, sobre os dumps públicos
da [Atlas Academy](https://api.atlasacademy.io).

Três entregas sobre a mesma base:

1. **Busca** — catálogo filtrável de servos, Craft Essences e Mystic Codes.
2. **Acesso por LLM** — MCP server expondo os mesmos dados como ferramentas tipadas.
3. **Calculadora de dano** — usável na tela e como ferramenta por um assistente.

Site estático: os dados são pré-processados em build, sem backend e sem banco.

## Estado

| Fase | Entrega | Status |
|---|---|---|
| **0** | Ingestão, manifest, modelo canônico | ✅ pronta |
| **1** | Busca com filtros diretos (servos e CEs) | ✅ pronta |
| 2 | Capabilities + busca por skill | pendente |
| 3 | Calculadora + testes | pendente |
| 4 | MCP server | pendente |
| 5 | Condicionais de estado, comparação, templates | pendente |

## Começando

```bash
npm install
npm run data:all     # baixa ~86 MB, gera public/data/, valida
npm run dev          # http://localhost:5173
```

Depois disso `public/data/` tem 466 servos, 2.149 Craft Essences e 28 Mystic Codes
no modelo canônico (10,4 MB).

### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento. |
| `npm run build` | Typecheck + build de produção em `dist/` (com `404.html`). |
| `npm run preview` | Serve o `dist/` para conferir o build. |
| `npm test` | 31 testes: motor de busca + renderização da tela. |
| `npm run data:check` | O que mudou no Atlas? Não baixa nada (custa alguns KB). |
| `npm run data:sync` | Baixa só o que mudou (GET condicional, `304` no resto). |
| `npm run data:build` | `raw/` → `public/data/`. |
| `npm run data:validate` | Confere a saída contra 42 valores conhecidos do jogo. |
| `npm run data:all` | Os três de dados em sequência. |
| `npm run typecheck` | `tsc --noEmit`. |

## A busca

Filtros vivem na **query string**, não no estado do React — link compartilhável,
botão voltar funcionando, e os mesmos parâmetros viram a assinatura da tool do
MCP na fase 4.

```
/?kind=servant&class=archer&rarity=5&np=aoe&sort=atk&dir=desc
/?kind=equip&cat=combat&q=kaleidoscope
```

Servos filtram por raridade, classe, atributo, alvo do NP (ST/AoE/support), card
do NP, welfare e traits; CEs por raridade, categoria (combate/farm) e origem.
Busca textual cobre nome, apelido curado e `collectionNo`, ignorando acentos —
`scathach` acha *Scáthach*, `auo` acha *Gilgamesh*.

As contagens de cada faceta são calculadas **ignorando a própria dimensão**: com
"saber" marcado, você continua vendo quantos archers existem para trocar o filtro.

## Estrutura

```
src/
  core/          modelo canônico e regras puras — sem I/O, sem framework
    model.ts       os tipos que todo o resto consome
    units.ts       conversão de unidades do Atlas (4 divisores diferentes)
    search.ts      motor de busca: filtro, ordenação, contagem de facetas
  ingest/        raw -> canônico. O ÚNICO lugar que conhece o formato do Atlas
    sources.ts     lista de arquivos e manifest
    sync.ts        download incremental
    atlas.ts       tipos do formato bruto
    transform.ts   tradução para o canônico
    build.ts       geração dos artefatos
    validate.ts    verificação contra valores conhecidos
  ui/            React; casca fina sobre core/
    main.tsx       rotas
    SearchPage.tsx listagem, facetas
    DetailPages.tsx servo e craft essence
    useFilters.ts  filtros <-> query string
    data.ts        carregamento dos artefatos
data/
  aliases.json   apelidos curados à mão (AUO, Skadi, Mashu...)
raw/             dumps baixados (gitignored, exceto o manifest)
public/data/     artefatos de build (gitignored, reconstruíveis)
dist/            build de produção (gitignored)
docs/
```

**Regra invariante:** nada acima de `ingest/` conhece o formato do Atlas. Se a
API mudar um campo, conserta-se em um lugar só.

## Documentação

| Documento | Para quê |
|---|---|
| [`PLANO.md`](PLANO.md) | 18 decisões com justificativa, 14 riscos com mitigação, arquitetura, fases |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Modelo canônico campo a campo, glossário de unidades, structs da calculadora |
| [`docs/DATA.md`](docs/DATA.md) | De onde vêm os dados, **como atualizar**, armadilhas conhecidas |
| [`damage_formula.txt`](damage_formula.txt) | A fórmula de dano da comunidade (fonte da fase 3) |

Se você herdou este projeto: comece pelo `PLANO.md`. Ele registra *por que* cada
escolha foi feita, o que evita refazer decisões já resolvidas — em particular a de
não self-hostar a API do Atlas.

## Fonte dos dados

Atlas Academy, região JP com nomes em inglês. Projeto comunitário, sem SLA — por
isso os dados são baixados uma vez e processados localmente, não consultados em
runtime. Detalhes e política de atualização em [`docs/DATA.md`](docs/DATA.md).
