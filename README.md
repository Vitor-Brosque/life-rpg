# LIFE RPG

Sistema pessoal de vida, produtividade e aprendizagem com identidade de RPG medieval em pixel art.
O que já existe e por quê: [especificação do Marco 1](docs/superpowers/specs/2026-11-11-marco1-fundacao-agora-design.md).

## Usar neste computador

Dê dois cliques em **`LIFE RPG.cmd`**. Ele reconstrói o app, sobe o servidor e abre o navegador em
<http://localhost:8787>. Deixe a janela preta aberta enquanto usa; fechar a janela desliga o app.

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
