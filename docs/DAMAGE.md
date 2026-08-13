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

| Slot | Cai em | Buffs |
|---|---|---|
| `atkMod` | atacante | `upAtk`, `downAtk` |
| `defMod` | **alvo** | `upDefence`, `downDefence`, `downDefencecommandall` |
| `cardMod` | atacante | `upCommandall`, `downCommandall` |
| `powerMod` | atacante | `upDamage`, `upDamageIndividuality`, `upSpecialdamage` |
| `critDamageMod` | atacante | `upCriticaldamage` |
| `npDamageMod` | atacante | `upNpdamage` |
| `specialDefMod` | **alvo** | resistência especial do alvo |
| `dmgPlusAdd` | atacante | `addDamage` |
| `selfDmgCutAdd` | **alvo** | `subSelfdamage`, `addSelfdamage` |
| `pierceDefence` | atacante | `pierceDefence`, `funcType: damageNpPierce` |
| *nenhum — age sobre o slot alheio* | — | `buffRate` (§3.5) |
| *nenhum — age no `triangleModifier`* | — | `overwriteClassRelation` (§3.6) |

`downX` e `subX` entram no mesmo slot com sinal invertido (`signOf`), em vez de
duplicar linhas.

A coluna **"cai em"** decide se o buff conta. Ver §3.7 — ignorá-la fazia o Def Up
do próprio atacante reduzir o dano dele.

Os **dois últimos slots são somados fora do produto** e não são percentuais.
`damage_formula.txt` avisa em letras: *"Note the lack of %"*. Divinity B vale
**+175 de dano**, não +17,5%, e o `/10` que vale para todo buff os deixava dez
vezes menores (R26). Consequência prática para quem escrever teste: uma razão
entre dois danos **não** isola um termo multiplicativo enquanto `flatDamage` não
for subtraído dos dois lados.

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

### 3.5 Buffs que multiplicam outros buffs (R21)

**Este termo não está em `damage_formula.txt`** — o post é de antes do Oberon
existir. A skill 3 dele dobra o valor dos buffs de dano de NP: um `upNpdamage`
de 20% conta como 40%.

O dado descreve o mecanismo sem precisar citar ninguém:

```
buff buffRate  →  script.UpBuffRateBuffIndiv: [buffNpDamageUp]
buff upNpdamage →  vals: [buffPositiveEffect, buffIncreaseDamage, buffNpDamageUp]
```

Ou seja, o boost declara **qual trait de buff** multiplica, e os buffs declaram
quais traits carregam. Por isso a implementação casa por trait, não por nome:
se o jogo lançar um boost de ATK up amanhã, ele já funciona.

| | |
|---|---:|
| Ocorrências de `buffRate` no jogo | **1** (Oberon skill 3) |
| Buffs `upNpdamage` marcados `buffNpDamageUp` | 794 de 794 |

Duas decisões que o dado não responde sozinho:

- **Não empilha** (o estado é 重複不可). Entre vários boosts que alcancem o mesmo
  buff, vale o de maior valor.
- **Boost que não alcança nada vai para `skippedBuffs`.** A skill do Oberon num
  alvo sem buff de dano de NP não faz nada, e sumir em silêncio seria pior que
  aparecer como recusa.

Um teste falha se um segundo servo ganhar `buffRate` — não porque quebraria,
mas porque vale conferir se o novo é do mesmo formato.

### 3.6 A matriz de classe pode ser sobrescrita (R22)

`triangleModifier` não vem só de `NiceClassRelation`. Um buff
`overwriteClassRelation` traz em `script.relationId.atkSide` linhas do tipo
"quando um X ataca um Y, o multiplicador é Z":

```
Kiara, passiva Nega-Saver:  alterEgo -> ruler = 1.5x  (overwriteForce)
```

A matriz padrão dá 1,0× de alterEgo para ruler. Sem ler o override, o dano da
Kiara contra Ruler sai **um terço abaixo** — e continua plausível.

| | |
|---|---:|
| Buffs `overwriteClassRelation` | 8, em 6 servos |
| Com linhas de `atkSide` (mudam o dano causado) | 5 |

Os outros só têm `defSide`, que muda o dano **recebido** — deliberadamente não
carregado, porque nada aqui calcula dano recebido.

Uma passiva pode trazer várias linhas e nenhuma valer: a Nega-Saver declara
`assassin→ruler` e `alterEgo→ruler`, e a Kiara é alterEgo. Contra um Saber
nenhuma casa, e isso vira registro em `skippedBuffs` — "não fez nada" precisa de
explicação.

### 3.7 Em quem o buff cai decide se ele conta (R22)

A fórmula é escrita da perspectiva **"dano deste card"**: `defMod` e
`selfDmgCutAdd` descrevem o **defensor**, todo o resto descreve o atacante. Ler o
slot sem olhar o alvo do efeito produz absurdos coerentes:

| Efeito | Alvo | Lido sem o lado | Certo |
|---|---|---|---|
| `upDefence` 16% | o próprio atacante | **reduz** o dano dele em 16% | não afeta |
| `downAtk` 20% | o inimigo | **reduz** o dano do atacante | não afeta |
| `subSelfdamage` | o próprio atacante | subtrai do dano causado | não afeta |
| `downDefence` 30% | o inimigo | aumenta o dano | aumenta o dano ✓ |

Medido: **111** `upDefence` em aliados, **42** `downAtk` em inimigos, **48**
`subSelfdamage` em aliados e **8** `downNpdamage` em inimigos estavam do lado
errado. O que torna o erro difícil de ver é que a metade certa continua
funcionando.

A regra está em `SLOT_SIDE` ([`buffs.ts`](../src/core/buffs.ts)) e o lado do
efeito sai do prefixo do `funcTargetType` — `enemy*` é o alvo, o resto é o
atacante.

**Isto também conserta o alcance dos suportes.** A checagem "o efeito de um
suporte precisa alcançar o atacante" só vale para buff de aliado; o def down que
o suporte joga no inimigo estava sendo recusado com `does not reach the
attacker`, e def down de suporte é uma das maiores fontes de dano do jogo.

### 3.8 `condTarget` carrega três coisas diferentes (R23)

O nome sugere "identidade do alvo", e é o que o campo é na maioria das vezes. Mas
ele também guarda outras duas, e tratar as três como identidade recusa efeito que
vale:

| Família | Exemplo | Como checar |
|---|---|---|
| **Card** | `downDefencecommandall` + `condTarget: [cardArts]` | contra o card da **ação** |
| **Estado de buff** | `upCriticaldamage` + `condTarget: [buffEvade]` | não modelado (D14) |
| **Identidade** | `upDamage` + `condTarget: [alignmentGood]` | contra os traits do inimigo |

O caso que revelou isto é a Arts resistance down da Kiara. A restrição de card
está do lado do **alvo** porque o debuff é de resistência *ao card que vem* — e
nenhum inimigo "é" um card Arts, então ela era recusada em 100% dos casos.

| | |
|---|---:|
| `card*` em `condTarget`, em slots de dano | 85 (84 são `downDefencecommandall`) |
| Servos afetados | **62** |
| `buff*` em `condTarget`, em slots de dano | 22 |

Restrição de card é a **mesma pergunta** dos dois lados — em `condSelf` é o card
com que se golpeia, em `condTarget` é o card que acerta — então uma função só
responde as duas.

`faceCard` entra na mesma família: significa "command card", ou seja, vale em
card comum e não em NP.

Estado de buff do inimigo é recusado, o que é conservador, mas **com o motivo
certo**: `enemy buff state is not modelled`, em vez de fingir que `buffCurse` é
um trait de identidade que o alvo não tem.

### 3.9 Um servo pode ter mais de um NP (R24)

Oito têm variantes, e **o multiplicador muda junto** — não é só o tipo:

| Servo | Varia | NPs |
|---|---|---|
| Space Ishtar | card | buster 300% · arts 450% · quick 600% |
| Emiya | card | buster 400% · arts 600% |
| **UDK-Barghest** | **alvo** | arts AoE 450% · arts ST 900% |
| **Jade Rabbit** | **alvo** | arts AoE 450% · arts ST 900% |
| **BB Dubai** | **alvo** | C.C.C. arts AoE 450% · G.G.G. arts support |
| Mélusine | card+alvo | Hollow Heart Albion buster AoE 300% · Innocence Arondight arts ST 900% |
| Ptolemaîos | card+alvo | Bibliothēkē arts AoE 450% · Pharos buster ST 600% |
| Mash | card+alvo | Lord Chaldeas arts support · Rayproof Kyrielight buster AoE 400% |

Calcular sempre pelo `np` de maior prioridade erra **2,18×** na Mélusine e **2×**
na UDK-Barghest.

**O que separa escolha de histórico é o par card + alvo.** `npAlternatives`
mistura as duas coisas: a Mash tem oito versões Arts, que são rank ups, e uma
Buster, que é a forma Ortenaus. Dentro do mesmo par vale a de maior `priority`
(R8); pares diferentes coexistem.

O **alvo** precisa estar na chave porque nem toda variante muda o card: três
servos alternam ST e AoE com a mesma carta, e é sempre o dobro do multiplicador
na versão ST. Agrupar só por card escondia exatamente a metade que interessa —
foi o que aconteceu na primeira versão disto.

O Emiya tem os **dois eixos ao mesmo tempo** — Buster e Arts, cada um em versão
pré e pós rank up — e as duas Arts empatam em `priority`. O desempate é
`condQuestId`, senão a escolha seria a ordem do array.

O que a calculadora **não** tenta responder é como o servo chega àquele estado: a
Space Ishtar troca por mecânica própria, o Ptolemaîos por `transformServant`, a
Mash por forma. Isso é estado (D14) e é decisão de quem monta o cenário — o mesmo
princípio de D18 para buffs.

> Curiosidade que serve de sanidade: no Emiya e na Space Ishtar os
> multiplicadores compensam o card quase exatamente (400×1,5 = 600×1,0), então
> trocar o tipo do NP mal muda o número cru. O que muda é **quais buffs pegam** —
> e é aí que a Mélusine abre 2,18×, porque a passiva Territory Creation é +9% de
> Arts e só vale num dos dois.

### 3.10 Passiva de classe está sempre ligada

Não é declarável, e por isso não é opcional: `calculateDamage` sempre inclui
`attacker.classPassive`. Append passive é o oposto — o jogador escolhe destravar,
então entra só se pedida (D8).

Deixar isso a cargo de quem monta o `buffStack` foi o que produziu o bug:

| | |
|---|---:|
| Servos com passiva de classe que afeta dano | **407 de 462** |
| Só de `upCommandall` (Mad Enhancement e afins) | 349 |
| `upCriticaldamage` (Independent Action e afins) | 180 |
| `addDamage` (Divinity) | 137 |

Todos saíam subestimados, sem sintoma. Passiva de classe passa pelos mesmos
filtros dos outros buffs: a Riding da Artoria é Quick up e é recusada num NP
Buster, como deve ser.

### 3.11 O que um NP não pode ser

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

### 3.12 Traits derivados do inimigo (D15)

`className: "saber"` injeta o trait `classSaber`; `attribute: "human"` injeta
`attributeHuman`. Sem isso, 71 checagens anti-classe e 16 anti-atributo falham em
silêncio.

E "humano" são cinco traits distintos — `human`, `attributeHuman`, `livingHuman`,
`humanoid`, `hominidaeServant`. Nunca normalizar por semelhança de nome.

### 3.13 O super-efetivo não mora sempre no mesmo campo (R27)

Em quase todo NP o multiplicador super-efetivo vem de `svals[].Correction`. Em
**`damageNpIndividualSum` não**: ali ele está em `Value2`, e `Correction` passa a
ser o **acréscimo por unidade contada**.

| | Value2 | Correction | ParamAddMaxCount | Comportamento |
|---|---|---|---|---|
| 4 NPs | 150–200% | **0** | 0 | super-efetivo fixo, como qualquer outro |
| 17 NPs | **100%** | 10% | 4 a 12 | base neutra + 10% por stack |

Lendo `Correction` como multiplicador, o primeiro grupo dava **0%**. E um
multiplicador zero não erra por pouco — ele **zera o produto inteiro**, porque o
termo entra como `(1 + (se/100 - 1))`. A Musashi causava **1** de dano contra
AlterEgo, o piso do `Math.max(1, …)`. O segundo grupo virava 10%: dano dividido
por dez.

Este é o único defeito da série R21–R27 que **não** produz número plausível, e é
exatamente por isso que durou tanto: ele só dispara contra o alvo certo, e
ninguém acerta o alvo certo por acaso. Os outros eram invisíveis por serem
críveis; este era invisível por ser raro.

**`Target` também troca de sentido aqui.** Na família soma ele é o *lado* da
contagem — `0` conta em si mesmo (Charlemagne, 〔王勇〕), `1` conta no alvo
(Jacques de Molay, queimadura). Incluí-lo na lista de traits criava um id 1
inexistente.

E `damageNpBattlePointPhase` — só a Ereshkigal — **não tem super-efetivo nenhum**:
`Correction` é escala de fase de um medidor e `Target` é o id do medidor.

#### A contagem entra por **dois** campos

`ss=` (no atacante) e `st=` (no alvo). Dois, e não um, porque são contagens de
**entidades diferentes**: 〔Heroic King〕 é do Charlemagne, 〔roman〕 é do inimigo
do Romulus. Um campo só mudaria de significado conforme o servo escolhido, que é
literalmente o formato de defeito que R23, R25 e o próprio R27 já cobraram.

Só um dos dois vale por NP, e **quem decide é o dado** — `countsOn`. O contador
do outro lado é ignorado em silêncio, o que é o comportamento certo: informar
stacks de alvo para o Charlemagne não é erro do usuário, é uma pergunta que
aquele NP não faz.

O teto também vem do dado (`maxCount`), e é por NP: 12 no Charlemagne, 10 no
Romulus, 4 no Taira-no-Kagekiyo. Pedir mais é preso ao teto, não recusado.

A tela mostra o campo **só quando o NP conta**, com o nome do trait, o lado e o
teto lidos do dado. Ela não sabe quem é o Charlemagne — servo novo com a mesma
mecânica aparece sem uma linha de código.

E o campo do lado do alvo é distinto do seletor de traits logo abaixo dele: lá se
diz *se* o inimigo é 〔roman〕; aqui, **quantos** 〔roman〕 ele acumulou. O NP do
Romulus aplica um por uso, até 10 — e um conjunto não guarda multiplicidade.

Com zero stacks o multiplicador é a base, 100%, neutra. A linha em `assumptions`
aparece de todo jeito, porque um NP que soma até 220% não pode devolver o número
do piso calado:

```
0 of up to 12 own Heroic King stacks — none counted
8 of up to 12 own Heroic King stacks (+80% super effective)
```

### 3.13 Sete servos batem mais forte machucados (R25)

Dois mecanismos **independentes**, com nomes e formatos diferentes, que fazem a
mesma coisa. Os dois entram por `hpPercent`, o HP atual em % do máximo.

**(a) O multiplicador do NP.** `funcType: damageNpHpratioLow`, em 4 servos. O
multiplicador tem duas parcelas:

```
multiplicador = Value  +  Target × (1 − hp/hpMax)
                 ↑              ↑
        escala com nível de NP  escala com OVERCHARGE
```

Anne Bonny & Mary Read NP1: 1200% com HP cheio; mais 1200% no OC1 ou 2000% no
OC5 conforme o HP cai. Como só a segunda parcela é lida do campo `Target` — que
em qualquer outro NP é o *trait* do super-efetivo —, ela sumia inteira, e com
ela **o overcharge**: OC1 e OC5 davam o mesmo número.

**(b) O valor de um buff.** Campo `RatioHPLow` do `sval`, em 4 buffs de dano:

| Servo | Buff | HP cheio → HP zero |
|---|---|---|
| Cú Chulainn, skill 1 | `upAtk` | 20% → 50% |
| Hijikata, skill 3 | `upCriticaldamage` | 20% → 100% |
| Leonidas, skill 1 | `upAtk` | **0%** → 30% |
| Passionlip, skill 2 | `upAtk` | **0%** → 50%, só abaixo de 50% de HP |

Nos dois últimos o valor de HP cheio é zero, então a auditoria mostrava
`upAtk 0` — um buff contado valendo nada. Não parece defeito; parece skill
fraca. É o pior formato que um erro pode ter aqui.

**A faixa é um gatilho, não um limite.** Só a Passionlip usa `RatioHPRange*`, e
a descrição japonesa é explícita: *HP50%以下で発動*, ativa em 50% de HP ou menos.
Acima da faixa a escala inteira não vale — o valor **cai** para zero em vez de
parar de crescer. Um `clamp` daria 30% com HP cheio, que é plausível e errado.

**É razão, não HP absoluto.** As duas fórmulas usam `hp/hpMax`, então `hpMax`
nunca entra na conta — e, por consequência, **o HP de uma Craft Essence não
altera dano nenhum**. O que ele muda é quanto dano você aguenta, que não é o que
esta página calcula.

Na auditoria, um buff que escala aparece com `atFullHp` **sempre**, inclusive
com HP cheio: é justamente aí que ele vale menos, e saber que o número cresce
se você apanhar é a informação toda.

---

## 4. A tela

`/calc`. O cenário inteiro vive na **query string**
([`src/ui/calcState.ts`](../src/ui/calcState.ts)), pela mesma razão dos filtros
de busca: link compartilhável, botão voltar funcionando, e os mesmos parâmetros
viram a assinatura da tool de dano no MCP da fase 4.

```
/calc?s=100100&sk=1,2,3&ec=lancer&ea=sky&oc=5
/calc?s=201200&act=buster&pos=1&crit=1&roll=min
/calc?s=304800&npid=304801                 qual NP, quando o servo tem mais de um
```

Só o que difere do padrão aparece na URL — `serializeCalc(DEFAULT_CALC)` é vazio.

### 4.1 O que a tela decide sozinha

| Regra | Por quê |
|---|---|
| Os buffs pré-dano do NP entram sozinhos | O Gilgamesh *sempre* leva o `upNpdamage` dele no próprio golpe (§3.2). Uma checkbox sugeriria uma escolha que o jogador não tem. |
| Crítico e buster chain ficam desabilitados num NP | As regras de §3.11. A tela desabilita para explicar; **o núcleo ignora de qualquer jeito**, porque a garantia não pode depender da interface. |

### 4.2 O que a tela mostra de propósito

Cada item existe porque escondê-lo produz número plausível e errado:

- **Multiplicador na escolha do inimigo** — a classe aparece como `lancer — x2`,
  então dá para ver o que a escolha fez sem ir procurar a matriz.
- **Que buffs de cada skill afetam dano** — marcar uma skill de cura não muda
  nada, e sem a dica nada diria por quê.
- **Traits derivados** — `classLancer`, `attributeSky` aparecem listados, para
  ficar claro que classe e atributo já injetam trait (§3.12).
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
| `appliedBuffs` | cada buff que entrou, com origem, slot, valor e `counted` |
| `skippedBuffs` | cada buff que **não** entrou, **com o motivo** |
| `uncertainBuffs` | buffs ativos com chance < 100% (informativo, nunca filtro — D18) |
| `unmodeled` | buff types fora da tabela (R12) |

> **Estas strings são interface, não log.** Vão para a tela e vão virar a
> resposta do MCP, então são escritas **em inglês** — ao contrário dos
> comentários do projeto. Um teste varre o roster inteiro (462 servos × 2
> cenários, ~6 mil mensagens) e falha nomeando o servo se alguma escapar.

`counted` separa "está no stack" de "somou": um crit damage up sem crítico, ou
um NP damage up num card, resolve num slot que a ação não usa. O campo vive no
núcleo, e não na tela, para o MCP da fase 4 não redescobrir a regra e responder
diferente da interface.

Na tela isso vira duas listas: **Buffs counted**, que é o que formou o número, e
**Not counted**, fechada por padrão, com os não-contados e os recusados juntos —
para quem lê o resultado, "está no servo e não está no total" é a mesma coisa. A
contagem fica no rótulo mesmo fechada: esconder sem contar transformaria uma
recusa errada em ausência invisível.

`skippedBuffs` já se pagou: o bug de §3.1 foi encontrado lendo o motivo
`"restrito a cardBuster, ação usa nenhum card"` num caso em que o card *era*
Buster.

---

## 6. Estado da validação

**O que está provado.** 52 testes em
[`src/core/damage.test.ts`](../src/core/damage.test.ts) isolam **um termo por
teste** e verificam a razão entre dois cenários que diferem só nele: vantagem de
classe dobra, crítico dobra, NP5/NP1 = 600/400, Buster em 1ª posição dá
`cardTerm` 2.0, NP Buster dá 1.5, super-efetivo do Gilgamesh 150% no OC1 e 200%
no OC5, `min`/`max` = 0.9/1.1 da média, e as duas negativas de §3.11 (NP não
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

### Onde procurar o próximo erro

Cinco defeitos foram achados por relato de quem joga (R21–R25), e **em quatro
deles a fórmula estava certa** — o erro era leitura do dado. O padrão vale mais
que os casos:

| Padrão | Exemplo |
|---|---|
| Um campo guarda coisas de significados diferentes | `condTarget` com card, estado e identidade (R23); `Target` como trait *ou* como bônus de HP (R25) |
| Um valor não diz de quem ele é | `defMod` sem lado, `selfDmgCutAdd` no atacante (R22) |
| Uma lista mistura escolha com histórico | `npAlternatives` com variante e rank up (R24) |
| O que sempre está ligado não é declarado | passiva de classe fora do `buffStack` (R22) |
| Um campo não lido faz o valor parecer completo | `RatioHPLow` faltando deixa `upAtk 0` (R25) |
| O mesmo papel muda de campo conforme a família | multiplicador em `Correction` ou em `Value2` (R27) |
| Uma regra geral engole a exceção sem avisar | `hasBuff → /10` sobre valores planos (R26) |
| A salvaguarda existe mas ninguém a lê | `valueUnit: "unknown"` ignorado pelo multiplicador de NP (R28) |
| A fórmula é de 2018 e o jogo andou | `buffRate` do Oberon (R21) |

**R25 saiu desta própria lista.** "`svals` não lidos" estava anotado aqui como
suspeito, com `RatioHPLow/High` citado pelo nome, e um relato do Thales o
transformou em defeito confirmado. A lista abaixo não é decoração.

Os pontos que **ainda** leio como se fossem uniformes, e portanto são os próximos
candidatos:

- **`condFunc`** — hoje é carregado no modelo e **nunca consultado** pela
  calculadora. Se contiver condição de card ou de alvo como o `condTarget`
  continha, há efeito entrando ou saindo errado.
- **`condSelf` fora de card** — só 4 casos hoje (`faceCard` tratado, `fieldShore…`
  não), mas a checagem é por prefixo e um namespace novo passaria batido.
- **`svals` não lidos** — `RatioHP*` saiu daqui e virou R25; sobram `Value2`
  (3.181 ocorrências), `ParamAdd`/`ParamAddMaxCount` (115) e `DependFuncId`
  (110), que são os três maiores restantes. `ParamAddMaxCount` é "o valor cresce
  por unidade de alguma coisa" — a mesma família de R25, contada em vez de
  interpolada.
- **`TriggeredTargetHpRateRange`** (30 ocorrências) — efeito disparado por faixa
  de HP **do alvo**. Vizinho de R25 e ainda não lido.
- **Alvos `enemy*` novos** — o lado do efeito sai de um prefixo; um
  `enemyOther` inédito cairia certo, mas um alvo com outro nome, não.

Um relato de "esse número parece baixo" continua sendo a forma mais barata de
achar qualquer um destes, porque todos produzem número plausível.
