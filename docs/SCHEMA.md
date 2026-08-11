# SCHEMA — Modelo Canônico

Define o modelo de dados interno do projeto. **Este é o contrato**: `ingest/` produz estas estruturas, e `core/`, `ui/` e `mcp/` consomem apenas elas. Nenhuma camada acima de `ingest/` conhece o formato do Atlas Academy.

Decisões e justificativas estão em [`../PLANO.md`](../PLANO.md); aqui ficam apenas os campos.

Notação: TypeScript, que é a implementação real.

---

## 1. Convenções globais

| Regra | Detalhe |
|---|---|
| **Chave primária é `id`** | O `id` interno do Atlas. `collectionNo` **não** serve: não é único e 4 servos têm `collectionNo = 0` — que são justamente as formas de combate (R9, §5.8). |
| **Códigos resolvidos** | `"buster"`, nunca `"2"`. Nenhum enum numérico sobrevive à ingestão. |
| **Percentuais como percentual** | `400` significa 400%. A conversão para fração acontece num único ponto dentro de `damage.ts`. |
| **Traits sempre `{id, name}`** | Nunca só o nome — `unknown` é o `name` mais frequente do dataset (R10). O `id` é a identidade. |
| **Documentos autocontidos** | Sem referências que exijam um segundo lookup para renderizar ou calcular. |
| **`atkMax` é proibido** | Não existe no modelo canônico. Ver R7 e §3.1. |

### 1.1 Versionamento

```ts
interface Meta {
  schemaVersion: string;      // semver DESTE documento; muda -> consumidores quebram de propósito
  gameDataHash: string;       // hash de /info da região no momento do sync
  gameDataTimestamp: number;  // epoch de /info
  region: "JP";
  syncedAt: string;           // ISO 8601
  counts: {
    servants: number;             // os que entram no índice (exclui formas de combate)
    combatForms: number;
    craftEssences: number;
    craftEssencesDropped: number;
    mysticCodes: number;
  };
}
```

Servido em `public/data/meta.json` e exibido no rodapé do site.

---

## 2. Glossário de unidades

**A parte mais fácil de errar do projeto.** O Atlas usa três divisores diferentes conforme o campo, sem nenhuma marcação.

| Família | Divisor | Campos | Exemplo |
|---|---:|---|---|
| **Percentuais de efeito** | `/10` | `svals[].Value`, `svals[].Rate`, `starGen`, `instantDeathChance` | `Value: 4000` → `400%` · `Rate: 1000` → `100%` · `Value: 90` → `9%` |
| **Multiplicadores constantes** | `/1000` | `NiceClassAttackRate`, `NiceClassRelation`, `NiceAttributeRelation`, `NiceCard.adjustAtk/addAtk`, `NiceConstant.*_RATE` | `ATTACK_RATE: 230` → `0.23` · `adjustAtk: 1500` → `1.5×` · `saber→lancer: 2000` → `2.0×` |
| **Ganho de NP** | `/100` | `npGain.*` | `86` → `0.86%` por hit — ⚠️ **validar na fase 3**, não usado na fórmula de dano |
| **Referência a id** | nenhum (`unknown`) | buffs da família `*Function`, `addIndividuality`, `fieldIndividuality` | `970928` é o **id de outra função**, não `97092.8%`. Vão crus e marcados `unknown` |

Outros campos com semântica não óbvia:

| Campo | Significado |
|---|---|
| `svals[].Turn` | duração em turnos; `-1` = permanente |
| `svals[].Count` | número de usos; `-1` = ilimitado |
| `npDistribution` | distribuição percentual do dano por hit; `[16,33,51]` = 3 hits somando 100 |
| `condLimitCount` | limit break exigido; `0` = CE base, `4` = MLB |
| `priority` | versão do efeito; maior vence (R8) |
| `condQuestId` | quest que desbloqueia a versão; `0` = disponível desde sempre |

**Após a ingestão, todos os valores já estão convertidos.** A exceção é deliberada: quando a unidade é desconhecida, o valor fica cru e `valueUnit` vira `unknown`, para a ignorância ficar visível em vez de virar um percentual falso.

### 2.1 Overcharge

Um NP tem **duas dimensões** de valor, e o Atlas guarda cada uma num campo diferente:

| Dimensão | Onde | Tamanho |
|---|---|---|
| Nível do NP (1–5) | índice dentro de `svals` | 5 |
| Overcharge (1–5) | `svals`, `svals2`, `svals3`, `svals4`, `svals5` | 5 |

`svals[i]` é *NP level i+1 no overcharge 1*. Os campos `svals2`–`svals5` existem em **100% das funções de NP** e trazem os mesmos níveis nos overcharges 2 a 5.

**24,3% das funções de NP variam com overcharge**, e as que mais variam são slots da fórmula de dano: `upCommandall` (95), `upNpdamage` (85), `downDefence` (77), `upAtk` (27). A Nero, por exemplo, reduz defesa em 20% no OC1 e **40% no OC5**.

No canônico isso vira `valuesByOvercharge: number[][] | null` — 5 linhas, `null` quando o efeito não escala (75,7% dos casos). A linha `[0]` é idêntica a `values`.

---

## 3. Entidades

### 3.1 `Servant`

```ts
interface Servant {
  // identidade
  id: number;                    // PK (ex. 500800)
  collectionNo: number;          // exibição/URL; 0 = sem número (não usar como chave)
  name: string;                  // inglês (lang_en)
  originalName: string;          // japonês
  displayName: string;           // DERIVADO, desambiguado: "Altria Pendragon (Saber, 5★)"
  aliases: string[];             // DERIVADO da tabela curada: ["Saberface", "Artoria"]

  // classificação
  className: ClassName;
  attribute: Attribute;
  rarity: 0 | 1 | 2 | 3 | 4 | 5;
  cost: number;
  traits: Trait[];               // inclui classX e attributeX (§5.4)
  isWelfare: boolean;            // DERIVADO: flag === "ignoreCombineLimitSpecial"

  // status
  lvMax: number;                 // nível natural máximo (0★=65 1★=60 2★=65 3★=70 4★=80 5★=90)
  atkGrowth: number[];           // 120 entradas — ATK em lv N = atkGrowth[N-1]
  hpGrowth: number[];
  starGen: number;               // %
  instantDeathChance: number;    // %

  // baralho
  cards: CardType[];             // 5 posições, ex. ["quick","arts","arts","buster","buster"]
  hitsDistribution: Record<CardType, number[]>;

  // efeitos
  skills: Skill[];               // versão ATIVA de cada num (§5.2)
  classPassive: Skill[];
  appendPassive: Skill[];        // 5; desligadas por default (D10)
  np: NoblePhantasm;             // versão ATIVA (§5.1)
  npAlternatives: NoblePhantasm[];

  // formas de combate (§5.8)
  combatFormOf: number | null;   // se preenchido, é forma transformada do servo com este id
  combatForms: number[];         // ids das formas de combate deste servo

  // derivado para busca
  capabilities: string[];        // ex. ["np_charge_party", "atk_up_party"]

  assets: { face: string; charaGraph: string[] };
}
```

> **`atkMax` não existe aqui de propósito.** No Atlas ele é o ATK no nível *natural* máximo, não o real: Artoria tem `atkMax = 11221` (lv90) mas `atkGrowth[119] = 14418` (lv120) — 28% de diferença. Um campo ausente não pode ser usado por engano (R7).

### 3.2 `NoblePhantasm`

```ts
interface NoblePhantasm {
  id: number;
  name: string;
  rank: string;                  // "A++", "EX"
  type: string;                  // "Anti-Fortress"
  card: CardType;                // RESOLVIDO de "1"|"2"|"3"|"4"
  target: "st" | "aoe" | "support";   // DERIVADO de effectFlags (§5.5)
  hits: number[];                // npDistribution
  damageMultiplier: number[] | null;  // 5 entradas (NP1..NP5), em % — null se support
  effects: Effect[];
  priority: number;
  condQuestId: number;           // 0 = base; >0 = upgrade condicionado
}
```

### 3.3 `Skill`

```ts
interface Skill {
  id: number;
  num: number;                   // 1|2|3 (0 em Mystic Code)
  name: string;
  detail: string;
  cooldown: number[];            // 10 entradas (skill lv 1..10)
  effects: Effect[];
  priority: number;
  condQuestId: number;
  previousVersions?: Skill[];    // rank ups substituídos (§5.2)
}
```

### 3.4 `Effect` — o registro central

Estrutura compartilhada por servo, CE e Mystic Code. **É onde a calculadora lê e onde as capabilities são derivadas.**

```ts
interface Effect {
  funcType: string;              // "addStateShort", "gainNp", "damageNp", ...
  target: TargetType;            // "self" | "ptAll" | "ptOne" | ...
  buffType: string | null;       // "upAtk", "upCommandall", ... (null se a func não usa buff)

  values: number[];              // por nível — 10 (skill), 5 (NP), 1 (CE); em NP é a linha de OC1
  valuesByOvercharge: number[][] | null;  // só NP, só quando escala: 5 linhas OC1..OC5 (§2.1)
  turns: number | null;          // -1 = permanente
  count: number | null;          // -1 = ilimitado
  chance: number;                // % (Rate/10)

  // CONDIÇÕES — obrigatórias, ver R11
  condSelf: Trait[];             // ckSelfIndv: restrição do lado do atacante (ex. cardBuster)
  condTarget: Trait[];           // ckOpIndv: restrição do lado do alvo (ex. human)
  condFunc: Trait[];             // functvals: condições adicionais da função

  supported: boolean;            // false => entra em `assumptions` como não modelado (R12)
}
```

> **`condSelf` não é opcional.** Não existe buff type "Buster Up" no FGO: é `upCommandall` **mais** `condSelf: [cardBuster]`. Omitir a condição aplicaria o +50% da Koyanskaya of Light num NP Arts — 50% de erro, sem nenhum sintoma (§5.3 do PLANO).

### 3.5 `CraftEssence`

```ts
interface CraftEssence {
  id: number;
  collectionNo: number;
  name: string;
  originalName: string;
  rarity: 1 | 2 | 3 | 4 | 5;
  cost: number;
  lvMax: number;                 // 1★=50 2★=55 3★=60 4★=80 5★=100
  atkGrowth: number[];           // lvMax entradas
  hpGrowth: number[];

  category: "combat" | "farm";   // inertes são descartadas na ingestão (D6)
  origin: string;                // flag original: "normal", "svtEquipEvent", ...

  effectsBase: Effect[];         // condLimitCount === 0
  effectsMlb: Effect[];          // condLimitCount === 4

  capabilities: string[];
  assets: { face: string; charaGraph: string };
}
```

> **MLB é input do usuário, não propriedade da CE.** Kaleidoscope dá 80% de NP em `effectsBase` e 100% em `effectsMlb`. São 1.491 variantes MLB no dump; escolher a lista errada erra em silêncio.

### 3.6 `MysticCode`

```ts
interface MysticCode {
  id: number;
  name: string;
  shortName: string;
  detail: string;
  maxLv: 10;                     // todos os 28 têm maxLv 10
  skills: Skill[];               // 3, com num 0 — ordem é a posição no array
  capabilities: string[];
  assets: { male: string; female: string };
}
```

### 3.7 `Trait` e enums

```ts
interface Trait { id: number; name: string; }   // name pode ser "unknown"

type CardType  = "arts" | "buster" | "quick" | "extra";
type Attribute = "human" | "sky" | "earth" | "star" | "beast";
type ClassName = "saber" | "archer" | ... ;      // 75 chaves de NiceClassRelation
type TargetType =
  | "self" | "ptAll" | "ptOne" | "ptOneOther" | "ptSelfAnotherFirst"
  | "enemy" | "enemyAll" | ... ;
```

---

## 4. Entrada e saída da calculadora

### 4.1 `DamageInput`

```ts
interface DamageInput {
  attacker: {
    servantId: number;
    level: number;               // default: servant.lvMax
    fou: number;                 // default: 1000 (ATK plano)
    npLevel: 1|2|3|4|5;          // default: §5.6
    appendLevels: [number, number, number, number, number];  // default: [0,0,0,0,0]
    ce?: { id: number; level: number; mlb: boolean };
    craftEssenceLevel?: number;
  };

  buffStack: BuffSource[];       // §4.2

  enemy: Enemy;                  // §4.3

  action: {
    kind: "np" | "card" | "extra";
    card?: CardType;
    position?: 1 | 2 | 3;        // posição na chain
    isCrit: boolean;
    busterChain: boolean;
    braveChain: boolean;
  };

  options: {
    rollMode: RollMode;
  };
}

type RollMode =
  | "min"     // random 0.9 — piso do dano
  | "avg"     // random 1.0 — default
  | "max"     // random 1.1 — teto
  | "range";  // calcula os três, devolve min/avg/max
```

`rollMode` controla **apenas** o `randomModifier`. Não mexe em quais buffs estão ativos — isso é composição do `BuffStack` (§4.2) e é decisão do usuário.

O caso de uso principal de `min` é planejamento de farm: saber se a comp mata com o pior dado possível.

> ⚠️ **A validar na fase 3:** se o `randomModifier` é sorteado **por hit** ou **por card**. Se por card, `0.9` é exatamente o piso. Se por hit, o piso prático de um NP multi-hit é maior. Em ambos os casos `0.9` é um limite inferior *válido* — apenas possivelmente conservador.

### 4.5 Chance de ativação é informativa, não decisória

**27 de 1.858 efeitos de dano em skills de servo (1,5%) têm chance < 100%** — Imperial Privilege da Nero (`upAtk` 60%), Inherent Wisdom do Tesla (`upNpdamage` 80%), Demonic Visage do Prince of Lan Ling (60%), Charisma of Rani da Lakshmi Bai (60%).

A calculadora **não** filtra por isso. Se o buff está no `BuffStack`, ele se aplica: incluir ou não uma skill de RNG é escolha do usuário, que conhece o próprio risco.

O que o `chance` faz:

1. **UI** — exibido ao lado do toggle da skill, para a escolha ser informada.
2. **`assumptions.uncertainBuffs`** — buffs ativos com `chance < 100` são listados no resultado.

O item 2 existe por causa do MCP: quando eu reporto um número, *"250k, assumindo Imperial Privilege (60%) ativa"* é honesto; `250k` sozinho esconde uma premissa que o usuário tomou de propósito mas que quem lê a resposta não conhece.

`chance >= 100` sempre aplica. Valores acima de `1000` no Atlas (`Rate: 5000`, 17 ocorrências) existem para vencer resistência a debuff — não são probabilidade real.

### 4.2 `BuffSource` e `BuffStack`

A calculadora **não** recebe "servo + skills". Recebe uma lista de fontes que resolvem para o mesmo tipo de objeto (D12).

```ts
type BuffSource =
  | { kind: "ownSkill";  skillNum: 1|2|3; level: number }
  | { kind: "append";    num: number; level: number }
  | { kind: "ce";        id: number; mlb: boolean }
  | { kind: "mysticCode"; id: number; skillIndex: number; level: number }
  | { kind: "support";   servantId: number; skills: number[]; skillLevel: number;
                         targetsAttacker: boolean };
```

Resolvidas em:

```ts
interface ResolvedBuff {
  effect: Effect;
  value: number;                 // já no nível certo
  source: string;                // "Koyanskaya of Light #2 / skill 3" — vai no assumptions
  applies: boolean;              // false se condSelf/condTarget não bateram
  reason?: string;               // por que não aplicou
}
```

Filtro de alcance para `kind: "support"` — só passam buffs que chegam ao atacante:

| `target` | Chega? |
|---|---|
| `ptAll` | sim |
| `ptOne`, `ptOneOther` | sim, se `targetsAttacker` |
| `self` | **não** (fica no suporte) |

Empilhamento: buffs do mesmo `buffType` somam-se aditivamente, inclusive vindos de duas cópias do mesmo suporte.

### 4.3 `Enemy`

```ts
interface Enemy {
  className: ClassName;
  attribute: Attribute;
  traits: Trait[];               // identidade, escolha do usuário
  defMod: number;                // %
  specialDefMod: number;         // %
}
```

> **Classe e atributo geram traits automaticamente** (D15). `className: "saber"` injeta `classSaber`; `attribute: "human"` injeta `attributeHuman`. Sem isso, 71 checagens anti-classe e 16 anti-atributo falham em silêncio. **Nunca expor esses traits como checkbox** — o usuário conseguiria declarar um Saber sem `classSaber`.
>
> **"Humano" são cinco traits distintos**: `attributeHuman` (16 efeitos), `livingHuman` (16), `humanoid` (9), `human` (5), `hominidaeServant` (2). A Koyanskaya of Light usa `human` **e** `attributeHuman` em buffs separados, +50% cada. Nunca normalizar traits por semelhança de nome.

### 4.4 `DamageResult`

```ts
interface DamageResult {
  min: number; avg: number; max: number;   // faixa do randomModifier
  perHit: number[];

  breakdown: {                   // cada termo da fórmula, para auditoria na UI
    servantAtk: number; npMultiplier: number; cardMod: number;
    classAtkBonus: number; triangleModifier: number; attributeModifier: number;
    atkMod: number; defMod: number; powerMod: number;
    critDamageMod: number; npDamageMod: number; superEffective: number;
    flatAdd: number;
  };

  assumptions: {                 // OBRIGATÓRIO — §5.3
    preset: string | null;
    rollMode: RollMode;
    resolved: string[];          // "NP1", "lv90", "1000 fou", "inimigo neutro"
    appliedBuffs: { source: string; buffType: string; value: number }[];
    skippedBuffs: { source: string; buffType: string; reason: string }[];  // condSelf/condTarget não bateram
    uncertainBuffs: { source: string; buffType: string; chance: number }[]; // ativos com chance < 100% (§4.5)
    unmodeled: string[];         // buff types com supported === false
  };
}
```

**`assumptions` nunca é opcional.** É o que permite responder *"X dá 20% mais, assumindo inimigo neutro e NP1"* em vez de cuspir um número solto — e o que impede que um resultado incompleto passe por completo.

---

## 5. Regras de resolução

Aplicadas na ingestão. Cada uma existe porque a alternativa produz erro silencioso.

### 5.1 NP ativo
190 servos têm 2 NPs, um tem 9. **Maior `priority` vira `np`**; o resto vai para `npAlternatives[]`, preservando `condQuestId`.

### 5.2 Rank ups de skill
**245 de 466 servos (53%)** têm mais de uma versão da mesma skill, até 5. Agrupar por `num`, **maior `priority` vence**, resto em `previousVersions[]`.

### 5.3 Nome e desambiguação
76 nomes colidem ("Altria Pendragon" ×4). `displayName = \`${name} (${className}, ${rarity}★)\``, com sufixo numérico se ainda colidir. `aliases[]` vem de `data/aliases.json`, curado à mão.

### 5.4 Traits derivados
Servos já trazem `classX`/`attributeX` em `traits`. O inimigo recebe os mesmos por derivação (§4.3). Ingestão não altera os do servo — apenas garante presença.

### 5.5 Alvo do NP
`effectFlags` → `target`: `attackEnemyOne` → `"st"`, `attackEnemyAll` → `"aoe"`, `support` → `"support"`. Verificado batendo 100% com `functions[].funcTargetType` em amostra.

### 5.6 NP level default
```
npLevel = (rarity <= 3 || isWelfare) ? 5 : 1
```
Welfare tem precedência sobre raridade: Solomon é welfare 5★ e cairia errado em NP1.

`flag === "ignoreCombineLimitSpecial"` marca **57** servos welfare em `nice_servant` (56× 4★ + Solomon 5★).

⚠️ **`basic_servant` e `nice_servant` divergem.** O basic reporta 56 welfare e `rarity: 3` para a Mash; o nice reporta 57 e `rarity: 4`. **O projeto ingere o `nice`** — qualquer conferência feita contra o basic vai discordar. Consequência prática: pela regra acima a Mash recebe NP1, o que é inconsequente porque o NP dela é `support` e não tem `damageMultiplier`.

### 5.8 Formas de combate

Servos que se transformam em batalha têm a forma transformada como **entrada
separada** no dump: Hyde (após o NP do Jekyll), a 2ª Aozaki Aoko, Flora, Prelati.

Regra: é forma de combate quem é alvo de um `transformServant` vindo de **outro**
servo **e** tem `collectionNo === 0`. Ptolemaîos e Mélusine também usam
`transformServant` mas apontam para si mesmos, então ficam de fora da regra.

As formas **continuam no modelo** (`servant/{id}.json`) porque os status são reais
e a calculadora vai precisar deles; só não entram no `index.json`, onde
apareceriam como uma segunda entrada do mesmo personagem. O caminho até elas é o
link na página do servo base.

Conferência: excluir as 4 dá 462 servos e 56 welfare — exatamente o recorte do
`basic_servant`.

### 5.7 Descarte de CEs
Classificar pelo `funcType` das skills: **combat** (1.310) e **farm** (839) são ingeridas; **inerte** (536 — todas com `funcType: "none"`) é descartada. Nunca cortar por flag de origem: as 462 `svtEquipFriendShip` são as bond CEs.

---

## 6. Mapa Atlas → canônico

| Atlas | Canônico | Transformação |
|---|---|---|
| `id` | `id` | — |
| `collectionNo` | `collectionNo` | mantido; **não vira chave** |
| `name` (lang_en) | `name` | — |
| — | `displayName` | derivado (§5.3) |
| `flag === "ignoreCombineLimitSpecial"` | `isWelfare` | booleano |
| `atkMax` | — | **descartado** (R7) |
| `atkGrowth` | `atkGrowth` | — |
| `cards: ["3","1",...]` | `cards: ["quick","arts",...]` | mapa 1=arts 2=buster 3=quick 4=extra |
| `noblePhantasm.card` | `np.card` | mesmo mapa |
| `noblePhantasm.effectFlags` | `np.target` | §5.5 |
| `noblePhantasm.npDistribution` | `np.hits` | — |
| `functions[].svals[].Value` | `effect.values[]` | `/10` |
| `functions[].svals[].Rate` | `effect.chance` | `/10` |
| `buffs[].ckSelfIndv` | `effect.condSelf` | — |
| `buffs[].ckOpIndv` | `effect.condTarget` | — |
| `functvals` | `effect.condFunc` | — |
| `skills[].condLimitCount` (CE) | `effectsBase` / `effectsMlb` | `0` / `4` |
| `NiceConstant.ATTACK_RATE` | `constants.attackRate` | `/1000` |
| `NiceClassRelation[a][b]` | `constants.classRelation` | `/1000` |

---

## 7. Fora do modelo (deliberadamente)

| Item | Motivo |
|---|---|
| `atkMax` | Armadilha (R7). |
| Class board | D11 — v1 ignora. |
| Dados de quest e inimigos reais | Inimigo é struct de input (§4.3), não entidade. |
| Command Codes | Não afetam dano de NP. |
| Bond CEs vinculadas ao servo | Entram como CE comum; o vínculo não é modelado. |
| Condições de estado (`buffGuts`, HP<X, turno) | D14 — reportadas em `assumptions.unmodeled`. |
| Costumes, valentine script, BGM | Sem uso nas três entregas. |

---

## 8. Artefatos de build

| Arquivo | Conteúdo |
|---|---|
| `meta.json` | §1.1 |
| `index.json` | Todos os servos e CEs, campos filtráveis (§4.3 do PLANO). `atkAtDefault` escalar para ordenação — **não** o array de 120. |
| `servant/{id}.json` | `Servant` completo |
| `equip/{id}.json` | `CraftEssence` completo |
| `mysticCodes.json` | Os 28, arquivo único |
| `constants.json` | Constantes da fórmula, já convertidas |
| `traits.json` | Os 89 traits de identidade, ordenados por frequência (D16) |

Ainda não gerados:

| Arquivo | Fase |
|---|---|
| `templates.json` | 5 — composições curadas de suporte (§5.2 do PLANO) |

`data/aliases.json` é **entrada**, não artefato: o build resolve os apelidos e os
grava dentro de cada `Servant` e da entrada do índice, para que os documentos
continuem autocontidos (§1). Não há um `aliases.json` de saída.
