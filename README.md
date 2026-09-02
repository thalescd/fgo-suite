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
| **2** | Capabilities + busca por skill | ✅ pronta |
| **3** | Calculadora: núcleo, testes e tela | ✅ pronta — **11 de 16 casos conferidos contra calculadora externa (R4)** |
| **4** | MCP server — busca e calculadora como tools | ✅ pronta |
| **5a** | CE e Mystic Code na query string, na tela e nas tools | ✅ pronta |
| **5b** | Suportes e templates de composição | pendente — núcleo pronto, falta a superfície |
| **5c** | Condições de estado (HP, contagem de buffs, turno) | pendente |
| **5d** | Comparação lado a lado | pendente |

Detalhe de cada uma em [`PLANO.md`](PLANO.md) §8.1.

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
| `npm test` | 196 testes: busca, renderização, a fórmula termo a termo, a tela e as tools do MCP. |
| `npm run data:check` | O que mudou no Atlas? Não baixa nada (custa alguns KB). |
| `npm run data:sync` | Baixa só o que mudou (GET condicional, `304` no resto). |
| `npm run data:build` | `raw/` → `public/data/`. |
| `npm run data:validate` | Confere a saída contra 88 valores conhecidos do jogo. |
| `npm run data:all` | Os três de dados em sequência. |
| `npm run mcp` | Sobe o servidor MCP solto, para depurar sem cliente. |
| `npm run damage:cases` | Casos de conferência da calculadora e o nosso número em cada um (R4). |
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

E há busca por **o que o servo faz** — 170 tags derivadas dos efeitos, com
filtro AND:

```
/?cap=buster_up_party,atk_up_party,np_charge_party   -> 13 servos
/?cap=np_charge_50_party                             -> 9 servos
```

Detalhes em [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md).

## A calculadora

Em `/calc`. O cenário inteiro também vive na query string, pelas mesmas razões:

```
/calc?s=100100&sk=1,2,3&ec=lancer&ea=sky        Artoria com as três skills vs lancer sky
/calc?s=201200&act=buster&pos=1&crit=1&roll=min crítico Buster em 1ª posição, dano garantido
```

Escolhe-se atacante, nível/fou/NP/overcharge, a ação (NP ou card, posição na
chain, crítico), quais skills estão ativas, e o inimigo — classe, atributo,
traits. O resultado vem com **min / média / max** e a auditoria junto: cada termo
da fórmula com o valor que assumiu, cada buff que entrou, e cada buff que **não**
entrou com o motivo. Foi lendo um desses motivos que o bug do card do NP
apareceu.

A fórmula da comunidade é de 2018 e o jogo andou: mecânicas mais novas entram
como exceção documentada. Duas até agora: a skill 3 do **Oberon**, que dobra os
buffs de dano de NP (R21), e a passiva da **Kiara**, que sobrescreve a matriz de
classe (R22).

Dezessete NPs somam dano por unidade de um trait acumulado — 〔Heroic King〕 no
próprio **Charlemagne**, 〔roman〕 no alvo do **Romulus**. São dois campos, porque
são contagens de entidades diferentes, e a tela só mostra o que o NP escolhido
usa (R27).

Sete servos batem mais forte machucados — Cú Chulainn, Leonidas, Passionlip,
Hijikata, Aśvatthāman e as duas Anne Bonny & Mary Read. O campo **Current HP**
controla isso (R25). No Leonidas e na Passionlip o buff vale *zero* com HP
cheio, e era assim que ele aparecia antes de ser lido.

**Craft Essence e Mystic Code entram no cálculo** (5a). Uma CE contribui com a
ATK **e** os efeitos na mesma declaração — o Black Grail é +2.400 de ATK *e*
+80% de dano de NP, nunca um ou outro. O MLB é caixa do usuário porque escolhe
um conjunto **diferente** de efeitos, não um mais forte (D17).

Um caso que o dado não resolve sozinho: CE de evento dá "ataque +X% **neste
evento**", e o dump não diz qual evento. Esse bônus é **recusado com o motivo à
vista** (R29) — a Golden Sumo quase triplicava o dano em qualquer luta.

Fora por enquanto: suportes (5b) e comparação lado a lado (5d).

**11 dos 16 casos do R4 estão conferidos** contra calculadora da comunidade —
33 números, reproduzidos exatamente. Isso prende a espinha multiplicativa inteira
e cinco mecânicas que nasceram de relato (R21–R24, R26).

Duas ressalvas continuam valendo. Os 5 casos que faltam são todos de **card**, e
a fonte usada só calcula NP. E conferir contra outra calculadora **não é** conferir
contra o jogo: as duas podem compartilhar a mesma convenção e errar juntas.
`npm run damage:cases` imprime cada cenário com o link que o reproduz. Ver
[`docs/VALIDATION.md`](docs/VALIDATION.md).

Detalhes em [`docs/DAMAGE.md`](docs/DAMAGE.md).

## Acesso por LLM

Servidor MCP sobre stdio, expondo os mesmos dados como tools tipadas. Serve para
o assistente **executar** a busca e a calculadora em vez de responder de memória
— que, para números de FGO, sai plausível e errado.

| Tool | |
|---|---|
| `search_servants` | os mesmos filtros de `?class=&rarity=&np=&cap=` |
| `get_servant` | detalhe curado: NPs, skills, passivas, traits |
| `calculate_damage` | os mesmos parâmetros de `/calc?…`, CE e Mystic Code inclusos, com a auditoria junto |
| `list_capabilities` | as 170 tags, para não chutar nome de filtro |

[`.mcp.json`](.mcp.json) está versionado: quem clonar e abrir no Claude Code já
tem o servidor registrado. Só precisa de `npm install` e `npm run data:build`.

Duas coisas que a tool devolve e um número sozinho não teria: `notCounted`, com
cada buff recusado **e o motivo**, e `viewInBrowser`, o link `/calc?…` que
reproduz o cenário na tela. A primeira é o que permite perceber que faltou marcar
uma skill em vez de aceitar um número baixo; a segunda é o que torna a resposta
conferível.

O servidor não reimplementa nada: monta a query string e chama o mesmo
`core/scenario.ts` que a tela usa. Um teste compara os dois caminhos e falha se
divergirem.

Detalhes em [`docs/MCP.md`](docs/MCP.md).

## Estrutura

```
src/
  core/          modelo canônico e regras puras — sem I/O, sem framework
    model.ts       os tipos que todo o resto consome
    units.ts       conversão de unidades do Atlas (4 divisores diferentes)
    search.ts      motor de busca: filtro, ordenação, contagem de facetas
    buffs.ts       tabela única: buff -> slot da fórmula + tag de busca
    capabilities.ts  tags derivadas (escopo, card, limiar)
    damage.ts      calculadora, função pura
    scenario.ts    cenário <-> query string <-> DamageInput (tela, MCP e validação)
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
    CalcPage.tsx   montagem do cenário de dano
    DamageReport.tsx resultado + auditoria dos termos e buffs
    useFilters.ts  filtros <-> query string
    data.ts        carregamento dos artefatos
  mcp/           servidor MCP; casca sobre core/, como a ui/
    server.ts      as tools e suas descrições — o que o assistente enxerga
    tools.ts       as tools sem transporte, para testar sem stdio
    store.ts       leitura de public/data/ no lado do Node
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
| [`PLANO.md`](PLANO.md) | 21 decisões com justificativa, 24 riscos com mitigação, arquitetura, fases |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Modelo canônico campo a campo, glossário de unidades, structs da calculadora |
| [`docs/DATA.md`](docs/DATA.md) | De onde vêm os dados, **como atualizar**, armadilhas conhecidas |
| [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md) | Tags de busca: formato, limiares, como adicionar |
| [`docs/DAMAGE.md`](docs/DAMAGE.md) | Fórmula, mapeamento buff→slot, sutilezas, estado da validação |
| [`docs/MCP.md`](docs/MCP.md) | As tools, como o assistente as descobre, e por que a descrição é interface |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | **Como conferir a calculadora contra o jogo** — os 16 casos e o procedimento |
| [`damage_formula.txt`](damage_formula.txt) | A fórmula de dano da comunidade (fonte da fase 3) |

Se você herdou este projeto: comece pelo `PLANO.md`. Ele registra *por que* cada
escolha foi feita, o que evita refazer decisões já resolvidas — em particular a de
não self-hostar a API do Atlas.

## Fonte dos dados

Atlas Academy, região JP com nomes em inglês. Projeto comunitário, sem SLA — por
isso os dados são baixados uma vez e processados localmente, não consultados em
runtime. Detalhes e política de atualização em [`docs/DATA.md`](docs/DATA.md).
