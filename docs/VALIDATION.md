# VALIDATION — conferir a calculadora contra o mundo (R4)

Os 125 testes provam que a implementação corresponde a `damage_formula.txt` e ao
dado do Atlas. **Nenhum deles prova que o número bate com o jogo.** Este
documento é o procedimento para fechar essa lacuna.

```bash
npm run damage:cases    # imprime os casos, o link de cada um e o nosso número
```

---

## 1. Por que 18 casos bastam

A fórmula é um **produto de termos**. Isso muda tudo sobre quanto trabalho é
preciso: não é necessário testar combinações, só cobrir cada fator uma vez.

```
dano = ATK × npMult × cardTerm × classe × triângulo × atributo × 0.23 × … 
```

Se um único caso completo bate, **todos os fatores que ele usa estão certos ao
mesmo tempo** — porque um erro em qualquer um deles mudaria o produto. Um erro
de unidade (`/10` em vez de `/1000`) seria um fator de 100; um erro de constante
seria proporcional. Não existe "quase certo por acaso" num produto de sete
termos.

Daí a estrutura da lista:

| | |
|---|---|
| **1 caso base** | prende ATK, multiplicador de NP, card, classe e `ATTACK_RATE` de uma vez |
| **+1 por termo** | cada caso seguinte muda **um** fator em relação ao base |
| **+1 por mecânica** | as que a fórmula original não tem (R21–R24) |

Se o base falhar, não adianta olhar os outros — conserta o base primeiro. Se o
base passar e um específico falhar, o erro está isolado naquele termo.

---

## 2. Duas fontes, e elas não provam a mesma coisa

### Calculadora da comunidade — barata e determinística

Cobre a maioria dos casos, dá número exato (sem o `randomModifier` no caminho) e
permite montar o cenário com precisão.

> **O que ela não pode provar:** que a fórmula da comunidade está certa. Se a
> calculadora que você usar for descendente do mesmo post de 2018, concordar com
> ela prova que **lemos o mesmo documento igual** — não que o documento
> descreve o jogo. Isso já é muito: foi exatamente aí que estavam os quatro bugs
> de R21–R24. Mas não é o oráculo final.

### Número visto no jogo — caro e barulhento

É o único oráculo real. O problema é o `randomModifier` de 0,9 a 1,1: um número
observado só pode ser conferido como "caiu entre `min` e `max`", e essa janela
tem **22%**. Um erro de 10% passa despercebido num caso só.

Como apertar:

- **Vários tiros do mesmo cenário.** Cinco observações que caem todas na faixa,
  e cujo espalhamento cobre boa parte dela, valem muito mais que uma.
- **Cuidado com overkill.** Se o alvo morre no meio da sequência de hits, o
  número na tela não é o dano cheio.
- **Anote o cenário inteiro.** Nível, fou, NP, overcharge, skills ativas e
  posição do card. Faltando um, o caso não é reproduzível e não vira teste.

**Recomendação:** faça a comunidade primeiro (é rápida e pega erro grosseiro),
e use in-game só para os quatro casos marcados `game`, que são mecânicas que
calculadora de terceiro costuma não implementar.

---

## 3. Como preencher

1. `npm run damage:cases` — para cada caso vêm o cenário, o link `/calc?…` que
   o reproduz na tela e o nosso número.
2. Monte o **mesmo** cenário na fonte externa. O preset é sempre: nível natural
   máximo, 1000 fou de ATK, sem CE, sem Mystic Code, sem suporte.
3. Escreva o valor obtido em `expected`, no caso correspondente de
   [`data/validation.json`](../data/validation.json).
4. `npm test` — o caso vira regressão permanente.

> **Nunca copie o nosso número para `expected`.** Isso transforma a validação em
> tautologia: o teste passaria para sempre confirmando o que já achamos. Caso
> sem conferência externa fica `null`, e `null` é uma resposta honesta.

Tolerância: casos `avg` aceitam **0,5%** de diferença, o bastante para
arredondamento de quem publicou o número e nada além. Casos `roll` conferem só
`min ≤ observado ≤ max`.

---

## 4. O que fazer quando um caso falha

A diferença já diz muito antes de abrir o código:

| Diferença | Suspeita |
|---|---|
| Fator de 10, 100 ou 1000 | divisor de unidade (SCHEMA §2) |
| Exatamente 2×, 1,5×, 0,5× | classe, card ou super-efetivo entrando errado |
| ~9%, ~20%, ~30% | um buff a mais ou a menos no stack |
| 3% ou menos | arredondamento — provavelmente não é bug |
| O nosso é **menor** | quase sempre é buff que não entrou; abra "Not counted" na tela |

O relatório da tela responde o resto: cada termo com o valor que assumiu, cada
buff que somou, e cada buff que **não** somou com o motivo. Foi lendo um desses
motivos que o primeiro bug apareceu.

---

## 5. Diferenças já conhecidas e explicadas

**Duas fontes, 16 casos, 48 números.** Os 11 de NP vieram de
**maketakunai.github.io**; os 5 de card, de uma **planilha comunitária do
Reddit**. As duas implementam a *mesma* fórmula (`damage_formula.txt`).

```
maketakunai (NP)                            planilha (card)
✓ base-artoria-np      15178/16865/18535    ✓ card-buster-1st            5059/5621/6184
✓ triangle-lancer      30357/33730/37069    ✓ card-buster-3rd            5312/5902/6493
✓ attribute-human      16696/18551/20388    ✓ card-arts-2nd-buster-first 4301/4778/5256
✓ np5                  22768/25297/27802    ✓ card-arts-crit             5059/5621/6184
✓ buffs-atk-card-np    44397/49330/54214    ✓ buster-chain               7504/8066/8628
✓ berserker-and-class-passive 38893/43192/47448
✓ super-effective-oc   122394/135974/149418
✓ np-variant-st        41844/46493/51096
✓ class-relation-override 23600/26223/28819
✓ card-res-down-on-target 30681/34090/37464
✓ buff-boost           42957/47730/52455
```

### O que a reconstrução mostrou

Reconstruindo o produto sem o piso a partir da própria auditoria (`cp`), e
comparando com cada uma das 48 medidas:

| | resultado |
|---|---|
| `min = round(cp × 0,9)` | **exato nos 16 casos, nas duas fontes** |
| `max` do maketakunai | `round(cp × 1,099)` — exato nos 11 |
| `max` da planilha | `round(cp × 1,100)` — exato nos 5 |
| "média" do maketakunai | `round(cp)` |
| "média" da planilha | `(min + max) / 2`, um artefato de exibição |

**O `cp` bate nas duas fontes, na unidade, em 16 cenários.** É a fórmula inteira
— ATK, multiplicador de NP, termo de card com e sem `firstCardBonus`, classe,
atributo, crítico, extra, chain, buffs, super-efetivo, override de classe.

**Uma diferença real sobrevive: arredondamento.** As duas fontes arredondam; nós
truncamos. Vale 1 ponto, e só quando a fração passa de `,5`.

> ⚠️ **Não sabemos qual o jogo faz**, e `damage_formula.txt` não diz nada sobre
> arredondamento. Mas agora há um motivo para manter `Math.floor` além da
> inércia: `round` pode devolver **mais** que o valor exato, e no `min` isso
> significaria anunciar como garantido um dano que não é. Truncar erra por
> baixo, que é o lado seguro do número que existe para dizer "no pior caso".

### O teto do random deixou de ser um mistério nosso

A versão anterior desta página tratava **1,099** como a leitura provável do jogo,
com dois argumentos. Os dois caíram:

**"É uma fonte só."** Agora são duas — e elas **discordam entre si**. A planilha
usa 1,100, exatamente o que o dump diz (`ATTACK_RATE_RANDOM_MAX = 1100`) e o que
nós usamos. Ou seja: o teto é escolha de quem implementa, não algo que a fórmula
fixe, e nenhuma das duas é evidência sobre o jogo.

**"O mínimo bate exato, logo o limite de cima é exclusivo."** Este era um erro de
raciocínio meu. O mínimo bater exato prova que o limite de baixo é fechado **e
que eles arredondam** — não diz nada sobre o de cima. Tanto que ele bate exato
nas duas fontes, inclusive na que usa 1,100.

> **O que ainda resolveria:** um dano in-game acima de `exato × 1,099`. Um único
> acerto desses fecha a favor do 1,100. Até lá o impacto é de 0,09%, só no `max`,
> e agora com uma fonte externa do nosso lado.

### O que a segunda fonte prova, e o que não prova

**Prova:** que a nossa *implementação* está certa. Duas implementações
independentes chegam ao mesmo `cp` em 16 cenários — foi isso que confirmou o R32,
que nenhum teste interno pegava.

**Não prova:** que a *fórmula* está certa. A planilha usa
`damage_formula.txt`, a mesma que nós. Três leitores do mesmo texto concordando
não medem o jogo — é exatamente o risco que o R4 nomeia desde o começo, e ele
continua aberto.

### O que os 16 casos já provam

**A espinha multiplicativa inteira:** ATK por `atkGrowth` + fou (sem `atkMax`,
que erraria 8% — R7), `cardTerm` 1,5 do NP Buster sem `firstCardBonus`,
`classAtkBonus`, `ATTACK_RATE` 0,23, `triangleModifier` 2,0,
`attributeModifier` 1,1, multiplicador de NP em 400% e 600%, e com eles os
divisores de unidade (R14).

**E os cinco termos que só existem em card**, todos conferidos de uma vez pela
segunda fonte: `firstCardBonus` (na carta de abertura **e** nas seguintes da
mesma chain — R32), `cardDamageValue` na 3ª posição, `criticalModifier` 2,0 e
`busterChainMod` somado fora do produto. Os onze de NP não tocavam nenhum deles,
e foi dentro desse vão que o R32 viveu.

**E quatro mecânicas que nasceram de relato**, o que importa mais, porque cada
uma foi corrigida na base de leitura do dado e não tinha confirmação externa:

| Caso | Confirma |
|---|---|
| `buff-boost` | `buffRate` do Oberon dobrando o buff de NP (R21) |
| `class-relation-override` | Nega-Saver da Kiara, `alterEgo → ruler` = 1,5× (R22) |
| `card-res-down-on-target` | restrição de card vinda de `condTarget` (R23) |
| `np-variant-st` | escolha de variante de NP, multiplicador dobrado (R24) |
| `berserker-and-class-passive` | Divinity A = **+200** de dano plano (R26) |
| `super-effective-oc` | Divinity B = **+175**, e super-efetivo 200% no OC5 |

Os dois últimos são a confirmação numérica do R26 em **dois valores diferentes**:
a fonte externa concorda com 200 e 175, não com 20 e 17,5. Aquela correção tinha
só `damage_formula.txt` ("note the lack of %") e os nossos próprios testes atrás
dela.

### O buraco que os 16 não cobrem

Nenhum caso toca as famílias **por servo** — escala por HP (R25 e R30),
super-efetivo por soma (R27), fase de medidor (R33), unidade faltando no
`funcType` (R28) e condição de quem recebe (R31). Todos foram achados por alguém
olhar um número e estranhar, não por este conjunto. É o que falta desenhar.

O conjunto **cresce com o modelo**: 16 → 17 no R32 (`card-arts-2nd-buster-first`,
carta não-primeira em chain aberta em Buster, que era onde o defeito estava) e
17 → 18 no R34 (`card-quick-mighty-chain`, o outro gatilho do mesmo termo). Um
caso novo por mecânica nova é o que impede o conjunto de virar decoração — e faz
o R4 fechar mais tarde, o que é o preço certo a pagar.

## 6. Estado

`npm run damage:cases` termina imprimindo `R4: N de 18 casos conferidos`. Hoje: **16 de 18** —
11 contra maketakunai.github.io e 5 contra a planilha comunitária. Faltam
`card-extra` e `card-quick-mighty-chain`.

Os **5 que faltam são todos de card** — `card-buster-1st`, `card-buster-3rd`,
`card-arts-crit`, `card-extra` e `buster-chain`. A fonte usada até aqui só
calcula dano de NP, então eles precisam de outra ferramenta. É por isso que
`cardTerm` está preso hoje só no valor 1,5 do NP Buster: posição, crítico, extra
e chain continuam sem conferência externa.

Um teste em [`validation.test.ts`](../src/core/validation.test.ts) **falha de
propósito quando todos estiverem preenchidos** — é o lembrete de fechar o R4 no
`PLANO.md` em vez de deixá-lo aberto para sempre.

Enquanto houver caso pendente, a suíte verde significa "consistente com a
fórmula", não "confere com o jogo". A diferença entre as duas coisas é o motivo
deste documento existir.
