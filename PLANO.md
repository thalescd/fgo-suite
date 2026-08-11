# Projeto FGO — Plano

Documento de design. Ainda não implementado. Rascunho para iteração.

---

## 1. Objetivo

Três entregas sobre a mesma base de dados:

1. **Busca** — catálogo filtrável de servos, Craft Essences e Mystic Codes, para pessoas.
2. **Acesso por LLM** — a mesma informação consumível por um assistente sem grep em arquivo de 88 MB.
3. **Calculadora de dano** — usável pela pessoa na tela e por um LLM como ferramenta.

Insight que organiza tudo: **(2) e (3) são a mesma entrega** — um MCP server expondo as funções que a UI de (1) já usa. Uma lógica, três cascas.

---

## 2. Decisões travadas

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Região JP com `_lang_en`** | Conteúdo completo (~2 anos à frente de NA), nomes em inglês. Confirmado: todos os exports necessários têm variante `_lang_en`. |
| D2 | **Site estático** | Sem backend, sem banco, deploy trivial. Os dados são pré-processados em build. |
| D3 | **Escopo: servos + CEs + Mystic Codes** | Todos entram em busca *e* na calculadora. |
| D4 | **Fórmula: `damage_formula.txt`** | Canônica da comunidade. Validada campo a campo contra os dumps (§5). |
| D5 | **Fonte: Atlas Academy export files** | Não self-hostar a API. Ver §6. |
| D6 | **CEs filtradas por efeito, não por flag** | Descarta as inertes. Regra derivada, se mantém sozinha. Ver §4.1. |
| D7 | **Mystic Codes na calculadora junto com CEs (fase 5)** | MC, CE e skill de servo usam o mesmo resolvedor de buff. Fazer depois do mapeamento buff→slot validado na fase 3. |
| D8 | **TypeScript; React + Vite só na UI** | `core/`, `ingest/` e `mcp/` sem framework. Ver §3.1. |
| D9 | **Preset `padrão` definido** | Nível natural máximo, 1000 fou, NP por raridade/welfare. Ver §4.2. |
| D10 | **Append passives no schema, fora do cálculo por default** | Só entram se o usuário especificar. Ver §4.2. |
| D11 | **Class board ignorado na v1** | Bônus de status do conteúdo novo. `nice_class_board.json` não é ingerido. |
| D12 | **Calculadora recebe `BuffStack`, não `servo + skills`** | Skills próprias, CE, MC e servos de suporte alimentam a mesma estrutura. Ver §5.1. |
| D13 | **Templates de suporte são listas de referência** | Nunca valores literais — sobrevivem a rebalanceamento. Ver §5.2. |
| D14 | **Condições de trait entram na v1** | Revisão do escopo anterior: atacante e inimigo são structs explícitos, comparar trait é trivial. Só condições de *estado* (HP, contagem de buff, turno) ficam adiadas. |
| D15 | **Classe e atributo do inimigo geram traits automaticamente** | `saber` → `classSaber`, `human` → `attributeHuman`. Nunca checkbox manual. Ver §5.4. |
| D16 | **Lista de traits do inimigo gerada no build** | 91 traits de identidade, ordenados por frequência de uso. Servo novo traz o trait dele sem edição manual. |
| D17 | **MLB de CE é input do usuário** | `condLimitCount` `0`/`4` separa os dois conjuntos de efeito. Ver R13. |
| D18 | **`rollMode` selecionável (`min`/`avg`/`max`/`range`)** | Controla **só** o `randomModifier`. Buffs com RNG de ativação não são filtrados — quem compõe o `BuffStack` decide. Chance é informativa. Ver §5.6. |

### Volume real (medido)

| Entidade | Qtd |
|---|---:|
| Servos jogáveis (`type` = normal/heroine) | **462** |
| Craft Essences | **2.685** |
| Mystic Codes | **28** |

Cabe folgado num site estático. O índice de busca inteiro roda em memória no browser — sem paginação server-side, sem Elastic, sem nada.

---

## 3. Arquitetura

```
  [ UI estática ]          [ MCP server ]        ← cascas finas
          \                      /
           \                    /
       [ núcleo: busca + calculadora ]           ← funções puras, sem I/O
                     |
       [ modelo canônico + capabilities ]        ← schema NOSSO, não o do Atlas
                     |
       [ raw/ — dumps do Atlas + manifest ]      ← imutável, gitignored
```

**Regra invariante:** nada acima da camada `raw/` conhece o formato do Atlas. Campo do Atlas mudou → conserta em um lugar só.

### Layout

```
raw/                        # gitignored — dumps baixados
  JP/*.json
  manifest.json             # etag/hash/tamanho/data por arquivo
src/
  ingest/                   # raw -> canônico  (roda em build)
  core/
    model.ts                # tipos do modelo canônico
    search.ts               # filtros, função pura
    damage.ts               # calculadora, função pura
    capabilities.ts         # (funcType,buffType,target) -> tags
  mcp/                      # servidor MCP, casca sobre core/
  ui/                       # site
public/data/                # artefatos de build, servidos estáticos
  index.json                # todos os servos+CEs, compacto
  servant/{id}.json
  equip/{id}.json
  constants.json
  meta.json                 # versão dos dados, data do sync
docs/
```

### 3.1 Stack

**TypeScript em tudo.** Não por gosto: a calculadora precisa rodar **no browser** (site estático, sem backend) **e** no **MCP server** (Node). Em TS é um arquivo só, consumido pelos dois. Qualquer outra escolha significa escrever a fórmula duas vezes — e fórmula duplicada é fórmula que diverge em silêncio.

**Framework só na UI.** As outras três camadas são TS puro:

| Camada | Dependências |
|---|---|
| `core/` | **nenhuma** — funções puras, sem I/O |
| `ingest/` | nenhuma; roda com `tsx` |
| `mcp/` | só `@modelcontextprotocol/sdk` |
| `ui/` | React + Vite |

| Pacote | Papel |
|---|---|
| `vite` | build + dev server |
| `react` | UI |
| `typescript` | tudo |
| `vitest` | testes da calculadora — **obrigatório**, ver R4 |
| `tsx` | executar scripts de ingestão |
| `@modelcontextprotocol/sdk` | servidor MCP |

Sem gerenciador de estado, sem React Query (não há servidor), sem biblioteca de componentes. Tailwind só se e quando incomodar.

#### Por que não vanilla

A busca não justificaria framework — filtrar 3.000 itens em memória é trivial. **A calculadora justifica.** São ~15 inputs interdependentes (servo, nível, NP level, fous, CE, MC, skills ativas, classe/atributo/traits do inimigo, posição do card, crit, overkill) que recalculam o resultado e se habilitam entre si. É o problema de sincronização de estado que framework resolve; fazer à mão é escrever um framework ruim no meio do projeto — e é o código que fica ilegível pra quem herdar.

Entre frameworks, React não é o mais enxuto (Svelte gera menos código), mas é o mais **entregável**: qualquer pessoa consegue ler. Dado o objetivo de o projeto sobreviver ao autor parar de mexer nele, isso pesa mais que economizar boilerplate.

#### Convenções de site estático

- **Rotas:** URLs limpas (`/servant/150`) via cópia de `index.html` para `404.html` (padrão GitHub Pages). Evita hash routing.
- **Filtros vivem na query string** (`?class=archer&rarity=5&np=aoe`), não no estado do React. Link compartilhável, botão voltar funciona, e — o principal — **os parâmetros do URL são a assinatura da tool do MCP**. UI e servidor falam a mesma linguagem de filtro em vez de divergir.

---

## 4. Modelo canônico (esboço)

O ponto é traduzir jargão interno em algo legível. Comparação:

```jsonc
// ATLAS (cru)                          // CANÔNICO (nosso)
{ "card": "2",                          { "npCard": "buster",
  "effectFlags": ["attackEnemyAll"],      "npTarget": "aoe",
  "svals": [{"Value": 4000}, ...],        "npMultiplier": [400,500,550,575,600],  // %
  "npDistribution": [16,33,51],           "npHits": 3,
  "functions": [{                         "capabilities": ["np_charge_self",
    "funcType": "gainNp",                                  "atk_up_party"]
    "funcTargetType": "self" }] }       }
```

Regras do modelo:

- **Códigos resolvidos.** `"buster"`, nunca `"2"`. (Mapa: `1`=arts, `2`=buster, `3`=quick, `4`=extra.)
- **Unidades normalizadas.** Percentual como percentual. No Atlas, `Value: 4000` = 400%, `Rate: 1000` = 100% de chance, `Count: -1` = ilimitado. Isso vai documentado em `docs/SCHEMA.md`.
- **Documentos autocontidos.** Sem IDs pendurados que exigem um segundo lookup.
- **Tabela de apelidos.** `alias -> id`. Crítico: a comunidade diz *Castoria*, *Waver*, *Skadi*, *Koyanskaya* — nomes que não existem no dado. Sem isso, toda pergunta em linguagem natural falha na primeira etapa.
- **NP ativo resolvido.** Artoria tem 2 NPs, Mash tem 5, Space Ishtar tem 3 simultâneos (um por card type). Regra: maior `priority` vira o default; os demais vão para `npAlternatives[]` com o motivo (`condQuestId`). **Sem essa regra explícita, a calculadora pega o NP errado e erra com confiança total.**

### 4.1 Filtro de Craft Essences — por efeito, não por origem

Das 2.685 CEs, boa parte não faz nada. Mas o critério **não** deve ser a flag de origem: é frágil (o Atlas adiciona flag nova a cada tipo de evento) e erra casos importantes — as 462 CEs `svtEquipFriendShip` são as **bond CEs**, que estão entre as mais fortes do jogo. Cortar por flag arriscaria perder isso.

Critério correto: **classificar pelo `funcType` real das skills.**

| Classe | Qtd | Regra | Destino |
|---|---:|---|---|
| **combate** | 1.310 | tem ao menos um `funcType` que não é de farm | ingerir, entra na calculadora |
| **farm** | 839 | só tem `eventDropUp`, `expUp`, `friendPointUp`, `qpDropUp`… | ingerir, busca apenas (útil pra farm, irrelevante pra dano) |
| **inerte** | 536 | nenhum `funcType`, ou só `none` | **descartar na ingestão** |

O que cai fora, verificado:

```
svtEquipChocolate     470   -> todas com funcType "none" — efeito zero
svtEquipExp            42   -> todas "none" — fodder de level de CE
svtEquipEventReward    24   -> "none", pegas de brinde pela regra
```

A regra por efeito pega 24 CEs inertes a mais que o corte por flag teria deixado passar, e **preserva as 462 bond CEs** (todas classificadas como combate). Sendo derivada, não precisa de manutenção quando o Atlas inventar uma flag nova.

### 4.2 Preset `padrão`

Toda pergunta de dano é subdeterminada (§5c). Este é o conjunto default; qualquer resposta devolve no bloco `assumptions` o que usou.

| Parâmetro | Default | Origem |
|---|---|---|
| Nível | `lvMax` do servo (nível natural máximo, sem grail) | campo `lvMax` |
| ATK | `atkGrowth[lvMax - 1]` | **nunca `atkMax`** (ver R7) |
| Fou | **1000** (ATK plano somado) | fixo |
| NP level | **5** se `rarity <= 3` **ou** welfare; **1** se 4★/5★ | ver regra abaixo |
| Skills | nível 10, todas ativas | `svals[9]` |
| Append passives | **nível 0 (desligadas)** | só se o usuário especificar |
| Craft Essence | nenhuma | — |
| Mystic Code | nenhum | — |
| Inimigo | classe/atributo neutros, sem traits | struct explícito |
| Grail / class board | não aplicados | D11 |

`lvMax` por raridade, verificado: `0★=65 · 1★=60 · 2★=65 · 3★=70 · 4★=80 · 5★=90`.

#### Detecção de welfare

`flag == "ignoreCombineLimitSpecial"` marca os servos welfare (recompensa de evento) — verificado nome a nome. Em `nice_servant`: **57** (56× 4★ + 1× 5★).

**A flag tem precedência sobre a raridade:** existe um welfare 5★ (Solomon, Pretender) que sob a regra de raridade cairia errado em NP1.

Casos de borda cobertos pela formulação `rarity <= 3 || welfare`:
- **Aŋra Mainiiu** é `rarity: 0` (único) → NP5. Correto, é de evento.
- **Mash Kyrielight** é `rarity: 4` em `nice_servant` → NP1. Inconsequente: o NP dela é `support`, sem `damageMultiplier`.

> ⚠️ **`basic_servant` e `nice_servant` divergem** — o basic diz 56 welfare e Mash `rarity: 3`; o nice diz 57 e `rarity: 4`. O projeto ingere o **nice**. Conferências feitas contra o basic vão discordar; ver `docs/DATA.md`.

### 4.3 Conteúdo do `index.json`

Define o que é filtrável sem abrir o detalhe do servo.

| Campo | Uso |
|---|---|
| `id`, `collectionNo`, `displayName`, `face` | identidade e render da lista |
| `rarity`, `className`, `attribute` | filtro |
| `npTarget` (st/aoe/support), `npCard` | filtro |
| `traits[]` (id + name) | filtro |
| `capabilities[]` | filtro |
| `isWelfare` | filtro |
| `atkAtDefault`, `hpAtDefault` | **ordenação apenas** — um número escalar, não o array de 120 |

Busca por faixa de ATK foi descartada; ordenar basta. Isso mantém o índice com um inteiro por servo em vez do array de crescimento, que fica só no detalhe.

### Capabilities — a camada que destrava a busca por skill

Ninguém busca por `addStateShort + upAtk + ptAll`. Busca por *"quem dá ATK buff em party"*. A tabela de tradução:

```
gainNp          + ptAll              -> np_charge_party
gainNp          + self               -> np_charge_self
addStateShort   + upAtk    + ptAll   -> atk_up_party
addState        + avoidance + self   -> evade_self
addStateShort   + upNpdamage + *     -> np_damage_up
```

Isto serve **os dois** objetivos: é o filtro de busca do item 1 **e** o mapeamento buff→slot da fórmula do item 3. Por isso não dá pra fazer a busca primeiro e a calculadora depois — é o mesmo trabalho.

MVP: **~25 tags** cobrindo charge de NP, buffs de ATK/card/NP damage, crit, evade/invuln, cura, cleanse, def down. O resto depois.

---

## 5. Calculadora

### A fórmula é 100% data-driven — validado

Cada constante do `damage_formula.txt` tem campo correspondente publicado. **Zero números mágicos no código:**

| Termo na fórmula | Fonte nos dumps | Valor conferido |
|---|---|---|
| `0.23` | `NiceConstant.ATTACK_RATE` | `230` |
| `firstCardBonus` = 0.5 | `NiceCard["2"]["1"].addAtk` | `500` |
| `cardDamageValue` Buster 150/180/210% | `NiceCard["2"][1..3].adjustAtk` | `1500 / 1800 / 2100` |
| `cardDamageValue` Quick 80/96/112% | `NiceCard["3"][1..3].adjustAtk` | `800 / 960 / 1120` |
| `criticalModifier` = 2 | `NiceConstant.CRITICAL_ATTACK_RATE` | `2000` |
| `extraCardModifier` = 2 / 3.5 | `EXTRA_ATTACK_RATE_SINGLE` / `_GRAND` | `2000 / 3500` |
| `randomModifier` 0.9–1.1 | `ATTACK_RATE_RANDOM_MIN` / `_MAX` | `900 / 1100` |
| `busterChainMod` = 0.2 | `NiceConstant.CHAINBONUS_BUSTER_RATE` | `200` |
| `classAtkBonus` | `NiceClassAttackRate.json` | saber 1000, archer 950, lancer 1050… |
| `triangleModifier` | `NiceClassRelation.json` | matriz 75×75 |
| `attributeModifier` | `NiceAttributeRelation.json` | matriz 5×5 |
| `npDamageMultiplier` | `functions[].svals[npLv-1].Value` | 4000 = 400% |

### O caso Beast — os dados já resolvem

Sua preocupação era que Beast depende do servo, não da classe. **Nos dados, cada Beast É uma classe própria.** `NiceClassRelation` tem 75 chaves, incluindo `beastI`, `beastII`, `beastIIIR`, `beastIIIL`, `beastIV`, `beastVI`, `beastVII`, `beastEresh`, `beastILost`, `beastUnknown` — cada uma com sua linha na matriz. Medido:

```
saber     -> beastI  = 1000      berserker -> beastI  = 1500
saber     -> beastVI =  500      berserker -> beastVI =  500
saber     -> beast   =  500      berserker -> beast   =  500
```

A variação por indivíduo está codificada como classe distinta. **Design:** a calculadora recebe a classe do inimigo como input explícito (incluindo as variantes Beast) e permite override manual da matriz — isso cobre inimigos com relação customizada sem precisar modelar dados de quest.

### O problema real não é a fórmula

**(a) Resolver o estado de buffs.** `"todas as skills ativas"` esconde a cadeia `skill(lv10) → functions[] → buffs[].type → svals[9].Value → qual slot?`. Buffs diferentes entram em pontos diferentes da multiplicação: `atkMod` e `npDamageMod` **não são intercambiáveis** — 30% de um ≠ 30% do outro. Errar isso produz um número plausível e errado, o pior tipo de bug.

**(b) Buffs condicionais.** Revisado (D14). Há dois tipos, com dificuldade muito diferente:

- **Condição de trait** — `ckSelfIndv` (restrição do lado do atacante, ex. "só em card Buster") e `ckOpIndv` (do lado do inimigo, ex. "só contra `human`"). **Entram na v1.** Atacante e inimigo são structs explícitos, então avaliar é comparação de conjunto. E não são opcionais: ver §5.3.
- **Condição de estado** — HP abaixo de X, contagem de buffs, número do turno. **Adiadas**, sinalizando explicitamente no bloco `assumptions` que foram ignoradas.

`funcType` dedicados a super-efetivo: `damageNpIndividual` (bônus por trait), `damageNpPierce` (ignora defesa).

**(c) A pergunta é subdeterminada.** *"Quem dá mais dano, X ou Y?"* não tem resposta sem classe/atributo/traits do inimigo, nível, fous, CE, Mystic Code, posição do card, overkill. Trocar só a classe do inimigo inverte o ranking. Duas mitigações:

- **Presets nomeados.** `"neutro"` = lv100, 1000 fou, sem CE, inimigo neutro, NP solo.
- **Toda resposta devolve um bloco `assumptions`** com o que usou. É o que permite responder *"X dá 20% mais, assumindo inimigo neutro e NP1"* em vez de cuspir um número solto — e o que separa ferramenta confiável de alucinação convincente.

**(d) Restrição estrutural.** `damage.ts` é função pura sobre um struct explícito. Não lê banco, não toca UI. Três consumidores (site, MCP, testes) e é a única forma de ter teste de regressão com valores conhecidos. Se nascer dentro de um componente de UI, não desgruda mais.

### 5.1 `BuffStack` — a estrutura central

A calculadora **não** recebe `servo + skills`. Recebe `servo + BuffStack`: uma lista de buffs já resolvidos, vindos de qualquer fonte, todos no mesmo formato.

```
skills próprias   ┐
Craft Essence     ├──→  BuffStack  ──→  damage.ts
Mystic Code       │
servos de suporte ┘
```

Cada entrada carrega origem (`source`), para a UI e o bloco `assumptions` conseguirem explicar de onde veio cada número. Um buff de suporte é o mesmo tipo de objeto que um buff próprio — é isso que faz o recurso de template (§5.2) sair quase de graça.

**Filtro de alcance.** Nem todo buff de um suporte chega ao DPS. Resolver por `funcTargetType`:

| `funcTargetType` | Chega ao DPS? |
|---|---|
| `ptAll` | sim |
| `ptOne`, `ptOneOther` | sim, se apontado para ele (escolha do usuário) |
| `self` | **não** — fica no suporte |
| `ptSelfAnotherFirst` | alvo específico, resolver caso a caso |

Exemplo real: na skill 2 da Koyanskaya of Light, `gainStar` e `upCriticalrate` são `self` e **não** transferem; os `upDamage` são `ptOne` e transferem.

**Empilhamento.** Buffs do mesmo tipo somam-se aditivamente (conforme `damage_formula.txt`), inclusive vindos de duas cópias do mesmo suporte.

### 5.2 Templates de suporte

Um template é uma **lista de referências**, nunca valores literais:

```jsonc
{ "id": "double-koyan-light",
  "name": "2× Koyanskaya of Light",
  "supports": [
    { "servantId": 314, "skills": [2, 3], "targetsDps": true },
    { "servantId": 314, "skills": [2, 3], "targetsDps": true }
  ] }
```

Referência em vez de valor porque o template continua correto quando o jogo rebalancear o suporte — um bundle de números literais apodrece em silêncio.

Dois níveis: templates curados versionados no repo (as composições clássicas) e templates ad hoc montados na UI, que vivem na query string e viram link compartilhável (§3.1).

### 5.3 Por que as condições de trait não são opcionais

Verificado na Koyanskaya of Light, skill 3:

```
upCommandall      +50%   ckSelfIndv: [cardBuster]
upCriticaldamage  +50%   ckSelfIndv: [cardBuster]
upStarweight   +5000%    ckSelfIndv: [cardBuster]
upCriticalrate    +30%   ckSelfIndv: [cardBuster]
```

Não existe "buff de Buster" como tipo próprio: é `upCommandall` genérico **mais** uma restrição em `ckSelfIndv`. Guardar só `(funcType, buffType, valor)` faria o +50% dela ser aplicado a um NP Arts — 50% de erro, sem nenhum sintoma.

Logo, todo registro de efeito no modelo canônico **precisa** carregar:

| Campo | Papel |
|---|---|
| `ckSelfIndv` | restrição do lado do atacante (card, classe, trait própria) |
| `ckOpIndv` | restrição do lado do inimigo (trait, atributo) |
| `functvals` | condições adicionais da função |

Na skill 2 da mesma servo: `upDamage +50%` com `ckOpIndv: [human]` e outro `+50%` com `ckOpIndv: [attributeHuman]`. **Metade do valor dela só existe contra alvos humanos** — o que significa que comparar dois DPS sob o mesmo suporte pode inverter conforme o inimigo. A UI de comparação tem que manter o inimigo visível, senão o número engana.

### 5.4 Struct do inimigo

Opcional na UI, mas quando preenchido determina quais bônus valem.

```jsonc
{ "class":     "saber",            // uma das 75 chaves de NiceClassRelation
  "attribute": "human",            // human | sky | earth | star | beast
  "traits":    [ /* ids */ ],      // identidade, escolha do usuário
  "defMod": 0, "specialDefMod": 0
}
```

#### Regra crítica: classe e atributo geram traits

Um servo carrega `classSaber` e `attributeEarth` dentro da própria lista de `traits`. O mesmo vale para o inimigo: **escolher a classe tem de injetar o trait correspondente automaticamente.**

```
class: "saber"      ->  injeta trait  classSaber       (71 efeitos checam)
attribute: "human"  ->  injeta trait  attributeHuman   (16 efeitos checam)
```

Sem essa expansão, buffs anti-classe e anti-atributo falham em silêncio. E **não** pode ser checkbox manual, senão o usuário consegue declarar um inimigo Saber sem o trait `classSaber`.

#### Armadilha: "humano" são cinco traits distintos

| Trait | Efeitos que checam | Significado |
|---|---:|---|
| `attributeHuman` | 16 | o **atributo** Humano |
| `livingHuman` | 16 | humano vivo (exclui undead) |
| `humanoid` | 9 | forma humanoide |
| `human` | 5 | trait "human" |
| `hominidaeServant` | 2 | servo hominídeo |

A Koyanskaya of Light usa `human` **e** `attributeHuman` em buffs separados, +50% cada. Tratá-los como sinônimo erra nos dois sentidos. Regra: **nunca normalizar traits por semelhança de nome — o id é a identidade** (reforça R10).

#### Dimensionamento do painel

Medido sobre todos os efeitos de todos os servos:

| Namespace | Distintos | Tratamento na UI |
|---|---:|---|
| Traits de identidade (`demonic`, `divine`, `dragon`, `genderMale`, `alignment*`…) | **91** | checkbox; top ~25 visíveis, resto em busca |
| Restrições do lado do atacante (`ckSelfIndv`) | **17** | nenhum — 96% são tipo de card, resolvido pelo card usado |
| Condições de estado (`buffGuts`, `buffEvade`, `buffNegativeEffect`…) | — | fora da v1 (D14) |

A cauda dos 91 é one-off de servo específico (`robinCounter`, `kuonjiAliceHasSkill3`, `yuMeiren`). A lista deve ser **gerada no build a partir dos dados**, ordenada por frequência — assim servo novo traz o trait dele sem edição manual.

**Refinamento (fase 5):** escolhidos o DPS e os suportes, dá para destacar quais traits *aquela* composição realmente checa. Reduz 91 checkboxes a uns 4 relevantes.

### 5.6 Modos de rolagem

O `randomModifier` (0.9–1.1) não é ruído a esconder — é escolha do usuário, porque cada valor responde uma pergunta diferente.

| Modo | Random | Pergunta que responde |
|---|---|---|
| `min` | 0.9 | "mata mesmo no pior dado?" — planejamento de farm |
| `avg` | 1.0 | "quanto rende tipicamente?" — **default** |
| `max` | 1.1 | "qual o teto?" |
| `range` | os três | mostra o intervalo |

**`rollMode` controla apenas o `randomModifier`.** Não mexe em quais buffs estão ativos: isso é composição do `BuffStack` (§5.1), decisão do usuário.

Skills com RNG de ativação (Imperial Privilege da Nero a 60%, Inherent Wisdom do Tesla a 80% — 27 de 1.858 efeitos de dano, 1,5%) **não são filtradas**. Quem monta o stack sabe o risco que está tomando; a calculadora não decide por ele. A chance aparece na UI ao lado do toggle e em `assumptions.uncertainBuffs`, para registro — o número não muda, mas quem lê o resultado (inclusive via MCP) sabe qual premissa foi assumida.

> ⚠️ **Validar na fase 3:** se o `randomModifier` é sorteado por **hit** ou por **card**. Se por card, `0.9` é o piso exato; se por hit, o piso prático de um NP multi-hit é maior. Nos dois casos `0.9` é um limite inferior válido, apenas possivelmente conservador. Especificação em `docs/SCHEMA.md` §4.4.

### 5.7 Modo comparação

Comparar N servos sob o mesmo `BuffStack` e o mesmo inimigo, resultados lado a lado.

**Requisito não óbvio: o `randomModifier` tem de ser o mesmo nos dois lados.** A fórmula sorteia 0.9–1.1; com o sorteio ativo, dois servos não são comparáveis — a diferença exibida seria ruído.

Isso **não** significa travar em 1.0: significa que o `rollMode` (§5.6) é global à comparação, não por servo. Comparar dois DPS em `guaranteed` é tão legítimo quanto em `avg` — e responde uma pergunta diferente ("qual garante o kill?" vs "qual rende mais em média?").

Além disso, na comparação o inimigo e o `BuffStack` ficam travados e só o DPS varia — caso contrário não é comparação, são dois cálculos distintos lado a lado.

---

## 6. Atualização incremental

### Mecanismo — testado e funciona

Os exports do Atlas respondem a GET condicional:

```
ETag: "dkki7hvbf12heqqbf"
Last-Modified: Sun, 09 Aug 2026 15:04:45 GMT
Accept-Ranges: bytes

If-None-Match: "dkki7hvbf12heqqbf"  ->  HTTP 304   (download inteiro economizado)
```

Mais o endpoint `/info` (~1 KB), que dá hash + timestamp do gamedata por região:

```json
{"JP": {"hash": "489221", "timestamp": 1786287664}, ...}
```

### Fluxo

`raw/manifest.json` guarda, por arquivo: `etag`, `last_modified`, `bytes`, `sha256`, `synced_at` — mais o `hash`/`timestamp` do `/info` no momento do sync.

| Comando | O que faz |
|---|---|
| `data:check` | Bate no `/info` + HEAD em cada arquivo. **Não baixa nada.** Reporta o que mudou e quando foi o último sync. |
| `data:sync` | GET condicional por arquivo. Só os `200` são regravados; `304` fica como está. Atualiza o manifest. |
| `data:build` | `raw/` → `public/data/`. Só roda se o manifest mudou (ou com `--force`). |

Custo típico de um check: **alguns KB**. Sync sem mudanças: **zero bytes de payload**.

`public/data/meta.json` carrega a versão dos dados e a data do sync, exibida no rodapé do site — assim quem usa sabe se está olhando dado velho.

---

## 7. Documentação

Estabelecida desde o início, para o projeto sobreviver a você parar de mexer nele.

| Arquivo | Conteúdo | Pergunta que responde |
|---|---|---|
| `README.md` | O que é, como instalar, como rodar, como fazer deploy | "acabei de clonar, e agora?" |
| `docs/DATA.md` | Fonte, lista de arquivos, manifest, **procedimento de atualização**, o que fazer se o Atlas mudar de schema | "como atualizo isso?" |
| `docs/SCHEMA.md` | Modelo canônico campo a campo, **glossário de unidades**, mapa Atlas→canônico | "o que significa esse campo?" |
| `docs/DAMAGE.md` | Fórmula, tabela constante→fonte (§5), mapeamento buff→slot, **o que é ignorado na v1** | "de onde saiu esse número?" |
| `docs/CAPABILITIES.md` | Catálogo de tags e as regras que as geram | "como adiciono um filtro novo?" |
| **este documento** | Decisões (D1–D18) com justificativa, riscos (R1–R14) com mitigação | "por que foi feito assim?" |

O registro de decisões é o que mais economiza tempo de quem herdar o projeto — sem ele, a pessoa refaz as escolhas do zero (ou pior, tenta self-hostar a API).

> Um `docs/DECISIONS.md` separado foi cogitado e **descartado**: duplicaria a tabela de decisões acima, e dois registros da mesma coisa divergem. Este arquivo é a fonte única.

---

## 8. Fases

Cada fase entrega algo usável sozinho.

| Fase | Entrega | Destrava |
|---|---|---|
| **0** | Ingestão + manifest + modelo canônico + `DATA.md`/`SCHEMA.md` | tudo |
| **1** | Busca com filtros diretos (raridade, classe, NP ST/AoE/support, card do NP) | site já útil; valida o modelo |
| **2** | Capabilities (~25 tags) + busca por skill | item 1 completo **e** prepara a calculadora |
| **3** | `damage.ts` + presets + testes de regressão | núcleo puro |
| **4** | MCP server sobre 1–3 | itens 2 e 3 fechados |
| **5** | Buffs condicionais, CEs/MCs no cálculo, comparação lado a lado | refinamento |

---

## 9. Riscos e pendências

| # | Item | Nota |
|---|---|---|
| ~~R1~~ | ~~2.685 CEs, maioria ruído~~ | **Resolvido** — filtro por efeito (§4.1, D6). 536 inertes descartadas, 2.149 ingeridas em duas classes. |
| R2 | `_lang_en` tem fallback | **Risco menor que o estimado** — medido: só **1** dos 466 servos ainda tem nome em japonês (フランチェスカ・プレラーティ). Detectar e sinalizar, não quebrar. |
| R3 | Buff→slot é manual | 46 `funcType` e 129 `buffType` distintos no dump, mas só ~25 mapeiam para slot da fórmula; o resto é utilidade (NP gain, estrelas, imunidade) que serve à busca, não ao dano. Trabalho central da fase 2/3, documentar cada decisão em `DAMAGE.md`. |
| R4 | Validação da calculadora | Precisa de um conjunto de casos com valor conhecido (in-game ou calculadora da comunidade) antes de confiar. Definir na fase 3. |
| R5 | `nice_servant_lore` = 88 MB | Nunca vai pro browser nem pro git. Só `raw/` (gitignored) → build. |
| R6 | Disponibilidade NA | Opcional e barato (cruzar com `basic_servant` de NA, 0,5 MB) se um dia quiser marcar "não lançado em NA". Fora do escopo agora. |
| **R7** | **`atkMax` é uma armadilha** | `atkMax` é o ATK no nível *natural* máximo, não o máximo real. Artoria: `atkMax=11221` (lv90) mas `atkGrowth[119]=14418` (lv120) — **28% de diferença**. Usar `atkMax` subestimaria todo cálculo com grail, silenciosamente. **Mitigação: `atkMax` é banido do modelo canônico.** `atkGrowth` já traz 120 entradas (465/466 servos), então ATK em qualquer nível é `atkGrowth[lv-1]`. |
| **R8** | **Rank ups são a maioria, não exceção** | Medido: **245 de 466 servos (53%)** têm mais de uma versão da mesma skill, até **5 versões**. NPs: 190 servos têm 2, um tem 9. Sem regra explícita o ingestor pega versão arbitrária e a calculadora erra em metade do roster parecendo certa. **Mitigação: maior `priority` é a ativa; as outras vão para `previousVersions[]` com `condQuestId`.** |
| **R9** | **Nome não identifica servo** | **76 nomes colidem**; "Altria Pendragon" aparece 4×. E `collectionNo` **não é único** (4 servos têm `collectionNo = 0`). Quebra a busca por nome e qualquer pergunta em linguagem natural. **Mitigação: chave primária é o `id` interno; `collectionNo` só para exibição/URL quando > 0; `displayName` desambiguado (`Altria Pendragon (Saber, 5★)`) gerado no ingest; tabela de apelidos curada à mão.** |
| R10 | Traits com `name: "unknown"` | `unknown` é o `name` de trait mais frequente do dataset (ids sem tradução). Chavear traits por nome colapsaria traits distintos num só. **Mitigação: guardar sempre `id` + `name`.** |
| **R11** | **Restrição de card fica em `ckSelfIndv`** | Não existe buff type "Buster up": é `upCommandall` + `ckSelfIndv: [cardBuster]`. Omitir a condição aplica buff de Buster a NP Arts — 50% de erro sem sintoma. **Mitigação: `ckSelfIndv`/`ckOpIndv`/`functvals` são obrigatórios no registro de efeito (§5.3).** |
| R12 | Buffs não modelados | Aparecem tipos exóticos (ex. `commandattackAfterFunctionMainOnly`, que referencia outra função por id). **Mitigação: lista explícita de buff types suportados; qualquer coisa fora dela entra no bloco `assumptions` como "não modelado", nunca é ignorada em silêncio.** |
| **R13** | **CE tem dois conjuntos de efeito (base e MLB)** | `condLimitCount` `0` = base, `4` = max limit break. Kaleidoscope: 80% de NP base vs **100%** MLB. São 1.491 variantes MLB no dump. Pegar o conjunto errado erra sem sintoma. **Mitigação: `effectsBase` e `effectsMlb` separados no schema; MLB é input obrigatório da calculadora (D17).** |
| R14 | Divisores de unidade inconsistentes | O Atlas usa `/10` para percentuais de efeito, `/1000` para multiplicadores constantes e `/100` para ganho de NP — sem marcação no dado. **Mitigação: tabela em `docs/SCHEMA.md` §2; conversão acontece só na ingestão, o modelo canônico nunca carrega inteiro cru.** |
