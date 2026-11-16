# LIFE RPG — guia de uso

Este guia explica como usar o LIFE RPG no dia a dia, do primeiro acesso ao Painel no monitor secundário.
O app é seu e de mais ninguém: funciona sem internet, guarda tudo no aparelho e sincroniza com o seu
servidor quando ele está por perto.

Uma ideia atravessa o app inteiro: **um dia parado não apaga nada**. Nada zera, nada decai, nada é
"atraso". Quando o app mostra números, eles são o que foi observado, sem nota e sem cobrança.

## Sumário

1. [Primeiros passos](#1-primeiros-passos)
2. [Um dia típico](#2-um-dia-típico)
3. [A semana](#3-a-semana)
4. [Estudo](#4-estudo)
5. [Corpo e casa](#5-corpo-e-casa)
6. [Padrões](#6-padrões)
7. [Personagem e Mundo](#7-personagem-e-mundo)
8. [Painel no monitor secundário](#8-painel-no-monitor-secundário)
9. [Ajustes](#9-ajustes)
10. [IA opcional](#10-ia-opcional)
11. [Backups e dados](#11-backups-e-dados)
12. [Perguntas frequentes e quando algo não funciona](#12-perguntas-frequentes-e-quando-algo-não-funciona)
13. [Base científica, com honestidade](#13-base-científica-com-honestidade)

A barra de navegação tem cinco abas: **Agora**, **Planejar**, **Estudo**, **Diário** e **Personagem**. Jornadas fica no **Planejar**.
Corpo, Padrões, Mapa e Ajustes abrem a partir do **Personagem**. O Painel abre em `/painel`.

---

## 1. Primeiros passos

### Onboarding

No primeiro acesso, o app mostra "Boas-vindas ao LIFE RPG" com duas opções:

- **Começar do zero:** quatro passos curtos.
  1. **Seu personagem:** escolha um nome e uma aparência. Dá para mudar depois, em Personagem.
  2. **O que está ocupando sua cabeça agora?** Escreva uma ideia por linha. Cada linha vira uma missão.
     Tirar da cabeça já alivia.
  3. **Qual delas dá para começar em 5 minutos?** A escolhida vira a primeira do plano de hoje.
  4. Você cai na tela **Agora**.
- **Já uso em outro aparelho:** digite o código de acesso do servidor e seus dados vêm de lá
  (veja "Conectar a sincronização", abaixo).

Funciona sem internet: tudo fica salvo neste aparelho.

### Instalar no iPhone

O LIFE RPG é um app web (PWA). No iPhone:

1. Abra o endereço do app no **Safari** (no homelab, é o endereço HTTPS do Tailscale).
2. Toque em **Compartilhar**.
3. Toque em **Adicionar à Tela de Início**.
4. A partir daí, abra sempre pelo ícone da Tela de Início.

Abrir pelo ícone é necessário para receber notificações no iOS: o iPhone só entrega notificações
de apps instalados, e só em páginas HTTPS.

No computador, no Chrome ou no Edge, use o ícone "Instalar" da barra de endereço. O app abre em janela
própria e continua funcionando sem o servidor ligado.

### Conectar a sincronização

A sincronização copia seus dados para o servidor, faz os backups e leva tudo para os outros aparelhos.
Sem ela o app funciona, mas os dados ficam só no navegador daquele aparelho.

1. Descubra o **código de acesso**: ele está no arquivo `data/token`, na pasta do app no servidor
   (neste computador, a pasta `data/` do projeto; no homelab, `~/projects/life-rpg/data/token`).
2. No app, vá em **Personagem → engrenagem → Sincronização**.
3. Cole o código no campo **Código de acesso**.

Basta uma vez por aparelho ou navegador. A seção mostra a **Situação** e quantos registros estão
**Pendentes**. Pendente não é problema: são mudanças que esperam o servidor aparecer.

---

## 2. Um dia típico

### A tela Agora

O Agora responde "o que faço agora?" sem exigir que você decida antes. De cima para baixo:

- **Faixa de status:** avatar e nível, sua energia atual (definida pelo tipo do dia; toque para ajustar),
  o tempo livre até o próximo compromisso e o indicador de sincronização.
- **Tipo do dia**, em um chip no topo.
- **Bloco atual**, quando há um em andamento.
- **Cuidados:** a faixa de sono e refeição (veja abaixo).
- **Missão agora:** um único cartão, com o primeiro passo em destaque.
- **Também cabe agora:** duas ou três alternativas. Tocar numa delas a promove ao cartão principal.
- **Hoje:** a lista do dia.

### "Como está hoje?"

No primeiro acesso do dia útil, o card **Como está hoje?** pergunta como você quer o dia. Não há
resposta certa, e dá para trocar depois pelo chip no topo da tela.

| Tipo | O que faz com os blocos |
|---|---|
| **Normal** | Todos os blocos, na versão normal. |
| **Baixa energia** | Versão mínima, sem complementos. |
| **Recuperação** | Só o essencial protegido. |
| **Livre** | Sem blocos e sem cobrança. A tela diz "Dia livre. Descanso também conta." |

Sábado e domingo começam como dia livre, sem revisão vencendo e sem cobrança.

A resposta também define a **energia do dia** (Normal e Livre = média; Baixa energia e Recuperação =
baixa): é uma pergunta só por dia. O botão de energia no topo serve para ajuste fino e vale até você
escolher o tipo do dia de novo. Se o card aparecer de novo no mesmo dia, confira se os aparelhos estão
conectados à sincronização: sem ela, cada aparelho pergunta separado.

### Blocos

Um dia útil é feito de **blocos**: faixas de tempo com uma atividade combinada (por exemplo, o bloco
do Tech News, estudo, treino, rotinas de início e fim do dia). Você não decide o quê, só começa.

No cartão do bloco atual:

- **Começar bloco** inicia o bloco.
- **Versão mínima** troca para a versão curta do bloco. Começar pouco já conta.
- **Pular hoje** deixa o bloco de hoje de lado, sem registro negativo.
- **Encerrar bloco** fecha quando você terminar. A folha pergunta, se você quiser, **Como foi?** (Feito, Parcial
  ou Não deu), **O que saiu?** em uma linha e a próxima ação. **Encerrar sem anotar** continua sendo um toque.
- **Escapei** (ícone da porta) é um registro de um toque para quando você percebe que escapou para
  outra coisa. Notar já é a parte útil. Você escolhe para onde escapou (por exemplo, YouTube, Redes ou
  Outra) e nada mais é cobrado.

**Começar tarde encolhe o bloco** até a versão mínima, sem empurrar o resto do dia. Se o horário do bloco
acaba, o Agora avisa e oferece "Voltar agora", sem drama. Blocos de rotina (por exemplo, o início do dia)
têm um checklist e o botão **Concluir rotina**.

### O cartão da missão

Os botões do cartão principal:

- **Começar** abre a ficha da missão (primeiro passo, checklist, notas). Começar nunca liga o
  cronômetro sozinho.
- **Concluir** conclui e dá o XP. Há um aviso "Desfazer" por alguns segundos. Depois, na ficha da missão
  concluída, o campo **O que saiu?** guarda em uma linha o que ficou pronto (opcional).
- **Parcial** aparece quando a missão está em andamento: anote, se quiser, **O que saiu?** e a **Próxima ação**
  (que vira o primeiro passo da próxima vez) e escolha quando ela volta (Mais tarde hoje, Amanhã ou Escolher
  dia). Parcial é progresso: não conta como adiamento.
- **Outra** mostra a próxima sugestão.
- **Encolher** pergunta "Qual é uma versão de 5 minutos?" e guarda como primeiro passo.
- **Agora não** oferece **Mais tarde hoje**, **Amanhã** ou **Escolher dia**, e um **Motivo (opcional)**: Sem tempo,
  Sem energia, Não sei por onde começar, Falta algo ou Outra prioridade. Os motivos marcados aparecem em
  Padrões → Adiamentos. Se a missão já tinha sido
  adiada antes, aparece também **Fazer um plano (opcional)**: escolha **Quando?** (um bloco da semana) e
  **Então, o primeiro passo**. **Guardar para o próximo {bloco}** reagenda a missão para o próximo dia em
  que esse bloco acontece (pulando dias livres) e, durante o bloco, ela vira a sugestão de foco. O cartão
  mostra "Plano: {bloco}". Um plano "se–então" ajuda, em média, a transformar intenção em início
  numa ocasião concreta; por isso ele aparece só para o que já foi adiado, sem virar burocracia.

Se uma missão foi adiada várias vezes, o cartão mostra **Encolher**, **Dividir** e **Soltar** com uma
frase gentil. Soltar é uma estratégia legítima, não um fracasso. Dentro de um compromisso, o cartão
mostra o compromisso e o que vem **Depois**.

### O card de início ("Antes de começar")

Ao começar algo que você vinha adiando, pode aparecer um card curto: "Leva meio minuto e dá para
pular." Ele pergunta como você está se sentindo (Ansiedade, Tédio, Incerteza, Cansaço, Medo de errar ou
Outro) e o que o pensamento diz. Daí vêm três saídas:

- **Experimento de 10 minutos:** só começar por 10 minutos e decidir depois.
- **Só começar.**
- **Pular.**

Em **O que trava? (opcional)** você aponta a dificuldade concreta (não sei por onde começar, falta informação,
é grande demais, medo de errar, chato ou sem vontade) e o card sugere uma primeira ação. **Usar como primeiro
passo** guarda essa ação na missão com um toque; "É grande demais" abre o Encolher ali mesmo.

Dá para desligar em **Ajustes → Foco** ("Card de início ao começar algo adiado"). Os registros ajudam a
tela de Padrões, nunca são cobrados.

### Cronômetro de foco

O cronômetro nunca inicia sozinho e nunca bloqueia o resto do app. Fica numa barra pequena acima da
navegação (no Painel, em um cartão grande). Modos: **Livre** (o padrão), **Pomodoro** ou regressivo
(**Minutos**). Você pode **Pausar**, **Retomar**, **Parar** e anotar. Ao terminar, o app pergunta
"Quer continuar?" ou "Como seguir?", e há uma saída sem culpa: **Parar aqui — já valeu**.
Se interromper, o motivo é opcional.

No modo Livre, pause quando sentir que caiu, ou ao fim de uma etapa: nos estudos com universitários,
pausas no próprio ritmo funcionaram tão bem quanto o Pomodoro e foram sentidas como menos cansativas.
Os minutos de pausa e foco do Pomodoro, para quem prefere um ritmo fixo, ficam em **Ajustes → Foco**.
A pausa só começa quando você tocar.

### Cuidados: sono e refeição

Logo abaixo da faixa de status, a faixa **Cuidados** mostra só o que vale agora:

- **Deitei:** à noite (das 20h às 5h, fora de compromissos), toque para marcar a hora de deitar.
- **Acordei:** de manhã (das 5h ao meio-dia), ou a qualquer hora depois de "Deitei" nas primeiras 16 horas.
  Depois do toque aparece **Como foi o sono?** de 1 a 5, com **Pular**: é opcional e some ao responder.
- **Comi uma:** na janela do almoço (10h às 16h) ou do jantar (a partir das 17h), mostra o prato do
  cardápio. Se há porção dele no freezer, o botão tira uma. Sem prato planejado, nada aparece.

Dá para desligar "Deitei" e "Acordei" em **Ajustes → Sono**.

### Capturar com "+"

O botão **+** (flutuante, acima da navegação) abre a captura. Escreva só o que precisa fazer; o resto é toque.
Nada é gravado antes de **Salvar** (ou Enter no campo).

- **Tipo**, no topo: **Tarefa** (o padrão), **Compromisso**, **Prova ou trabalho** ou **Card**. Trocar o tipo
  mantém o que você escreveu.
- **Tarefa:** abaixo do campo ficam as linhas **Quando** (Sem data, Hoje, Amanhã ou Escolher dia), **Repetir**
  (todo dia, semanal, mensal ou após concluir), **Jornada** (as disciplinas aparecem sob "Faculdade"; **Nova
  jornada…** cria a jornada quando você salva), **Área**, **Duração**, **Energia** e o interruptor
  **Importante**. Toque numa linha para abrir as opções dela logo abaixo; toque de novo para fechar.
- **Compromisso:** o que é, **Dia**, **Início**, **Fim** (sugere uma hora depois do início), **Toda semana**
  (marque os dias; com algum dia marcado aparece **Até**, opcional) e **Lembrar antes**.
- **Prova ou trabalho:** **Prova** ou **Trabalho**, **Matéria** (as disciplinas de Matérias), **Data** e o
  **Conteúdo** (opcional, vai para as notas). O título sai pronto: "Prova de Cálculo II".
- **Card:** o campo é a frente; escolha o **Baralho** ou deixe na Caixa de entrada. Vira rascunho para completar
  em Estudo ("Vira rascunho de card. Complete depois na aba Estudo.").
- **Várias linhas** (Tarefa e Card): cada linha vira um item, na ordem, e as escolhas valem para todas. Colou dez
  passos de um projeto? Toque em **Jornada → Tech News** uma vez e salve.
- Se faltar algo, a folha diz o quê ("Escolha o dia e o início.") e nada é gravado.

Se preferir digitar, "amanhã", "15h" e "toda seg" também são entendidos: as linhas acendem sozinhas, e um toque
sempre vence o texto.

### Revisão rápida

Na primeira abertura do dia, se há missões para reavaliar, aparece um card dispensável: "Hoje, outro dia ou
soltar — você escolhe. Nada aqui é atraso." Para cada missão há **Hoje mesmo assim**, **Amanhã**,
**Escolher dia**, **Encolher** e **Soltar**, com motivos opcionais. Dá para **Dispensar** o card.

### "Como foi hoje?" (encerramento do dia)

Em dia que não é livre, a partir das 20h (ou do fim do último compromisso, como uma aula à noite), o
Agora e o Painel mostram o card **Como foi hoje?**: "Dois minutos para fechar o dia. Tudo é opcional.".
O link **Como foi hoje**, no fim do Agora, abre a mesma folha a qualquer hora. Nada disso bloqueia o app, e
**Agora não** esconde o card naquele dia.

A folha mostra:

- **Observado:** blocos iniciados (e em que versão), pulados e não iniciados, missões concluídas e parciais,
  minutos de foco, o treino, cards revisados e sessões de prática encerradas.
- **Pendências de hoje:** Amanhã, Escolher dia ou Soltar para cada uma.
- **Cansaço durante o dia** (Pouco, Médio, Muito) e uma **Observação**, opcionais. A observação não tem limite de
  tamanho e fica no [Diário](#diário) como a entrada **fechamento do dia** (as notas escritas antes desta versão
  passaram para lá sozinhas, sem duplicar).
- **Correções:** ajustar o início e o fim de um bloco, marcar **Fiz, mas não registrei** num bloco que você
  fez sem tocar no app (fica "registrado depois" e não dá XP) e corrigir os minutos de uma sessão de foco ou
  apagá-la (com Desfazer).

**Fechar o dia** guarda o fechamento; abrir de novo mostra "Dia fechado às …" e deixa ajustar cansaço e nota.
A observação só é gravada se você mexeu nela: um texto mais novo (de outro aparelho ou do diário) nunca é trocado
pela cópia que a folha mostrou ao abrir. Se o fechamento estava em Apagadas recentemente com outro texto, esse
texto continua lá, como uma entrada comum do dia, e a observação nova vira o fechamento.

### Diário

A aba **Diário** é um lugar para escrever livremente sobre os seus dias, com as suas palavras. Nada ali é
obrigatório: não há lembrete, sequência, XP nem "faltou" num dia sem entrada.

- **Escrever** abre uma entrada nova, com a data e a hora de agora. É só escrever e sair: a entrada se salva
  sozinha a cada pausa. Texto só com espaços não vira entrada, e uma entrada nova esvaziada antes de sair some.
  Se o iPhone fechar o app em segundo plano, o que você acabou de digitar volta ao abrir a entrada.
- **Mudar data e hora** troca o dia e a hora (o dia segue o início do seu dia: 01:30 conta para o dia anterior).
- Opcionais: **Ligar a…** uma missão ou uma jornada (as disciplinas são jornadas), até 3; **Temas** (Faculdade,
  Carreira, Projetos, Estudo, Saúde, Treino, Sono, Relacionamentos, Família, Lazer, Sentimentos, Ideias); e
  **Privada**, que deixa a entrada fora das exportações, a menos que você a inclua naquela exportação.
- A tela mostra **uma semana** (segunda a domingo), um grupo por dia, o mais recente primeiro, com as entradas na
  ordem da hora. **Semana anterior**, **Próxima semana** e **Mesma semana, mês passado** navegam. As respostas da
  **Nova semana** e da reflexão do mês escritas naquela semana aparecem como cartões só de leitura.
- **Buscar no diário** acha palavras em todas as semanas, sem diferenciar acentos e maiúsculas. Em **Filtros**:
  por tema, por vínculo e **Só privadas**.
- **Apagar** (dentro da entrada) leva para **Apagadas recentemente**, com **Desfazer** na hora. Lá, **Restaurar**
  devolve a entrada; **Apagar de vez** (numa entrada) e **Esvaziar** (todas) pedem confirmação e não têm volta:
  o texto sai do aparelho e, na sincronização, do servidor (num fechamento do dia, a nota antiga daquele dia sai
  junto). Os backups diários do servidor ainda guardam o texto antigo até girarem (14 dias).
- **Exportar semana** gera um arquivo `.md` com as suas palavras, sem alteração, para guardar ou levar a uma
  conversa com uma IA. Na folha: **Período** (setas para trocar a semana), **Incluir entradas privadas**
  (desligado), **Registrado pelo app** (ligado: tipo do dia, blocos iniciados, treino, sono e cansaço, só o que
  existe) e **Revisões da semana e do mês** (ligado). A **Prévia** mostra o texto exato. No iPhone,
  **Compartilhar** abre a folha de compartilhar (Salvar em Arquivos, enviar); no PC, **Baixar** salva o arquivo.

---

## 3. A semana

### O card "Nova semana"

Na segunda de manhã, o Agora mostra o card **Nova semana**, com dois passos curtos (dá para
**Começar** ou **Fazer depois**):

1. **Observado:** os números da semana passada, "sem julgamento".
2. **Sua leitura**, três perguntas opcionais com suas palavras:
   - O que funcionou?
   - Qual foi o maior obstáculo?
   - Que ajuste você quer testar?

O **ajuste** vira o **experimento da semana**: o Agora mostra "Experimento da semana: …" para você
lembrar de testá-lo. Uma semana é pouco para concluir algo, então compare com calma.

Se a IA opcional estiver ligada, um **Resumo da semana** pode aparecer depois da sua leitura
(veja [IA opcional](#10-ia-opcional)). O que ficou aberto na semana passada vem para esta semana, a
não ser que você toque em **Soltar**. Se um bloco tiver caído de forma clara entre a 5ª e a 8ª semana
de uso, o card traz um aviso gentil (veja [Padrões](#6-padrões)).

### Semana atípica

Provas, viagem, doença: em **Planejar → Semana**, o botão **Semana atípica** (ou o link "Esta semana vai
ser atípica?" no card Nova semana) marca a semana, com o motivo (**Provas**, **Viagem**, **Saúde** ou
**Outro**) e quando **o ritmo volta**. Durante ela, o Agora lembra que versões mínimas contam tanto
quanto, e os Padrões não comparam essa semana com as outras: as tendências mostram a barra tracejada,
o aviso das semanas 5–8 pula a semana e os adiamentos dela ficam fora da conta. Na segunda seguinte, o
card Nova semana dá as boas-vindas de volta. Dá para desmarcar a qualquer momento.

### Objetivos da semana

Cada bloco pode ter um objetivo para a semana. Eles aparecem na aba **Planejar → Semana** e vão sendo
marcados conforme você avança.

### Planejar: Semana, Quadro, Rotina, Jornadas e Casa

A aba **Planejar** tem cinco visões. Uma lembrança da última escolhida fica no aparelho.

- **Semana:** a semana em blocos, com setas para semana anterior e próxima. É onde se enxerga
  quais blocos caem em quais dias, compromissos e objetivos. Toque num dia para ver o plano dele.
- **Quadro:** missões em colunas (**Sem data**, **Hoje**, **Em andamento**, **Feito (7 dias)**).
  Use **Mover para…** para trocar de dia, ou arraste.
- **Rotina:** o editor da sua semana-modelo. Cada **bloco** tem nome, dias da semana, horário-alvo,
  **duração**, **versão mínima (min)**, tipo (foco, corpo, estudo, leve ou rotina), área ou jornada e se
  é **protegido** (não some em dia de Recuperação). O primeiro acesso oferece **Criar rotina sugerida**
  (o app faz uma pergunta só: "A que horas você costuma começar o dia?"; o resto é palpite que você ajusta)
  ou **Começar sem rotina**. Horários e durações são palpites: ajuste quando a semana mostrar o que
  funciona. **Copiar este dia para…** duplica a estrutura de um dia em outros. **Editar muda a série
  inteira.** Em cada bloco, o interruptor **Revisão espaçada neste bloco** diz se o Agora deve oferecer
  cards durante ele. No fim da Rotina, **Recorrentes** lista tudo o que repete: as missões com
  repetição (com a próxima data) e os compromissos semanais; toque para editar ou tirar a repetição.
- **Jornadas:** os projetos grandes, com a próxima missão de cada um (veja [Jornadas](#jornadas)).
- **Casa:** cardápio, compras e freezer (veja [Corpo e casa](#5-corpo-e-casa)).

Compromissos (aulas, consultas) entram pelo **+** (tipo **Compromisso**) ou pela folha de compromisso no
Planejar, com a opção **Repetir toda semana em…** (e **Repetir até**, opcional). Os lembretes de compromisso
são notificações do servidor e dependem de **Ajustes → Notificações**.

### Jornadas

A visão **Jornadas**, no **Planejar**, guarda os projetos grandes: um objetivo (o **Resultado esperado**) e várias missões em
ordem. O endereço antigo `/jornadas` abre essa visão. **Só a próxima missão aparece no Agora**, para não virar lista de tarefas. Ao concluir a jornada,
você ganha um bônus de XP. Uma jornada pode ter área, um baralho de estudo e sessões de prática.

---

## 4. Estudo

A aba **Estudo** reúne revisão espaçada, lousas, prática técnica e o progresso por matéria. Ela mostra, de cima para baixo:
**Hoje**, **Rascunhos para completar**, **Baralhos**, **Lousas**, **Prática técnica**, **Próximos dias**,
**Observado** e **Preferências de estudo**.

### Matérias

**Estudo → Matérias** mostra um cartão por matéria: cada disciplina, cada jornada ativa com baralho ou prática
ligada, e cada baralho sem jornada. Em cada uma: cards aprendidos do total (com uma barra), quanto você lembrou
dos cards maduros nos últimos 30 dias (a partir de 20 revisões), minutos de revisão nesta semana,
tópicos, sessões de prática e quantas com Autônomo, e a próxima entrega. Só números observados, sem nota.
Dali você abre a jornada, o baralho ou a revisão só daquele baralho.

**Disciplinas da faculdade.** Sem nenhuma disciplina cadastrada, Matérias oferece **Cadastrar a grade do
semestre?** com uma grade de exemplo (seg Estruturas de Dados, ter Matemática Discreta, qua Banco de Dados, qui
Redes de Computadores, sex Engenharia de Software, das 19h30 às 22h30). **Confirmar** cria uma jornada por disciplina na área
Faculdade e a aula semanal de cada uma; o que já existe com o mesmo nome é reaproveitado e nada é duplicado.
**Editar antes** troca nomes, dias e horários pelos seus. **Nova disciplina** cadastra outra quando a grade mudar.
O compromisso genérico "Aula" nunca é apagado sozinho: o card diz onde apagá-lo.

No cartão de cada disciplina aparecem a aula (dias e horário), a **próxima avaliação** ("em N dias"), "Sem
contato há N dias de estudo" (só a partir de 5), os últimos exercícios e os assuntos por nível. **Abrir
disciplina** leva à tela dela, com:

- **Avaliações:** provas e trabalhos com data (**Nova prova ou trabalho**, ou pelo **+**, tipo **Prova ou trabalho**). Uma avaliação é
  um evento com data: ela aparece em Hoje no próprio dia, não vira sugestão do Agora, não entra nas pendências
  e só muda de data quando você edita.
- **Exercícios:** "Lista 4 · 8 de 10 · 5 sem ajuda" (feitos, total e sem ajuda são opcionais), com Editar e
  Apagar.
- **Assuntos:** cada tema com o nível **Ainda não → Vi na aula → Entendi → Resolvo sem ajuda**. Entender e
  resolver sozinho são coisas diferentes, por isso ficam separados. O histórico das marcas fica guardado.

**Sugestão no bloco Faculdade.** Durante um bloco da área Faculdade (nunca no fim de semana nem em dia Livre),
o Agora mostra **Sugestão para este bloco**: uma disciplina e o motivo, nesta ordem: avaliação nos próximos
14 dias, 5 ou mais dias de estudo sem contato, aula hoje à noite, ou revisar a aula anterior. **Trocar**
mostra a próxima; **Usar** põe a próxima missão daquela disciplina no cartão principal (sem criar nada) ou,
sem missão aberta, oferece revisar o baralho dela ou registrar exercícios. **Escolher outra** desfaz.

### Baralhos e notas

Um **baralho** é um assunto, como SQL ou Faculdade. Ele pode ter jornada, área e um idioma para o botão
**Ouvir**. Comece com um baralho e adicione notas aos poucos: os cards entram na revisão devagar, dentro
do tempo que você escolher por dia.

Cada **nota** gera um ou mais cards. Há **5 tipos**:

| Tipo | Para quê |
|---|---|
| **Pergunta e resposta** | Frente e Verso. |
| **Dois sentidos** | Gera um card para cada direção, bom para vocabulário. |
| **Lacunas** | Texto com trechos escondidos. Selecione o trecho e toque em **Lacuna** (ou Ctrl+Shift+L). Lacunas com o mesmo número viram um card só. |
| **Código** | Um enunciado, a linguagem e a **Solução**. Na revisão você responde programando antes de ver. |
| **Tópico** | Um assunto inteiro para explicar de memória, com **Pontos-chave** (um por linha). |

Trocar o tipo recalcula os cards da nota.

**Tópico (recordação livre).** Em vez de um fato, o card pede para você explicar um assunto sem consultar.
Na revisão, você escreve tudo o que lembra no campo **Sua explicação**, revela e marca na lista de
pontos-chave o que conseguiu cobrir. O app sugere uma nota (todos cobertos, Bom; 60% ou mais, Difícil;
menos, Errei), mas a decisão é sua. Cards de Tópico voltam em intervalos de dias, sem repetir o assunto
10 minutos depois.

**Por quê? (opcional).** Todo tipo de nota tem esse campo. Escreva a explicação ou a intuição por trás da
resposta. Entender o porquê ajuda a lembrar mais do que decorar a forma, e ele aparece na revelação, com
fórmulas renderizadas.

Dicas do editor de notas:

- Ctrl+Enter em **Salvar e próximo** guarda a nota e mantém tipo e baralho, para cadastrar 10 cards seguidos
  sem sair do teclado.
- A **pré-visualização** mostra cada card gerado (ao lado no PC, embaixo no celular).
- Markdown, código com destaque de sintaxe e fórmulas LaTeX (entre `$...$`) funcionam em qualquer campo.
- No editor de código: Tab indenta, Shift+Tab desindenta e Esc sai do campo.
- Dá para colar ou arrastar imagens em qualquer campo.

**Rascunhos.** Um **Card** capturado no **+**, um erro da prática técnica e as sugestões da IA
chegam como rascunhos em **Estudo → Rascunhos para completar**. Eles só viram cards de verdade quando você
completa a resposta e escolhe o baralho. Rascunhos vão para a **Caixa de entrada** se nenhum baralho
foi escolhido.

No baralho, cada nota tem **Editar**, **Suspender** (pausa sem apagar), **Reiniciar progresso** e
**Apagar** (com **Desfazer**). O baralho pode ser **Arquivado** (os cards saem do plano) e só é apagado
quando está vazio.

### A sessão de revisão

Toque em **Revisar** em Estudo → Hoje, ou no card "Revisão espaçada" do Agora, durante um bloco que a
inclua. A tela cheia mostra "Revisão · 3/20 · ~5 min" e **Parar**. Parar não perde nada: cada resposta
é gravada na hora.

Para cada card:

1. A **frente** aparece. Antes de revelar, você pode **responder** de um jeito:
   - **Escrever antes:** um campo para escrever (em cards de código e de tópico já vem aberto).
   - **Desenhar antes:** uma lousa para rabiscar o raciocínio.
   - **Responder falando:** grava sua voz (veja [Imagens e áudio](#imagens-e-áudio)).
   - Ou só pensar. **Mostrar resposta** funciona mesmo com tudo vazio.
2. Ao revelar, você vê a resposta e o **Por quê?**. Se escreveu, "Sua resposta" fica ao lado
   (ou acima) da resposta certa, para comparar.
3. Você avalia: **Errei**, **Difícil**, **Bom** ou **Fácil**. Embaixo de cada botão está o próximo
   intervalo.

Atalhos no PC, quando o foco não está num campo de texto: **Espaço** ou **Enter** revela, **1 a 4**
avaliam, **Z** desfaz a última avaliação e **E** edita o card. **Desfazer** pode ser repetido e não
retira o XP já dado. O menu do card também permite editar e suspender.

Quando você cumpre a meta do dia, aparece "Meta de hoje feita" com **Continuar** ou **Encerrar**.
No fim, um resumo (cards e minutos) e a previsão de amanhã.

### Imagens e áudio

- **Imagens:** cole (Ctrl+V), arraste ou use o botão **Imagem** (no iPhone, tira uma foto na hora).
  Imagens são reduzidas no aparelho (no máximo 1600 px, em torno de 300 KB), e fotos perdem os dados de
  localização. Prints e diagramas pequenos ficam como estão.
- **Desenho:** a folha **Desenho** do editor abre uma lousa e **Inserir no card** coloca o resultado como
  imagem, até num ponto-chave de tópico.
- **Áudio:** a folha **Áudio** grava até 2 minutos (**Gravar**, **Parar**, **Gravar de novo**) ou aceita um
  arquivo MP3, M4A, OGG ou WEBM de até 8 MB. O microfone só é pedido no primeiro toque em Gravar.
- **Ouvir:** em **Editar baralho**, escolha um idioma em **Ouvir em voz alta**. Os cards desse baralho
  ganham um botão **Ouvir** com a voz do aparelho. Nada toca sozinho.
- **Responder falando:** grava sua resposta antes de revelar. Depois de revelar, **Ouvir minha resposta**
  fica ao lado da correta. A gravação não é guardada: some ao trocar de card.

Imagens e áudios sincronizam em segundo plano e depois ficam disponíveis **offline**. Se você criou um
card com imagem no PC, ele aparece com a imagem no iPhone depois da sincronização.

### Lousas

Uma **lousa** é um espaço amplo para contas, fórmulas e diagramas. Crie em **Estudo → Lousas → Nova lousa**.

- **Ferramentas:** Caneta, Borracha e Mover, quatro cores de giz e duas espessuras.
- **iPhone:** um dedo desenha, dois dedos pinçam e deslocam.
- **PC:** a roda rola, Ctrl+roda dá zoom, o botão do meio arrasta.
- Atalhos: Ctrl+Z desfaz, Ctrl+Shift+Z ou Ctrl+Y refazem, `+` e `−` dão zoom, `0` ajusta à tela.
- Uma lousa guarda até 2.000 traços. Com ela cheia, o app avisa gentilmente.

Cada missão e cada sessão de prática também tem a sua lousa, aberta pela ficha.

### Prática técnica

A **sessão de prática** guia você pelo método técnico, do problema à reconstrução sem consulta. Crie em
**Estudo → Prática técnica → Nova sessão**, com título e, se quiser, jornada e missão.

**Os 9 passos.** A navegação é livre pela faixa de passos, e nenhum passo trava outro. Só o título é
obrigatório.

1. **Problema:** em uma ou duas frases, com entradas e saídas.
2. **Fundamentos:** que conceitos o problema usa.
3. **Decompor:** quebre em passos pequenos, na ordem, dizendo que parte do código faz cada um.
4. **Decisões:** as alternativas que você considerou e o que decidiu e por quê.
5. **Implementar:** o editor de código, com os passos para marcar.
6. **Testar:** casos "entrada → esperado", marcando os que passaram. O app não executa código: registre o
   que você testou fora dele.
7. **Feedback:** o que uma pessoa, uma IA ou uma ferramenta disse. Você anota o essencial.
8. **Reconstruir sem consulta:** escreva de novo sem olhar a implementação nem a internet. A
   implementação fica escondida até você comparar. **Mostrar mesmo assim** existe, sem julgamento, e só
   fica registrado como dado observado. **Comparar com a implementação** mostra as duas lado a lado.
   **Refazer reconstrução** começa outra. Depois de comparar, **Reconstruir de novo, sem consultar**
   marca uma nova tentativa **em 3 dias**, **em 1 semana** ou **em 2 semanas**: uma sessão "· de novo"
   que já abre na reconstrução, com a implementação escondida. Lembrar sem ajuda depois de um intervalo
   mostra o que ficou de verdade. Ela aparece na lista como "Reconstrução · dd/mm" e pode ser feita antes.
9. **Fechar:** a explicação em 2 frases e os três indicadores.

**Registro de erros.** Em qualquer passo, **Registrar erro** guarda três campos: o que deu errado (o único
obrigatório), por quê e a ideia correta. **Virar card** cria um **rascunho de card** com a frente
"Erro: …" e a pergunta "Qual é a ideia correta?". O baralho de destino é escolhido por sessão, acima da
lista. Um erro que já virou rascunho mostra o link para ele.

**Os 3 indicadores de autoavaliação.** Ao encerrar a sessão, você marca, separadamente:

- **Entregue:** Não, Parcial ou Sim.
- **Compreendido** ("Consigo explicar com minhas palavras"): Ainda não, Em parte ou Sim. O campo
  "Explique em 2 frases" vem antes, para a nota se apoiar numa explicação de fato.
- **Autônomo** ("Reconstruí sem consultar"): Não, Com consulta ou Sim.

Eles nunca são somados, não têm cor de alerta e não dão XP, para você ver a tendência com honestidade.
"Entregue: não" é um resultado legítimo. O histórico mostra os indicadores das últimas 10 sessões
encerradas, rotulado como observado, a partir de 2 sessões, com quantas **pistas** da IA cada sessão usou
("Pistas: N"). Pista é parte do método; o que importa é o Autônomo nas reconstruções.

**Pausar.** **Pausar** pergunta "Onde parou? Qual a primeira ação da próxima vez?". O Agora, durante um bloco
de foco ou de estudo, oferece **Retomar** a sessão aberta ou começar uma nova com essa primeira ação.
Há XP pequeno por esforço real (encerrar com problema e implementação escritos, e comparar uma
reconstrução), no máximo 3 sessões por dia, e nada pelos valores dos indicadores.

### O orçamento de tempo e os fins de semana

A revisão não acumula porque o plano do dia respeita um **orçamento de tempo**, não uma contagem de cards.
Em **Estudo → Preferências de estudo**:

- **Minutos de revisão por dia:** o orçamento.
- **Teto de cards novos por dia.**
- **Retenção desejada:** de 80% a 95%. Mais retenção significa mais revisões por dia.
- **Dias sem revisão:** por padrão, sábado e domingo. Nesses dias nada vence; cards que cairiam neles são
  movidos para o dia de estudo mais próximo.
- **Lembrete de estudo** (desligado por padrão) e o horário: um aviso por dia de estudo, só se houver
  cards para hoje e a meta ainda não foi cumprida. No iPhone, só funciona com o app na Tela de Início.

Cards novos só entram enquanto a previsão dos próximos dias couber no orçamento, e o app sempre diz o
motivo ("o orçamento de hoje já está ocupado pelas revisões", "teto de 10 novos por dia"). Em dia de
Baixa energia ou Recuperação, o orçamento cai pela metade e entram só revisões. Depois de dias parados, a
carga volta ao normal sem cobrança: cards vencidos esperam sem pressa.

Em **Estudo → Hoje**, o botão **Revisar** mostra o plano (por exemplo, "14 revisões + 6 novos · ~7 min").
Em dia livre aparece "Dia livre · revisar mesmo assim". A seção **Observado** mostra o acerto em cards já
aprendidos nos últimos 30 dias e revisões e minutos da semana, sem meta.

---

## 5. Corpo e casa

### Sono

Em **Personagem → Corpo**, a seção Sono mostra a regularidade **observada** das últimas 14 noites, a
partir de 3 noites completas:

- horário médio de deitar e de acordar;
- a "variação típica" (quanto esses horários oscilam, em minutos), o mais cedo e o mais tarde;
- a duração média;
- a qualidade percebida média, quando pelo menos 3 noites têm a nota de "Como foi o sono?" (que também dá
  para ajustar na folha da noite).

Não há nota nem julgamento. Uma noite vai do meio-dia ao meio-dia, e deitar à 01:30 conta na noite
anterior. Toque numa noite para ajustar os horários ou **Registrar uma noite** esquecida. Há também uma
nota única recomendando avaliação profissional para ronco, bruxismo ou cansaço diurno.

O **lembrete de desaceleração** é uma notificação de segunda a sexta, desligada por padrão (veja
[Ajustes → Sono](#sono-1)). Ele não chega se o "Deitei" da noite já foi registrado.

### Treino

**Plano de treino.** Em **Corpo → Treino**, **Usar a divisão de exemplo de 5 dias** cria o plano da semana (segunda
Peito e tríceps, terça Costas e bíceps, quarta Pernas, quinta Ombros, sexta Corpo inteiro; sábado e domingo,
descanso da musculação). **Editar plano** (`/corpo/plano`) muda o nome de cada dia e os exercícios, um por linha. Séries e
cargas nunca são inventadas: só entram quando você registra.

**Treino de hoje.** O Corpo e o bloco Treino do Agora mostram "Treino de hoje: Pernas". **Abrir o treino de
hoje** (no Agora, **Abrir treino**) leva à tela do registro: em cada exercício, repetições e carga (kg) e
**Salvar série**, **Pulei** ou **Troquei por…**; a linha "Última: 3 × 10 · 40 kg" lembra a sessão anterior sem
preencher nada. Também dá para pôr um **Exercício fora do plano**, registrar o **Cardio** (modalidade, minutos e
intensidade percebida de 1 a 10) e, se quiser, esforço e recuperação. **Terminei o treino** pede os minutos (o
tempo desde "Começar bloco", quando houver). Um dia passado pode ser corrigido em `/corpo/treino?dia=AAAA-MM-DD`;
o que você registra para um dia passado não dá XP.

**Evolução por exercício** e **Cardio por semana**, no Corpo, mostram como observado a melhor série e o volume
das últimas sessões de cada exercício e as sessões e minutos de cardio das últimas 8 semanas completas. Sem
recorde, meta ou progressão sugerida.

Também dá para usar **Registrar treino** direto: musculação, cardio ou outro,
mais os minutos. A contagem da semana é observada, sem meta. A **versão mínima do cardio** é 10 minutos de
caminhada leve ou bicicleta, em ritmo de conversa, e conta como cardio. No bloco, **Fiz o cardio mínimo** registra de
um toque. "Começar é a parte difícil: a versão mínima vale o mesmo XP."

### Cardápio

Em **Planejar → Casa**, o cardápio da semana tem **Almoço** e **Jantar**, de segunda a sexta. Escolha
pratos simples: cada prato vira uma **receita** com lista de ingredientes (um por linha, quantidade opcional
na própria linha, como "frango 1 kg"). **Repetir a semana anterior** acelera. De segunda a sexta a aba
abre na semana atual; no fim de semana, na próxima, que é quando se planeja e se compra.

### Lista de compras

**Abrir lista de compras** (`/casa/compras`) gera a lista a partir do cardápio, **uma vez por prato**
(porque no preparo em lote cozinha-se uma vez para várias refeições). Ingredientes iguais viram uma linha, e o
topo mostra "Frango com arroz ×5" para você ajustar a quantidade de cabeça. Itens avulsos entram na mesma
lista, e as marcações ("Para comprar" e "No carrinho") funcionam sem internet, no mercado.

### Freezer e preparo em lote

Depois de cozinhar, toque em **Terminei o preparo** e diga quantas porções de cada prato foram para o
freezer (as porções começam em 0, com a dica "5 no cardápio · 2 no freezer"). O freezer é um diário de
movimentos:

- **Comi uma** tira uma porção (no Agora ou na aba Casa).
- **Ajustar** corrige a contagem.

Com menos de 3 porções (depois de algum preparo já registrado), a aba Casa sugere **Marcar preparo**, que
cria a missão da semana "Preparo em lote" para você escolher o dia. O XP desse esforço vem do preparo
terminado; cardápio, compras e "Comi uma" não dão XP.

---

## 6. Padrões

Em **Personagem → Padrões**, o app responde às perguntas "estou progredindo?", "por que adio isto?" e
"como o sono afeta o dia?" com os dados que você mesmo registrou. Tudo é calculado por regras fixas, no
aparelho, sem IA, e a seção **Como estes números são calculados** explica cada regra.

### Observado, Hipótese e Experimento sugerido

Toda leitura aparece com um destes três rótulos:

- **Observado:** contagens com o denominador ("iniciei 7 de 10 blocos"). É o que aconteceu.
- **Hipótese:** uma leitura possível, sempre começando com "Pode ser que…". Só aparece com amostra mínima,
  são no máximo três de cada vez, e podem ser acaso. Você decide se vale testar.
- **Experimento sugerido:** uma mudança pequena e reversível para testar por uma semana. **Usar como
  experimento da semana** o grava como o experimento da semana, e ele aparece no Agora. Se já existe outro,
  o app pergunta antes de trocar.

### O que há em Padrões

- **Tendências:** as últimas 8 semanas ou os 6 últimos meses, com gráficos simples e uma frase que diz o
  mesmo em texto. Só períodos completos entram, para uma semana pela metade não parecer queda.
- **Adiamentos:** o que você mais adiou nos últimos 28 dias, por esforço, área, parte do dia, dia da
  semana e tipo do dia, sempre com "adiou" e "começou" lado a lado. **Encolher**, **Soltar** e **Parcial** não contam como
  adiar: são estratégias. Os motivos marcados em "Agora não" aparecem contados, como observado.
- **Planejado × executado:** os minutos planejados dos blocos ao lado dos minutos vividos (blocos e sessões de
  foco fora deles), por área, nas últimas semanas ou meses, com **Ver dias**. O plano de cada dia é guardado
  quando você escolhe o tipo do dia ou começa (ou pula) o primeiro bloco, então mudar a rotina depois não
  reescreve o planejado dos dias que já passaram. Tempo com o app aberto nunca conta.
- **Associações:** sono × blocos iniciados no dia seguinte, sono × tipo do dia escolhido, e jeito de
  responder na revisão × acerto. Os grupos aparecem lado a lado, com a nota **"Associação, não causa"**. Nada
  aparece antes de 14 pares de dias (e 30 revisões por grupo na revisão), e não há coeficientes nem valores-p.
- **Semanas 5–8:** se um bloco iniciado há 4 a 8 semanas cai de forma clara, aparece um aviso gentil, sem
  vermelho, que também diz que pode ser só variação. As opções são usar "a meta é só a versão mínima" como
  experimento, **Ajustar a rotina** ou **Está tudo bem assim**, que dispensa o aviso daquele começo.
- **Reflexão do mês:** nos 7 primeiros dias de cada mês aparece no Agora uma reflexão opcional de 3
  perguntas, com os números do mês acima das perguntas. **Pular este mês** grava sem respostas e não volta;
  **Agora não** esconde até a próxima abertura. Em Padrões, as reflexões antigas ficam em **Reflexões do mês**
  e podem ser editadas.

### Como ler

1. Comece pelo **Observado**. É o único rótulo que afirma algo sobre o que aconteceu.
2. Leia a **Hipótese** como pergunta, não como veredito.
3. **Associação não é causa.** Uma semana de provas, ansiedade ou uma gripe pode encurtar o sono e também o
   dia seguinte. Os números lado a lado servem para pensar, não para concluir.
4. Teste **uma mudança por vez**, por uma semana, e lembre que uma semana ainda pode ser acaso.
5. Nada aqui dá XP: ler padrões ou refletir não é esforço de execução.

---

## 7. Personagem e Mundo

### O personagem

Em **Personagem** você vê a ficha: nome, aparência, nível, título (Aprendiz, Escudeiro, Andarilho, Guardião,
Cavaleiro, Mestre, Lenda), **Atributos**, **Conquistas recentes** e a **Constância** (dias ativos nos últimos 7
e 30; "dias livres não entram na conta, um dia parado não apaga nada"). Há também cartões para **Corpo**,
**Padrões** e **Mapa do mundo**, e a engrenagem de **Ajustes**. **Editar aparência** muda pele, cabelo e roupa.

### XP e atributos

O XP recompensa **esforço, início e estratégia**, não volume. Alguns exemplos:

- concluir uma missão (mais XP para as maiores ou pesadas, menos para as muito repetidas no mesmo dia);
- começar uma missão pesada ou adiada, ou encolhê-la;
- 2 XP a cada 10 minutos de foco, com teto diário;
- revisar 5 cards no dia e cumprir a meta do dia de estudo;
- terminar uma sessão de prática, um treino ou um preparo em lote.

Séries, cardio detalhado, resultados, motivos, fechamento do dia, correções, listas e assuntos não dão XP, e
"Fiz, mas não registrei" também não. Registrar sono não dá XP: o registro é para você observar a regularidade, e recompensar o registro
tende a virar marcar por pontos.

**XP nunca diminui.** Não há vida, sequência que zera nem penalidade. Cada **área da vida** é um
atributo (Vigor, Equilíbrio, Intelecto, Ofício, Ordem, Laços, Facul e as que você criar em Ajustes), e o XP
das missões da área o faz crescer, além de subir o nível total. Criar cards, entrar no mapa e conversar com
NPCs não dão XP.

### O Mapa do mundo

Em **Personagem → Mapa do mundo**, cada **área ativa é um território** que cresce com o XP daquela área,
em cinco estágios: **Ruínas**, **Acampamento**, **Aldeia**, **Vila** e **Castelo**. Nada decai com
o tempo.

- Toque num território para ver nível, XP, **Últimas ações** que o alimentaram e as **Jornadas** da área, com
  link.
- O avatar fica no território do bloco atual (ou na **Encruzilhada**, junto da fogueira, quando não há
  bloco).
- Jornadas viram estradas, com marcos acesos conforme as missões feitas.
- **Mapa** e **Lista** mostram a mesma coisa; a Lista é uma alternativa em texto.
- Cada território tem um **NPC** (por exemplo, Dara, a treinadora, em Vigor; Tomás, o escriba, em
  Intelecto). Ao abrir um território, o NPC diz uma frase sobre algo real de hoje: cards para revisar, treinos
  da semana, marmitas, prazos. **Outra fala** passa para a seguinte. Nada aparece sem você chamar, e em dia
  livre as falas são sobre descanso. Áreas que você criou ganham uma andarilha.
- Um ponto "…" no mapa indica um NPC com algo sobre hoje.

Quando um território sobe de estágio por XP ganho agora, o companheiro celebra uma vez, e o Personagem
mostra "Novidade" por 3 dias.

### Cores desbloqueáveis

Quatro cores de roupa se liberam pelo nível total: **Esmeralda** (nível 5), **Celeste** (8), **Carmim** (12) e
**Dourado** (20). Sem loja, sem moeda e sem sorteio. No editor de aparência, as ainda presas aparecem
desativadas com o nível que as libera. Uma cor escolhida nunca é retirada.

### O companheiro

**Faísca** (renomeável em Ajustes) é uma chama numa lanterna. Fala frases curtas em momentos definidos e
nunca interrompe. Dá para **Silenciar falas** em Ajustes.

---

## 8. Painel no monitor secundário

O **Painel** é para o PC. Abra `/painel` (por exemplo, <http://localhost:8787/painel>) em uma janela à
parte, no monitor secundário. Em telas com 1200 px ou mais, o Agora também usa esse layout automaticamente.

Três colunas, legíveis de relance e atualizadas sozinhas:

- **Agora:** o bloco e a missão principal, com alternativas.
- **Hoje:** a linha do tempo, com compromissos, janelas livres e a hora atual.
- **Apoio:** o cronômetro grande, o companheiro, a captura e a constância.

Atalhos no Painel (quando o foco não está num campo): **N** abre a captura, **C** conclui a missão atual e
**Espaço** pausa ou retoma o cronômetro. O Painel não mostra leituras de Padrões nem a linha da prática
técnica: ele é o monitor de execução do dia.

---

## 9. Ajustes

Abra em **Personagem → engrenagem**. As seções, em ordem de uso:

- **Áreas da vida:** cada área é um atributo do personagem. **Adicionar área** (nome e atributo, por
  exemplo "Espiritualidade" e "Fé"), renomear, **Arquivar área** e **Restaurar**.
- **Dia:** "O dia começa às" e "O dia termina às". Antes do início, ainda conta como o dia anterior. Depois do
  fim, o Agora sugere descansar.
- **Foco:** minutos de foco e de pausa do Pomodoro, e o interruptor "Card de início ao começar algo adiado".
- **Companheiro:** nome do companheiro e **Silenciar falas**.
- **Sincronização:** situação, pendentes e código de acesso.
- **Notificações:** **Ativar notificações** e **Lembrar compromissos**. Aceite a permissão do iOS.
  Veja os limites do iPhone na seção de perguntas frequentes.
- <a id="sono-1"></a>**Sono:** mostrar "Deitei" e "Acordei" no Agora, **Lembrete de desaceleração** e
  **Horário do lembrete** (padrão 22:45).
- **Armazenamento:** espaço usado por imagens e áudios, arquivos **aguardando envio**, espaço do app e se o
  **armazenamento persistente** foi concedido (com botão para pedir de novo).
- **Inteligência (opcional):** só aparece quando o servidor tem uma chave. Veja a próxima seção.
- **Dados:** exportar e importar JSON (veja [Backups e dados](#11-backups-e-dados)).
- **Sobre:** a versão e o resumo do que o app tem.

---

## 10. IA opcional

O LIFE RPG tem **três ajudas de IA**, todas opcionais. Regras primeiro, IA depois: o app funciona exatamente
igual sem elas.

### O que ela faz

- **Pistas na sessão de prática:** no passo Feedback (ou no passo atual), pedir uma **Pista 1** (uma
  pergunta), **2** (uma direção) ou **3** (um próximo passo). Nunca a solução, e trechos de código longos são
  cortados. Cada pista fica guardada no Feedback com a etiqueta IA. As pistas pausam enquanto você reconstrói
  sem consultar.
- **Sugerir cards:** cole um trecho de aula (ou use uma nota) e a IA propõe até 5 rascunhos. Você edita e
  aceita um por um. Eles viram **rascunhos**, nunca entram na revisão sozinhos.
- **Resumo da semana:** no card Nova semana, 3 a 4 frases gentis, separadas em Observado, Hipótese e Sugestão,
  a partir dos números que as regras já calcularam. Você pode incluir ou não as suas respostas.

### Ela está desligada sem chave, e custa dinheiro

Sem a chave da Anthropic no servidor, **nenhum controle de IA aparece** e nada muda. Com a chave, cada
pedido é **cobrado na sua conta da Anthropic**. Um **teto diário de pedidos** (padrão 30, ajustável de 1 a
1000) limita quantos pedidos, e portanto o gasto, podem acontecer por dia. Os pedidos do dia aparecem em Ajustes
("Hoje: X de Y pedidos usados"). Respostas da IA podem errar: confira antes de aceitar.

### Como ligar

1. Crie uma chave na Console da Anthropic.
2. Informe a chave ao servidor, fora do repositório:
   - **Neste computador:** defina `ANTHROPIC_API_KEY` como variável de ambiente de usuário do Windows e reabra o
     LIFE RPG.
   - **No homelab:** coloque `ANTHROPIC_API_KEY=...` (e, se quiser, `LIFE_RPG_AI_DAILY_LIMIT=30`) no arquivo
     `.env` do servidor, como descreve `deploy/README.md`, e suba de novo.
3. No app, abra **Ajustes → Inteligência (opcional)** e ligue só as ajudas que quiser. Cada uma começa
   desligada. A seção só aparece com o servidor conectado pela sincronização.

A chave fica **só no servidor**: o aparelho nunca a vê.

### O que é enviado

Nada é pedido ao abrir uma tela e **nada vai sem você tocar no botão**. Cada ajuda tem um bloco **"O que é
enviado"** com o texto exato que vai sair do aparelho:

- **Pistas:** título, problema, entradas e saídas, conceitos, passos, decisões, casos de teste e o código do
  passo atual (na reconstrução, só a reconstrução). **Erros e feedback não vão.**
- **Sugerir cards:** só o texto que você colou (ou o da nota escolhida) e o nome do baralho.
- **Resumo da semana:** só os números do Observado da semana. Suas respostas só vão se você marcar.

Nenhuma resposta muda dados sozinha: a pista vai para o Feedback, o card só vira rascunho com **Aceitar**, e o
resumo fica só no aparelho.

---

## 11. Backups e dados

- **Onde estão:** tudo fica em `data/` no servidor: o banco (`life-rpg.sqlite`), `token`, `vapid.json`
  (chaves de notificação) e `backups/`. Imagens e áudios ficam em `data/media/`. **Não apague `data/` nem
  `vapid.json`.**
- **Backup diário:** o servidor faz um backup por volta das 3h e guarda os 14 mais recentes. As mídias
  também são espelhadas em `data/backups/media/`, sem ocupar espaço extra e sem apagar nada.
- **Exportar:** em **Ajustes → Dados**, **Exportar JSON** (no iPhone, **Preparar exportação** e depois
  **Compartilhar arquivo**, para salvar em Arquivos). Imagens e áudios entram até 25 MB. Se passar, as que
  ainda esperam envio ao servidor têm prioridade, e Ajustes avisa antes.
- **Diário:** a exportação JSON leva todas as entradas, inclusive as privadas e as de Apagadas recentemente.
  **Apagar de vez** troca o texto por vazio no aparelho e, ao sincronizar, no servidor; os backups diários do
  servidor guardam o texto antigo até girarem (14 dias).
- **Importar:** **Importar JSON** lê o arquivo, e cada registro só substitui o do aparelho se for mais novo.
  Importar nunca apaga o que você tem de mais recente.
- **Quando o servidor está fora do ar:** o iPhone guarda tudo, mas sem sincronizar não há cópia no servidor.
  Exportar é o único backup do que ele gravar nesse período.
- **Restaurar um backup do servidor:** os passos estão em `deploy/README.md`. Depois, abra o app em todos os
  aparelhos antes de registrar coisas novas: cada um percebe que o servidor voltou no tempo e reenvia o que tem.
- **Mover para outro servidor:** copie a pasta `data/` inteira e, em cada aparelho, abra o endereço novo e
  conecte a sincronização com o mesmo código.

---

## 12. Perguntas frequentes e quando algo não funciona

**O app funciona sem internet?**
Sim. O app guarda tudo no aparelho e continua funcionando, inclusive a revisão de cards com imagens e
áudios que já foram baixados. Quando o servidor volta, os dados sincronizam sozinhos.

**Posso usar em dois aparelhos?**
Sim. Conecte os dois com o mesmo código de acesso. A sincronização guarda, para cada registro, a versão
mais recente. Se você editar a mesma coisa nos dois antes de sincronizar, vale a edição mais nova. Para uma
pessoa só, isso costuma bastar. Evite editar a mesma lousa ou sessão de prática nos dois ao mesmo tempo.

**Os dados não aparecem no outro aparelho.**
Confira em **Ajustes → Sincronização** se a situação está boa e se há registros **Pendentes**. O servidor
precisa estar ligado e acessível (no homelab, o Tailscale precisa estar ligado nos dois aparelhos).

**Não recebo notificações no iPhone.**
No iPhone, notificações só chegam com o app **instalado** na Tela de Início, aberto pelo ícone, em uma página
**HTTPS**, e com a permissão do iOS aceita. Abra o app pelo ícone, vá em **Ajustes → Notificações** e
toque em **Ativar notificações**. Se a permissão foi negada, libere nos ajustes do iPhone.

**O microfone não funciona (gravar áudio ou "Responder falando").**
O navegador só libera o microfone em páginas **HTTPS** (ou `localhost`). Neste computador, o endereço
`localhost:8787` já serve. No homelab, o endereço do Tailscale precisa de HTTPS (`tailscale serve`). Sem isso,
a gravação fica indisponível, mas você ainda pode escolher um arquivo de áudio. Se o microfone foi negado,
permita nas configurações do navegador para este site.

**Não aparece o botão "Ouvir".**
O baralho precisa de um idioma em **Editar baralho → Ouvir em voz alta**, e o aparelho precisa ter síntese
de voz.

**O app mostra a versão antiga depois de atualizar.**
Feche o app por completo e abra de novo. Neste computador, o `LIFE RPG.cmd` reconstrói o app a cada abertura.

**Sumiu um card, uma nota ou uma lousa.**
Notas apagadas mostram um aviso **Desfazer** na hora. Se passou, restaure um backup (veja acima) ou importe
um JSON antigo.

**A IA não aparece nos Ajustes.**
Ela só aparece com uma chave configurada no servidor e a sincronização conectada. Veja
[IA opcional](#10-ia-opcional).

**A revisão ficou grande depois de dias parados.**
O orçamento de tempo mantém a carga razoável: novos cards esperam e os vencidos entram aos poucos. Se ainda
parecer muito, reduza o **orçamento** ou o **teto de novos** em Preferências de estudo, ou use um dia de
**Baixa energia** (só revisões, metade do orçamento).

**Quero apagar tudo e recomeçar.**
Não há botão para isso, de propósito. Exporte antes, e apague o armazenamento do site no navegador e a pasta
`data/` do servidor. Isso não tem volta.

---

## 13. Base científica, com honestidade

Muitas escolhas do app se apoiam em pesquisa, mas **pesquisa não é promessa**. Estes são os princípios, com o
que cada um dá e o que não dá:

- **Espaçamento:** rever em intervalos crescentes retém mais do que rever tudo de uma vez. É das técnicas de
  estudo com evidência mais forte (Dunlosky e colegas, 2013). O agendamento usa o FSRS, que prevê bem o
  esquecimento em dados de usuários do Anki, o que não é uma garantia de retenção para uma pessoa.
- **Prática de recuperação:** tentar lembrar (escrever, desenhar, falar, programar) antes de ver a resposta
  consolida mais do que reler. É a razão dos modos "antes de revelar". O app não mede se o seu jeito de
  responder faz diferença, pois você escolhe quando escrever, e isso confunde a comparação.
- **Recordação livre:** explicar um assunto inteiro de memória (o tipo Tópico) foi superior a outras
  estratégias em estudos de laboratório, inclusive em perguntas de inferência (Karpicke e Blunt, 2011).
  Foram estudos com estudantes e textos curtos, não com um semestre inteiro.
- **Compreender, não decorar:** processar o significado retém mais do que repetir a forma, e a autoexplicação
  tem utilidade moderada. Por isso o campo opcional "Por quê?", que nunca é obrigatório.
- **Intenções de implementação e versões mínimas:** um plano no formato "se X, então Y" aumenta a chance de
  executar (Gollwitzer e Sheeran, 2006), e começar pequeno reduz a barreira de início. Os blocos de versão
  mínima e os experimentos de uma semana vêm daí. O efeito é médio, não garantido.
- **Regularidade do sono:** em universitários, horários mais irregulares aparecem associados a notas mais
  baixas (Phillips e colegas, 2017, observacional, cerca de 60 estudantes). É **associação, não causa**. O
  app só mostra a sua regularidade como dado observado para você testar. Não é aconselhamento médico.
- **Hábitos levam tempo:** em um estudo, a formação de um hábito levou de semanas a meses, com grande
  variação entre pessoas, e perder um dia não comprometeu a formação (Lally e colegas, 2010). Por isso não há
  sequências que zeram, e uma queda entre a 5ª e a 8ª semana é tratada como momento de ajuste, não como
  fracasso.
- **Autoperdão:** perdoar-se por procrastinar associou-se a menos procrastinação depois (Wohl e colegas,
  2010). Daí o tom sem culpa em todo o app.

Os limites de nível, o orçamento de tempo, o teto de novos cards e os estágios do mapa são **decisões de
produto**, não resultados de estudos.
