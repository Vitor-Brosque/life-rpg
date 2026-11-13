# Deploy do LIFE RPG no home_lab

O servidor roda em Docker no Ubuntu do home_lab e é acessado pelo iPhone via Tailscale (HTTPS).

## 1. Enviar e subir

No Windows (Git Bash), a partir da raiz do repositório:

```bash
./deploy/deploy.sh
```

O script envia o estado **commitado** do branch atual (via `git archive`, que funciona no Git Bash do Windows) para `homelab:~/projects/life-rpg/` e executa `docker compose up -d --build`. A pasta `data/` do servidor nunca é tocada. Pré-requisito: o Tailscale ligado neste PC, para o alias `homelab` responder.

## 2. Expor com HTTPS via Tailscale

O iPhone só aceita notificações push em páginas HTTPS. Confira o que já está publicado:

```bash
ssh homelab "sudo -n tailscale serve status"
```

Se a porta 443 estiver livre:

```bash
ssh homelab "sudo -n tailscale serve --bg --https=443 http://127.0.0.1:8787"
```

Se a 443 já estiver em uso por outro serviço, use a 8443:

```bash
ssh homelab "sudo -n tailscale serve --bg --https=8443 http://127.0.0.1:8787"
```

A URL final será `https://<nome-da-maquina>.<tailnet>.ts.net` (acrescente `:8443` se for o caso).

## 3. Token de acesso

O token é gerado na primeira execução. Os arquivos em `data/` pertencem ao root (criados pelo container), por isso use `sudo -n`:

```bash
ssh homelab "sudo -n cat ~/projects/life-rpg/data/token"
```

Cole o token na tela de configuração do app.

## 4. Instalar no iPhone

1. Abra a URL HTTPS no Safari.
2. Toque em Compartilhar e depois em **Adicionar à Tela de Início**.
3. Abra o app pelo ícone da Tela de Início (necessário para receber notificações no iOS).
4. Em Configurações do app, informe o token e ative as notificações; aceite a permissão do iOS.

## Backups e dados

Tudo fica em `~/projects/life-rpg/data/`: banco (`life-rpg.sqlite`), `token`, `vapid.json` (chaves de push) e `backups/` (um backup diário por volta das 03h, mantendo os 14 mais recentes). Não apague `vapid.json`: sem ele as inscrições de push existentes deixam de valer.

As imagens e os áudios dos cards ficam em `data/media/` (um arquivo por conteúdo, nomeado pelo SHA-256). O backup diário espelha essa pasta em `data/backups/media/` com links físicos: não ocupa espaço extra e nada é apagado de lá. Para recuperar uma mídia apagada por engano:

    ssh homelab "cd ~/projects/life-rpg && sudo -n cp -n data/backups/media/* data/media/"

Opcional: a variável de ambiente `LIFE_RPG_VAPID_SUBJECT` (por exemplo `mailto:voce@exemplo.com`) define o contato informado aos serviços de push; o padrão é `mailto:life-rpg@example.com`.

## IA opcional (Marco 7)

Sem chave, o app funciona igual e não mostra nenhum controle de IA. A IA é paga: cada pedido é cobrado na sua conta da Anthropic, e o teto diário (`LIFE_RPG_AI_DAILY_LIMIT`) limita quantos pedidos, e portanto o gasto, podem acontecer por dia. Para ligar:

1. Crie uma chave na Console da Anthropic.
2. Grave a chave no servidor, fora do repositório (o `deploy.sh` nunca apaga esse arquivo):

   ```bash
   ssh -t homelab "nano ~/projects/life-rpg/.env && chmod 600 ~/projects/life-rpg/.env"
   ```

   com o conteúdo:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   LIFE_RPG_AI_DAILY_LIMIT=30
   ```

3. Suba de novo: `./deploy/deploy.sh` (ou `ssh homelab "cd ~/projects/life-rpg && docker compose up -d"`).
4. Confira: `ssh homelab "curl -s -H 'Authorization: Bearer <token>' http://127.0.0.1:8787/api/ai/status"` deve responder `{"available":true,...}` (troque `<token>` pelo conteúdo de `data/token`, o mesmo código de acesso de Ajustes → Sincronização). O log do container mostra "IA: ligada".
5. No app: Ajustes → "Inteligência (opcional)", e ligue só as ajudas que quiser.

No notebook (`LIFE RPG.cmd`), defina `ANTHROPIC_API_KEY` como variável de ambiente do usuário do Windows e reabra o app.

O que vai para a API: só o que cada ajuda mostra em "O que é enviado", quando você toca no botão. A chave nunca sai do servidor. `LIFE_RPG_AI_DAILY_LIMIT` (1 a 1000, padrão 30) limita os pedidos por dia (e com isso o custo máximo do dia); o log mostra uma linha por pedido, com tokens, sem conteúdo.

## Restaurar um backup

Troque `AAAA-MM-DD` pela data do backup desejado (veja os disponíveis com `ssh homelab "sudo -n ls ~/projects/life-rpg/data/backups"`):

```bash
ssh homelab "cd ~/projects/life-rpg && sudo -n docker compose stop"
ssh homelab "cd ~/projects/life-rpg && sudo -n cp data/backups/life-rpg-AAAA-MM-DD.sqlite data/life-rpg.sqlite"
ssh homelab "cd ~/projects/life-rpg && sudo -n rm -f data/life-rpg.sqlite-wal data/life-rpg.sqlite-shm"
ssh homelab "cd ~/projects/life-rpg && sudo -n docker compose start"
```

Não é preciso fazer nada nos aparelhos: na próxima sincronização cada um percebe que o servidor voltou no tempo e reenvia automaticamente tudo o que tem, então o que foi feito depois do backup volta para o servidor. Para garantir, abra o app em todos os aparelhos logo depois de restaurar, antes de registrar coisas novas.
