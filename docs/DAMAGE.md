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

### 3.5 Traits derivados do inimigo (D15)

`className: "saber"` injeta o trait `classSaber`; `attribute: "human"` injeta
`attributeHuman`. Sem isso, 71 checagens anti-classe e 16 anti-atributo falham em
silêncio.

E "humano" são cinco traits distintos — `human`, `attributeHuman`, `livingHuman`,
`humanoid`, `hominidaeServant`. Nunca normalizar por semelhança de nome.

---

## 4. O que o resultado sempre informa

`assumptions` não é opcional. Além do número, todo cálculo devolve:

| Campo | Para quê |
|---|---|
| `resolved` | nível, fou, NP, OC, alvo, ação — as premissas em texto |
| `appliedBuffs` | cada buff que entrou, com origem, slot e valor |
| `skippedBuffs` | cada buff que **não** entrou, **com o motivo** |
| `uncertainBuffs` | buffs ativos com chance < 100% (informativo, nunca filtro — D18) |
| `unmodeled` | buff types fora da tabela (R12) |

`skippedBuffs` já se pagou: o bug de §3.1 foi encontrado lendo o motivo
`"restrito a cardBuster, ação usa nenhum card"` num caso em que o card *era*
Buster.

---

## 5. Estado da validação

**O que está provado.** 25 testes em
[`src/core/damage.test.ts`](../src/core/damage.test.ts) isolam **um termo por
teste** e verificam a razão entre dois cenários que diferem só nele: vantagem de
classe dobra, crítico dobra, NP5/NP1 = 600/400, Buster em 1ª posição dá
`cardTerm` 2.0, NP Buster dá 1.5, super-efetivo do Gilgamesh 150% no OC1 e 200%
no OC5, `min`/`max` = 0.9/1.1 da média.

Comparar razões em vez de valores absolutos testa a fórmula sem depender de um
número de referência externo.

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
