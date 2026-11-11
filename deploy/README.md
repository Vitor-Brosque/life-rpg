# Deploy do LIFE RPG no home_lab

O servidor roda em Docker no Ubuntu do home_lab e é acessado pelo iPhone via Tailscale (HTTPS).

## 1. Enviar e subir

No Windows (Git Bash), a partir da raiz do repositório:

```bash
./deploy/deploy.sh
```

O script sincroniza o projeto com `homelab:~/projects/life-rpg/` (sem `node_modules`, `data` e `.git`) e executa `docker compose up -d --build`.

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

O token é gerado na primeira execução:

```bash
ssh homelab "cat ~/projects/life-rpg/data/token"
```

Cole o token na tela de configuração do app.

## 4. Instalar no iPhone

1. Abra a URL HTTPS no Safari.
2. Toque em Compartilhar e depois em **Adicionar à Tela de Início**.
3. Abra o app pelo ícone da Tela de Início (necessário para receber notificações no iOS).
4. Em Configurações do app, informe o token e ative as notificações; aceite a permissão do iOS.

## Backups e dados

Tudo fica em `~/projects/life-rpg/data/`: banco (`life-rpg.sqlite`), `token`, `vapid.json` (chaves de push) e `backups/` (um backup diário por volta das 03h, mantendo os 14 mais recentes). Não apague `vapid.json`: sem ele as inscrições de push existentes deixam de valer.
