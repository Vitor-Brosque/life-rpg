# LIFE RPG

Sistema pessoal de vida, produtividade e aprendizagem com identidade de RPG medieval em pixel art.
É um app web instalável (PWA), feito para uma pessoa só: funciona sem internet, usa o iPhone como aparelho
principal e o computador para escrever e para o Painel no monitor secundário.

- **Agora:** uma missão por vez, blocos do dia, tipo do dia, cronômetro opcional e captura rápida com "+".
- **Semana:** rotina em blocos, objetivos, revisão semanal e experimento, quadro e compromissos.
- **Estudo:** revisão espaçada com orçamento de tempo, notas com lacunas, código e "Tópico", lousas,
  imagens e áudio, resposta falando e prática técnica guiada.
- **Corpo e casa:** sono, treinos, cardápio, lista de compras, freezer e preparo em lote.
- **Padrões:** tendências, adiamentos e associações, sempre separando observado de hipótese.
- **Personagem e Mundo:** XP por esforço, atributos, mapa em pixel art com territórios e NPCs, cores
  desbloqueáveis e companheiro.
- **IA opcional:** pistas, sugestão de cards e resumo da semana, desligada sem chave.
- **Sincronização e backups:** dados no aparelho, cópia no seu servidor e backup diário.

Como usar, tela por tela: [guia de uso](docs/guia-de-uso.md).

## Usar neste computador

Dê dois cliques no atalho **LIFE RPG** da Área de Trabalho (ou em `LIFE RPG.cmd`, nesta pasta). Ele
roda `npm install` (para instalar sozinho qualquer dependência nova), reconstrói o app, sobe o servidor e
abre o navegador em <http://localhost:8787>. A janela do servidor
abre minimizada na barra de tarefas: deixe-a aberta enquanto usa, porque fechá-la desliga o app.
Se precisar recriar o atalho, aponte-o para `LIFE RPG.cmd`, com o ícone `LIFE RPG.ico`
(gerado por `npm run icons`).

Pelo terminal, o mesmo comando é:

```bash
npm run local -- --open
```

- **Seus dados** ficam em `data/` (banco `life-rpg.sqlite`, backups diários em `data/backups/`).
  A pasta não vai para o git. Não apague `data/` nem `data/vapid.json`.
- **O servidor só aceita conexões deste computador** (`127.0.0.1`).
- **Instalar como app:** no Chrome ou Edge, use o ícone "Instalar" na barra de endereço. O app abre em
  janela própria, funciona sem o servidor ligado e sincroniza quando ele volta.
- **Sincronização e backup:** no app, vá em Personagem → engrenagem → Sincronização e cole o código que
  está no arquivo `data/token`. Basta uma vez por navegador. Sem isso o app funciona, mas os dados ficam
  só no navegador, sem a cópia do servidor e sem os backups.
- **Painel no monitor secundário:** abra <http://localhost:8787/painel> numa janela à parte.
- **IA opcional (paga):** para ligar as ajudas de IA, defina `ANTHROPIC_API_KEY` como variável de ambiente do
  **usuário** do Windows e reabra o app. Sem a chave, nenhum controle de IA aparece. Cada pedido é cobrado
  na sua conta da Anthropic, e há um teto diário de pedidos (`LIFE_RPG_AI_DAILY_LIMIT`, padrão 30). Detalhes
  em [deploy/README.md](deploy/README.md) e no [guia de uso](docs/guia-de-uso.md#10-ia-opcional).

## Desenvolver

```bash
npm install
npm test            # todos os testes
npm run dev:server  # API em http://localhost:8787 (dados em ./data)
npm run dev:web     # app com recarga automática em http://localhost:5173
```

O app de desenvolvimento (porta 5173) guarda dados num navegador separado do app normal (8787).
Para não misturar dados de teste com os reais, não conecte a sincronização nele.

## Levar para o homelab depois

1. Pare o app aqui (feche a janela do `LIFE RPG.cmd`).
2. Siga [deploy/README.md](deploy/README.md) para subir o container no homelab.
3. Antes da primeira abertura lá, copie a pasta `data/` deste computador para `~/projects/life-rpg/data/`
   no homelab. Assim o banco, o código de acesso e as chaves de notificação continuam os mesmos.
4. Em cada aparelho, abra o endereço novo e conecte a sincronização com o mesmo código.

No homelab, o app precisa ser servido por **HTTPS**, com `tailscale serve`, como
[deploy/README.md](deploy/README.md) explica. Sem HTTPS, o iPhone não instala o app como PWA, não libera o
microfone (gravar áudio e responder falando) e não entrega notificações. Lá, a chave da IA fica no arquivo
`.env` do servidor, também descrito em `deploy/README.md`.

## Especificações

O que cada marco construiu e por quê:

- [Marco 1 — Fundação e Agora](docs/superpowers/specs/2026-11-11-marco1-fundacao-agora-design.md)
- [Marco 2 — Semana em blocos](docs/superpowers/specs/2026-11-11-marco2-semana-em-blocos-design.md)
- [Marco 3 — Revisão espaçada](docs/superpowers/specs/2026-11-12-marco3-revisao-espacada-design.md)
- [Marco 3b — Superfícies de raciocínio (lousas e editor de código)](docs/superpowers/specs/2026-11-12-marco3b-superficies-de-raciocinio-design.md)
- [Marco 3c — Mídia (imagens, áudio, resposta falada, ouvir)](docs/superpowers/specs/2026-11-13-marco3c-midia-design.md)
- [Marco 3d — Prática técnica](docs/superpowers/specs/2026-11-13-marco3d-pratica-tecnica-design.md)
- [Marco 4 — Corpo e casa](docs/superpowers/specs/2026-11-13-marco4-corpo-e-casa-design.md)
- [Marco 5 — Padrões](docs/superpowers/specs/2026-11-13-marco5-padroes-design.md)
- [Marco 6 — Mundo RPG](docs/superpowers/specs/2026-11-13-marco6-mundo-rpg-design.md)
- [Marco 7 — Inteligência (IA opcional)](docs/superpowers/specs/2026-11-13-marco7-inteligencia-design.md)

Ver também a [visão do produto](docs/visao-do-produto.md) e o [guia de uso](docs/guia-de-uso.md).
