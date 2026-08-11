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
| 1 | Busca com filtros diretos | pendente |
| 2 | Capabilities + busca por skill | pendente |
| 3 | Calculadora + testes | pendente |
| 4 | MCP server | pendente |
| 5 | Condicionais de estado, comparação, templates | pendente |

## Começando

```bash
npm install
npm run data:all     # baixa ~86 MB, gera public/data/, valida
```

Depois disso `public/data/` tem 466 servos, 2.149 Craft Essences e 28 Mystic Codes
no modelo canônico (10,4 MB).

### Comandos

| Comando | O que faz |
|---|---|
| `npm run data:check` | O que mudou no Atlas? Não baixa nada (custa alguns KB). |
| `npm run data:sync` | Baixa só o que mudou (GET condicional, `304` no resto). |
| `npm run data:build` | `raw/` → `public/data/`. |
| `npm run data:validate` | Confere a saída contra 42 valores conhecidos do jogo. |
| `npm run data:all` | Os três últimos em sequência. |
| `npm run typecheck` | `tsc --noEmit`. |

## Estrutura

```
src/
  core/          modelo canônico e regras puras — sem I/O, sem framework
    model.ts       os tipos que todo o resto consome
    units.ts       conversão de unidades do Atlas (3 divisores diferentes)
  ingest/        raw -> canônico. O ÚNICO lugar que conhece o formato do Atlas
    sources.ts     lista de arquivos e manifest
    sync.ts        download incremental
    atlas.ts       tipos do formato bruto
    transform.ts   tradução para o canônico
    build.ts       geração dos artefatos
    validate.ts    verificação contra valores conhecidos
data/
  aliases.json   apelidos curados à mão (Castoria, Waver, Skadi...)
raw/             dumps baixados (gitignored, exceto o manifest)
public/data/     artefatos de build (gitignored, reconstruíveis)
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
