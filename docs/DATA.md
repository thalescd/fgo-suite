# DATA — Origem e atualização dos dados

Como os dados entram no projeto e como atualizá-los. Se você pegou este repo e
precisa fazer só uma coisa, é a §2.

---

## 1. Fonte

**Atlas Academy** — `https://api.atlasacademy.io`. Gratuita, sem chave, sem cadastro.
Documentação: <https://api.atlasacademy.io/docs>

Usamos os **export files**: dumps completos pré-processados, regenerados a cada
patch do jogo. Não batemos endpoint por endpoint em runtime, e **não** self-hostamos
a API (ver [`../PLANO.md`](../PLANO.md) D5 — exigiria Postgres com PGroonga, Redis e
clonar gigabytes de master data, para reproduzir o que os dumps já entregam).

**Região: JP, variantes `_lang_en`.** JP tem o conteúdo completo (~2 anos à frente
de NA) e o sufixo `_lang_en` traz os nomes traduzidos. Medido: apenas 1 dos 466
servos permanece com nome em japonês.

### Arquivos baixados

Definidos em [`src/ingest/sources.ts`](../src/ingest/sources.ts).

| Local | Remoto | Conteúdo | Tamanho |
|---|---|---|---:|
| `servants` | `nice_servant_lang_en` | 478 servos | 64 MB |
| `equips` | `nice_equip_lang_en` | 2.685 craft essences | 21 MB |
| `mystic_codes` | `nice_mystic_code_lang_en` | 28 mystic codes | 215 KB |
| `constant` | `NiceConstant` | `ATTACK_RATE`, crit, chain… | 11 KB |
| `class_attack_rate` | `NiceClassAttackRate` | ATK por classe | 2 KB |
| `class_relation` | `NiceClassRelation` | matriz 75×75 de classe | 117 KB |
| `attribute_relation` | `NiceAttributeRelation` | matriz 5×5 de atributo | 1 KB |
| `card` | `NiceCard` | multiplicadores por card e posição | 13 KB |

Total: ~86 MB, em `raw/JP/` (gitignored).

> Usamos `nice_servant`, **não** `nice_servant_lore` (64 MB vs 88 MB). O lore só
> acrescenta texto de perfil, que o modelo canônico não guarda. Se perfis entrarem
> no escopo, troque o `remote` em `sources.ts` — o manifest cuida do resto.

---

## 2. Atualizar

```bash
npm run data:check      # o que mudou? não baixa nada, custa alguns KB
npm run data:sync       # baixa só o que mudou
npm run data:build      # raw/ -> public/data/
npm run data:validate   # confere a saída contra valores conhecidos

npm run data:all        # sync + build + validate
```

**Rode sempre o `data:validate` depois de sincronizar.** É o que detecta o Atlas
ter mudado de formato: uma quebra silenciosa aparece ali antes de virar número
errado na calculadora.

### Como o incremental funciona

Os exports do Atlas respondem a GET condicional. O `raw/manifest.json` guarda o
ETag de cada arquivo; o sync manda `If-None-Match` e um arquivo inalterado devolve
`304` sem corpo.

```
$ npm run data:sync          # segunda execução, nada mudou
  · servants               304 — inalterado
  · equips                 304 — inalterado
  ...
Nada mudou — nenhum byte de payload transferido.
```

O `data:check` vai além e nem baixa: faz `HEAD` em cada arquivo e consulta
`/info` (~1 KB), que devolve hash e timestamp do gamedata por região:

```json
{ "JP": { "hash": "489221", "timestamp": 1786287664 } }
```

Comparando esse hash com o do manifest você sabe se os dados locais envelheceram
sem transferir nada.

### O manifest

`raw/manifest.json` é **versionado no git** (única exceção ao `raw/` ignorado).
Guarda por arquivo: `etag`, `lastModified`, `bytes`, `sha256`, `syncedAt`; e no
topo o `gameDataHash` do sync. Isso registra de qual versão dos dados os
artefatos foram gerados — sem ele, um clone não sabe se está atualizado.

---

## 3. Saída

`public/data/` (gitignored, reconstruível):

| Arquivo | Tamanho | Carregamento |
|---|---:|---|
| `index.json` | 769 KB | **inteiro no browser** — todos os servos e CEs, campos filtráveis |
| `constants.json` | 82 KB | inteiro (dominado pela matriz de classe) |
| `traits.json` | 4 KB | inteiro — 89 traits de identidade por frequência |
| `mysticCodes.json` | 56 KB | inteiro |
| `meta.json` | <1 KB | inteiro |
| `servant/{id}.json` | 12 KB mediana | sob demanda |
| `equip/{id}.json` | — | sob demanda |

Carga inicial do site: **855 KB**. Total em disco: 10,4 MB (de 86 MB de dumps).

---

## 4. Armadilhas conhecidas

Cada uma já mordeu ou quase mordeu. Não desfaça sem ler.

### `basic_servant` e `nice_servant` discordam

Fontes diferentes do Atlas dão respostas diferentes para os mesmos campos:

| | `basic_servant` | `nice_servant` (o que ingerimos) |
|---|---|---|
| Servos jogáveis | 462 | **466** |
| Servos welfare | 56 | **57** |
| Rarity da Mash | 3 | **4** |

Qualquer conferência feita contra o `basic` vai discordar do build. O projeto usa
o `nice`; `data:validate` também.

### Três divisores de unidade, sem marcação no dado

`svals[].Value` significa coisas diferentes conforme o `funcType`: `/10` para
percentuais de buff e multiplicador de NP, `/100` para carga de NP, valor plano
para HP e estrelas. Tabela completa em [`SCHEMA.md`](SCHEMA.md) §2, implementação
em [`src/core/units.ts`](../src/core/units.ts).

funcType fora da tabela devolve `valueUnit: "unknown"` e os valores ficam **crus** —
deliberado: expor a ignorância é melhor que converter errado em silêncio.
Cobertura atual: 97,8% dos efeitos têm unidade conhecida.

### `atkMax` não é o ATK máximo

É o ATK no nível *natural* máximo. Artoria: `atkMax = 11221` (lv90) mas
`atkGrowth[119] = 14418` (lv120). O campo é **descartado** na ingestão para que
ninguém o use por engano.

### Rank ups são a maioria

245 de 466 servos têm mais de uma versão da mesma skill; 190 têm 2 NPs. A regra é
"maior `priority` vence"; as substituídas ficam em `previousVersions[]` /
`npAlternatives[]`.

---

## 5. Se o Atlas mudar de schema

1. `npm run data:validate` falha e diz qual check quebrou.
2. Compare o campo em `raw/JP/*.json` com o que [`src/ingest/atlas.ts`](../src/ingest/atlas.ts) espera.
3. Ajuste `atlas.ts` (formato bruto) e/ou [`transform.ts`](../src/ingest/transform.ts) (tradução).
4. **Não** ajuste `src/core/model.ts` para acomodar o Atlas — o modelo canônico é
   nosso contrato; ele muda quando *nós* decidimos, não quando a fonte muda.
5. Se um valor esperado da validação mudou de propósito, atualize o valor **e** o
   documento que o cita (`SCHEMA.md` ou `PLANO.md`), no mesmo commit.
