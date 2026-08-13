# CAPABILITIES — busca por o que o servo faz

Tags derivadas dos efeitos, para que a busca fale a língua de quem joga em vez
do jargão interno do Atlas. Ninguém procura `addStateShort + upAtk + ptAll`;
procura *"quem dá ATK pra party"*.

Implementação: [`src/core/capabilities.ts`](../src/core/capabilities.ts), sobre a
tabela compartilhada [`src/core/buffs.ts`](../src/core/buffs.ts).

---

## 1. Uma tabela, dois consumidores

`buffs.ts` responde duas perguntas sobre o mesmo buff:

| Pergunta | Quem usa | Campo |
|---|---|---|
| Que tag semântica é essa? | busca | `tag` |
| Em que termo da fórmula entra? | calculadora | `slot` |

As duas são a mesma leitura do mesmo dado. Manter catálogos separados garantiria
que divergissem — por isso moram no mesmo arquivo, e é isso que faz as fases 2 e
3 serem um trabalho só.

Buff fora da tabela vira `slot: null, tag: null`; a calculadora o reporta em
`assumptions.unmodeled` em vez de ignorar (R12).

---

## 2. Formato da tag

```
<o quê>[_<limiar>]_<escopo>
```

| Parte | Valores | Vem de |
|---|---|---|
| o quê | `atk_up`, `np_charge`, `buster_up`, `def_down`… | `buffs.ts` + `condSelf` |
| limiar | `20`, `30`, `50` | valor de pico do efeito |
| escopo | `self`, `party`, `enemy` | `funcTargetType` |

Exemplos: `np_charge_50_party`, `buster_up_party`, `def_down_30_enemy`.

---

## 3. As duas dimensões que a tag precisa além do buff

Medido no roster: as duas existem porque sem elas a tag não filtra nada.

### 3.1 Restrição de card

`upCommandall` sozinho casa com **403 de 462 servos (87%)** — inútil como filtro.
A restrição está em `condSelf` (R11), e separando por card:

```
arts_up_self 216 · quick_up_self 210 · buster_up_self 192
arts_up_party 51 · buster_up_party 47 · quick_up_party 30
```

Buff de card sem restrição alguma vira `card_up_all_<escopo>`.

### 3.2 Limiar de magnitude

`np_charge_self` aparece em 66% do roster. Saber que "tem alguma carga" não
ajuda; o que se busca é quem carrega o bastante para soltar o NP de cara.

**Os limiares são cumulativos**: quem carrega 50% também satisfaz "pelo menos
20%".

```
np_charge_self      304
np_charge_20_self   300
np_charge_30_self   255
np_charge_50_self    89
```

> Atribuir só o maior limiar atingido pareceria natural e quebra o filtro:
> `np_charge_30` esconderia justamente os melhores carregadores, que teriam
> apenas `_50`. Foi um bug real, pego pela contagem não ser monotônica.

Tags com limiar hoje: `np_charge`, `atk_up`, `crit_damage_up`, `np_damage_up`,
`buster_up`, `arts_up`, `quick_up`, `def_down`.

As três mais recentes vieram da fase 3 e são raras de propósito:
`buff_boost_party` (1 servo, o Oberon — R21) e `class_advantage_override_self`
/ `_party` (7 no total — R22). Tag rara não é defeito: é quando um filtro vale
mais.

---

## 4. Cobertura

| | |
|---|---:|
| Tags distintas | 170 |
| Servos sem nenhuma tag | 0 |
| Tags úteis (5–40% do roster) | 78 |
| Tags amplas (>40%) | 10 |
| Tags raras (<5%) | 82 |

As amplas não atrapalham: convivem com as estreitas e a UI mostra a contagem, de
modo que dá para ver quais discriminam. As raras são efeitos de nicho, que é
exatamente quando um filtro vale mais.

---

## 5. Na busca

Filtro **AND**: marcar `buster_up_party` + `atk_up_party` + `np_charge_party`
devolve quem faz as três coisas — 13 servos, entre eles Merlin e Quetzalcoatl.

Na URL: `?cap=buster_up_party,np_charge_50_party`.

A faceta mostra as 45 tags mais frequentes **dentro do resultado atual**, mais as
já marcadas. Listar as 170 seria inútil, e uma lista fixa não se adaptaria ao que
está filtrado.

---

## 6. Adicionar uma tag

1. Achar o `buffType` no dado (a página de detalhe do servo mostra o nome cru).
2. Acrescentar em `DAMAGE` ou `UTILITY` no `buffs.ts`, com `slot` e `tag`.
3. Se a tag ficar acima de ~40% do roster, ela precisa de mais uma dimensão:
   limiar em `THRESHOLDS`, ou uma restrição vinda de `condSelf`.
4. `npm run data:build` — as tags são derivadas, não escritas à mão.

Nada precisa ser editado na UI: a faceta e os rótulos são gerados a partir das
tags que existirem.

---

## 7. Traits que o dump não nomeia

Cinco traits existem **só como referência**: aparecem no `TargetList` do NP que
os conta e em lugar nenhum mais. Varrer `servants`, `equips` e `mystic_codes`
inteiros por cada id devolve apenas esse uso — nenhum par `{id, name}`, e nenhum
efeito que os conceda. Quem os aplica vive em dado de evento ou quest, que não
ingerimos.

O resultado é a interface dizer `unknown(2828) stacks` justamente nos servos mais
exóticos, que são os que mais precisam de explicação. Daí
[`data/traitNames.json`](../data/traitNames.json): curadoria à mão, mesma ideia
de `aliases.json`.

| id | Servo | Lado | Máx | +%/un | Termo em 〔〕 |
|---|---|---|---:|---:|---|
| 2828 | Charlemagne (343, saber 5★) | nele mesmo | 12 | 10 | 王勇 |
| 2827 | Super Bunyan (339, alterEgo 5★) | nele mesmo | 10 | 5 | いいね！ |
| 2759 | Taira-no-Kagekiyo (303, avenger 5★) | nele mesmo | 4 | 25 | 復讐の怨念 |
| 2880 | Wandjina (393, foreigner 5★) | nele mesmo | 10 | 10 | 精霊の怒り |
| 10039 | Urðr (470, archer 5★) | no alvo | 10 | 10 | 過去改竄 |

⚠️ O NP da **Wandjina** cita dois termos: 〔人類の脅威〕 é o super-efetivo que ela
concede a si, e 〔精霊の怒り〕 é o que a contagem lê. Só o segundo é o 2880.

A **Urðr** é a única que concede o próprio trait, pelo mesmo NP que o conta.

**Ao preencher:** nome oficial de NA quando o servo já tiver saído lá; senão, o
termo que a comunidade usa. Nunca traduzir do japonês por conta própria — o nome
serve para a pessoa reconhecer, não para ser literal.

O build avisa quantos estão nomeados e quantos pendentes, e reclama se o Atlas
passar a nomear um deles — assim a tabela não envelhece calada.
