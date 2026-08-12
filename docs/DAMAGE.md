# DAMAGE — a calculadora

Implementação: [`src/core/damage.ts`](../src/core/damage.ts). Função pura, sem
I/O, sem React — o caller carrega os documentos e passa em `DamageData`.

Fonte da fórmula: [`../damage_formula.txt`](../damage_formula.txt), a canônica da
comunidade.

---

## 1. A fórmula

Os nomes dos termos no código são os **do arquivo original**, de propósito: a
conferência é linha a linha, sem tradução no meio.

```
dano = [ servantAtk
       * npDamageMultiplier
       * (firstCardBonus + cardDamageValue * (1 + cardMod))
       * classAtkBonus * triangleModifier * attributeModifier
       * randomModifier * ATTACK_RATE
       * (1 + atkMod - defMod)
       * criticalModifier * extraCardModifier
       * (1 - specialDefMod)
       * (1 + powerMod + selfDamageMod + critDamageMod·isCrit + npDamageMod·isNP)
       * (1 + (superEffectiveModifier - 1) · isSuperEffective) ]
       + dmgPlusAdd + selfDmgCutAdd + servantAtk · busterChainMod
```

**Nenhuma constante é literal no código.** Todas vêm de `constants.json`, gerado
dos dumps — se o jogo rebalancear, o valor muda no próximo `data:sync`.

| Termo | Fonte |
|---|---|
| `ATTACK_RATE` = 0.23 | `NiceConstant.ATTACK_RATE` |
| `criticalModifier` = 2 | `NiceConstant.CRITICAL_ATTACK_RATE` |
| `randomModifier` 0.9–1.1 | `ATTACK_RATE_RANDOM_MIN` / `_MAX` |
| `cardDamageValue`, `firstCardBonus` | `NiceCard[card][posição]` |
| `classAtkBonus` | `NiceClassAttackRate` |
| `triangleModifier` | `NiceClassRelation[atacante][alvo]` |
| `attributeModifier` | `NiceAttributeRelation` |
| `extraCardModifier` 2 / 3.5 | `EXTRA_ATTACK_RATE_SINGLE` / `_GRAND` |
| `busterChainMod` = 0.2 | `CHAINBONUS_BUSTER_RATE` |

---

## 2. Mapeamento buff → slot

Vive em [`src/core/buffs.ts`](../src/core/buffs.ts), a **mesma** tabela que gera
as tags de busca (ver [`CAPABILITIES.md`](CAPABILITIES.md) §1).

| Slot | Buffs |
|---|---|
| `atkMod` | `upAtk`, `downAtk` |
| `defMod` | `upDefence`, `downDefence`, `downDefencecommandall` |
| `cardMod` | `upCommandall`, `downCommandall` |
| `powerMod` | `upDamage`, `upDamageIndividuality`, `upSpecialdamage` |
| `critDamageMod` | `upCriticaldamage` |
| `npDamageMod` | `upNpdamage` |
| `specialDefMod` | resistência especial do alvo |
| `flatDamage` | `addDamage`, `subSelfdamage` |
| `pierceDefence` | `pierceDefence`, `funcType: damageNpPierce` |

`downX` e `subX` entram no mesmo slot com sinal invertido (`signOf`), em vez de
duplicar linhas.

---

## 3. Sutilezas que mudam o resultado

Cada uma existe porque errá-la dá um número plausível e errado.

### 3.1 O card de um NP vem do NP, não da ação

Quase toda restrição `condSelf` é de tipo de card. Num NP, o card é o do próprio
NP — ler `action.card` (indefinido) fazia o `upCommandall [cardBuster]` da skill 2
da Artoria ser descartado num Excalibur, que é Buster, zerando o `cardMod`.

**O card é resolvido antes dos buffs**, e passado para a resolução.

### 3.2 Ordem dos efeitos do NP (R20)

Só os efeitos **antes** da função de dano entram no próprio golpe. A fonte
`{ kind: "npSelfBuff" }` do `BuffStack` recolhe exatamente
`np.effects.slice(0, np.damageEffectIndex)`.

Gilgamesh ganha `upNpdamage` 30% antes do dano — 1,3× no próprio NP. Artoria
recupera NP depois, e isso não entra no golpe.

### 3.3 NP não ganha `firstCardBonus`

Um card Buster em primeira posição soma `+0.5`; um NP Buster, não. O NP conta
como "primeira posição do tipo dele" só para o `cardDamageValue`.

### 3.4 Pierce ignora Def Up, não Def Down

`(1 + atkMod - defMod)`: com pierce, o `defMod` positivo é zerado, mas o negativo
(redução de defesa aplicada por você) continua valendo. `specialDefMod` **não** é
ignorado por pierce.

### 3.5 O que um NP não pode ser

Duas regras do jogo sobre **ações válidas**, não sobre como o dano é calculado —
mas moram no núcleo, para que nenhum chamador (inclusive o MCP da fase 4)
consiga pedir o impossível:

| Regra | O que aconteceria sem ela |
|---|---|
| **NP nunca é crítico** | `criticalModifier` dobraria o golpe. |
| **NP nunca entra numa chain** | `+servantAtk * 0.2` num golpe que jamais recebe isso. |

A segunda é fácil de errar porque o Excalibur *é* um card Buster. A palavra que
resolve está na própria fórmula: *"0.2 if it's a Buster **card** in a Buster
Chain"* — uma chain é formada por três **command cards**, e um NP não é command
card. Testar só "buster chain aumenta o dano de um card Buster" deixa a metade
errada passar; o teste cobre as duas.

### 3.6 Traits derivados do inimigo (D15)

`className: "saber"` injeta o trait `classSaber`; `attribute: "human"` injeta
`attributeHuman`. Sem isso, 71 checagens anti-classe e 16 anti-atributo falham em
silêncio.

E "humano" são cinco traits distintos — `human`, `attributeHuman`, `livingHuman`,
`humanoid`, `hominidaeServant`. Nunca normalizar por semelhança de nome.

---

## 4. A tela

`/calc`. O cenário inteiro vive na **query string**
([`src/ui/calcState.ts`](../src/ui/calcState.ts)), pela mesma razão dos filtros
de busca: link compartilhável, botão voltar funcionando, e os mesmos parâmetros
viram a assinatura da tool de dano no MCP da fase 4.

```
/calc?s=100100&sk=1,2,3&ec=lancer&ea=sky&oc=5
/calc?s=201200&act=buster&pos=1&crit=1&roll=min
```

Só o que difere do padrão aparece na URL — `serializeCalc(DEFAULT_CALC)` é vazio.

### 4.1 O que a tela decide sozinha

| Regra | Por quê |
|---|---|
| Os buffs pré-dano do NP entram sozinhos | O Gilgamesh *sempre* leva o `upNpdamage` dele no próprio golpe (§3.2). Uma checkbox sugeriria uma escolha que o jogador não tem. |
| Crítico e buster chain ficam desabilitados num NP | As regras de §3.5. A tela desabilita para explicar; **o núcleo ignora de qualquer jeito**, porque a garantia não pode depender da interface. |

### 4.2 O que a tela mostra de propósito

Cada item existe porque escondê-lo produz número plausível e errado:

- **Multiplicador na escolha do inimigo** — a classe aparece como `lancer — x2`,
  então dá para ver o que a escolha fez sem ir procurar a matriz.
- **Que buffs de cada skill afetam dano** — marcar uma skill de cura não muda
  nada, e sem a dica nada diria por quê.
- **Traits derivados** — `classLancer`, `attributeSky` aparecem listados, para
  ficar claro que classe e atributo já injetam trait (§3.5).
- **NP de suporte** — os 50 NPs sem função de dano dizem isso em vez de exibir
  um número calculado como se fossem card.
- **Buff presente mas não contado** — um `upNpdamage` num ataque de card aparece
  na lista marcado `only applies to NP damage`. A alternativa (somá-lo) inflaria
  o fator; a outra (omiti-lo) esconderia um buff que o jogador tem.

## 5. O que o resultado sempre informa

`assumptions` não é opcional. Além do número, todo cálculo devolve:

| Campo | Para quê |
|---|---|
| `resolved` | nível, fou, NP, OC, alvo, ação — as premissas em texto |
| `appliedBuffs` | cada buff que entrou, com origem, slot e valor |
| `skippedBuffs` | cada buff que **não** entrou, **com o motivo** |
| `uncertainBuffs` | buffs ativos com chance < 100% (informativo, nunca filtro — D18) |
| `unmodeled` | buff types fora da tabela (R12) |

> **Estas strings são interface, não log.** Vão para a tela e vão virar a
> resposta do MCP, então são escritas **em inglês** — ao contrário dos
> comentários do projeto. Um teste varre o roster inteiro (462 servos × 2
> cenários, ~6 mil mensagens) e falha nomeando o servo se alguma escapar.

`skippedBuffs` já se pagou: o bug de §3.1 foi encontrado lendo o motivo
`"restrito a cardBuster, ação usa nenhum card"` num caso em que o card *era*
Buster.

---

## 6. Estado da validação

**O que está provado.** 27 testes em
[`src/core/damage.test.ts`](../src/core/damage.test.ts) isolam **um termo por
teste** e verificam a razão entre dois cenários que diferem só nele: vantagem de
classe dobra, crítico dobra, NP5/NP1 = 600/400, Buster em 1ª posição dá
`cardTerm` 2.0, NP Buster dá 1.5, super-efetivo do Gilgamesh 150% no OC1 e 200%
no OC5, `min`/`max` = 0.9/1.1 da média, e as duas negativas de §3.5 (NP não
critica, NP não entra em chain).

Comparar razões em vez de valores absolutos testa a fórmula sem depender de um
número de referência externo.

Mais 26 em [`src/ui/calc.test.tsx`](../src/ui/calc.test.tsx) cobrem a tradução
que a tela acrescenta: defaults por raridade, limites de faixa, as duas regras
de §4.1, e o relatório mostrando o que entrou e o que não entrou.

**Ordem de grandeza, para quem quiser conferir de relance:** Artoria NP1 lv90 com
1000 fou, sem buff nenhum, contra alvo neutro dá **18.551** de média (16.696 no
roll mínimo). Com as três skills contra um lancer sky, **88.794**.

> ⚠️ **R4 continua aberto.** Isto prova que a implementação corresponde a
> `damage_formula.txt`. **Não** prova que o resultado bate com o jogo. Falta um
> conjunto de valores conhecidos in-game para conferência de ponta a ponta —
> idealmente alguns prints de dano real com a composição documentada.

### Fora do escopo hoje

| Item | Onde |
|---|---|
| Condições de estado (HP < X, contagem de buff, turno) | D14, adiado |
| `ParamAdd`/`ParamMax` — bônus acumulativo por trait | SCHEMA §3.4 |
| Class board | D11 |
| Overkill, NP gain, geração de estrelas | fora da fórmula de dano |

Nada disso some em silêncio: buff não modelado aparece em `assumptions.unmodeled`.
