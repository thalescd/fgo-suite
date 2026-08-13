# MCP — os dados como ferramenta de assistente

Servidor stdio que expõe a busca e a calculadora como tools tipadas. É a entrega
2 do projeto: em vez de o assistente responder de memória — que para números de
FGO sai plausível e errado —, ele executa `core/` e devolve o resultado com as
premissas junto.

---

## 1. Instalar

Nada a fazer, se você abrir o projeto no Claude Code:
[`.mcp.json`](../.mcp.json) está versionado, o cliente lê e pergunta se pode
usar. É a mesma razão do resto do projeto ser documentado — quem herdar não
precisa descobrir a configuração.

```json
{ "mcpServers": { "fgo": { "command": "npx", "args": ["tsx", "src/mcp/server.ts"] } } }
```

Requer `npm install` e `npm run data:build` antes: o servidor lê
`public/data/`, que é gitignored e reconstruível.

Para registrar só na sua máquina, ou em outro cliente, aponte o mesmo comando
na configuração dele. O servidor **não** depende do diretório de trabalho — a
raiz sai de `import.meta.url`, porque cliente nenhum garante de onde inicia o
processo.

---

## 2. Como o assistente descobre as tools

Duas camadas, e só a primeira é manual.

**Registro** é o `.mcp.json` acima. Nada se anuncia sozinho.

**Descrição** é automática: o cliente chama `tools/list` na inicialização e
recebe nome, descrição e JSON Schema de cada tool. **É só isso que o assistente
vê** — não o código, não o `PLANO.md`, não este arquivo.

Daí a regra que organiza [`server.ts`](../src/mcp/server.ts): a `description` de
cada tool **é** a documentação. Ela diz o que a tool devolve, o que assume por
padrão e o que não modela. Descrição preguiçosa não é falta de capricho; é o
modelo chutando argumento.

Pelo mesmo motivo, tudo ali é em inglês, como `assumptions` (DAMAGE.md §5).

---

## 3. As tools

| Tool | Para quê |
|---|---|
| `search_servants` | os mesmos filtros de `?class=&rarity=&np=&cap=` |
| `get_servant` | detalhe curado de um servo |
| `calculate_damage` | os mesmos parâmetros de `/calc?…`, com a auditoria |
| `list_capabilities` | as 170 tags, para não chutar nome de filtro |

### O que cada uma faz de propósito

**Filtro que não casa é dito em voz alta.** `capabilities: ["np_charge_9000"]`
devolve `unknownCapabilities`, não uma lista vazia. Lista vazia silenciosa faz o
assistente concluir "não existe servo assim" quando o erro era de digitação.

**Referência a servo aceita qualquer coisa** — nome, apelido, `collectionNo`,
id — porque passa pelo mesmo motor de busca da tela. `auo` acha o Gilgamesh.

**`get_servant` insiste em três coisas** que são fáceis de errar de memória: que
`noblePhantasms` pode ter mais de uma entrada (R24), que os efeitos do NP estão
em ordem de execução com `[before damage]` marcado (D20), e que passiva de
classe é automática enquanto append não é.

**`calculate_damage` devolve o link.** `viewInBrowser` é o `/calc?…` que
reproduz o cenário na tela, então dá para conferir sem remontar nada à mão.

**E devolve o que não contou.** `notCounted` traz cada buff recusado com o
motivo. É o campo que permite perceber que faltou marcar uma skill, em vez de
aceitar um número baixo como verdade.

---

## 4. Uma lógica, três cascas

O servidor monta a query string e chama `parseCalc` → `toDamageInput` →
`calculateDamage`, exatamente o caminho da tela. Não existe segunda montagem de
cenário.

```
    tela            MCP            validação (R4)
      \              |              /
       core/scenario.ts   ← query string <-> cenário <-> DamageInput
              |
        core/damage.ts    ← a fórmula, uma vez só
```

Foi para isso que `counted`, `selectableNps` e o próprio `scenario.ts` foram
parar em `core/` durante a fase 3. Se qualquer um deles vivesse no React, o
servidor teria que redescobrir a regra — e daria uma resposta diferente da tela
sem ninguém notar.

Um teste compara o número da tool com o do núcleo pelo caminho da tela; se as
duas superfícies divergirem, ele falha.

---

## 5. O que não está aqui

| | |
|---|---|
| Craft Essence e Mystic Code no cálculo | fase 5a — `core/` já resolve, falta o parâmetro |
| Suporte | fase 5b — idem |
| Comparação lado a lado | fase 5d |
| Busca de CEs | a tool cobre servos; a tela cobre os dois |
| Resources e prompts do MCP | só tools por enquanto |

E a ressalva que acompanha todo cálculo: `validation` diz quantos cenários já
foram conferidos contra fonte externa. O número é **lido de
`data/validation.json`**, não escrito à mão — uma ressalva literal envelheceria
calada enquanto os casos são preenchidos. Ver [`VALIDATION.md`](VALIDATION.md).
