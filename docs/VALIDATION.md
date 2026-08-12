# VALIDATION — conferir a calculadora contra o mundo (R4)

Os 125 testes provam que a implementação corresponde a `damage_formula.txt` e ao
dado do Atlas. **Nenhum deles prova que o número bate com o jogo.** Este
documento é o procedimento para fechar essa lacuna.

```bash
npm run damage:cases    # imprime os casos, o link de cada um e o nosso número
```

---

## 1. Por que 16 casos bastam

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

Contra **maketakunai.github.io**, nos dois primeiros casos:

| Caso | exato antes do roll | low | average | high |
|---|---:|---|---|---|
| 1 base | 16.864,98 | igual | ±1 | −0,09% |
| 2 lancer | 33.729,96 | ±1 | ±1 | −0,09% |
| 3 human | 18.551,48 | **igual** | **igual** | −0,09% |
| 4 NP5 | 25.297,47 | ±1 | **igual** | −0,09% |

Doze números, **duas** diferenças, nenhuma terceira:

**Arredondamento.** Eles arredondam, nós truncamos. Diferença de 1 ponto, e só
quando a fração passa de `,5` — por isso o `average` do caso 3 e do 4 bate exato.
O jogo trunca, então `Math.floor` fica.

**Teto do random.** `ATTACK_RATE_RANDOM_MIN/MAX` no dump são `900` e `1100`. Eles
usam **1,099** como máximo, nós usamos 1,100:

```
caso   exato × 1,100 (nosso)    exato × 1,099 (deles)
  1        18551 ≠ 18535            18534,61 → 18535  ✓
  2        37102 ≠ 37069            37069,23 → 37069  ✓
  3        20406 ≠ 20388            20388,06 → 20388  ✓
  4        27827 ≠ 27802            27801,91 → 27802  ✓
```

Quatro em quatro, na casa decimal. A leitura por trás do 1,099
é que o jogo sorteia um **inteiro** em `[900, 1100)` — limite superior exclusivo,
como é convenção em RNG —, e nesse caso 1,100 é um número que **não pode
acontecer**.

> **Em aberto, de propósito.** A constante do jogo diz 1100; a interpretação de
> RNG exclusivo diz 1099. Quatro casos batendo confirmam que a escolha *deles* é
> essa — não que ela esteja certa. É uma fonte só, repetida.
>
> **O que resolveria:** um dano in-game acima de `exato × 1,099`. Um único acerto
> desses fecha a favor do 1,100; muitos tiros parando abaixo do teto fecham a
> favor do 1,099. Até lá, impacto de 0,09% e só no `max` — o `min`, que é o que
> interessa para "dano garantido", **bate em todos os quatro**.

**O que estes quatro casos já provam:** ATK 12.221 (`atkGrowth` + fou, sem
`atkMax` — que daria 11.221 e erraria 8%), `cardTerm` 1,5 do NP Buster sem
`firstCardBonus`, `classAtkBonus` 1,0, `ATTACK_RATE` 0,23, `triangleModifier` 2,0,
`attributeModifier` 1,1, e o multiplicador de NP em 400% **e** 600% — e, junto
com todos eles, os divisores de unidade. R7 e R14, riscos declarados desde a fase
0, saem confirmados.

## 6. Estado

`npm run damage:cases` termina imprimindo `R4: N de 16 casos conferidos`. Hoje: **4 de 16**, todos contra maketakunai.github.io.

Um teste em [`validation.test.ts`](../src/core/validation.test.ts) **falha de
propósito quando todos estiverem preenchidos** — é o lembrete de fechar o R4 no
`PLANO.md` em vez de deixá-lo aberto para sempre.

Enquanto houver caso pendente, a suíte verde significa "consistente com a
fórmula", não "confere com o jogo". A diferença entre as duas coisas é o motivo
deste documento existir.
