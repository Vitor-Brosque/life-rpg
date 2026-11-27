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
10. [IA opcional](#10-ia-opcional) e [Assistentes: ChatGPT e Claude](#assistentes-chatgpt-e-claude)
11. [Backups e dados](#11-backups-e-dados)
12. [Perguntas frequentes e quando algo não funciona](#12-perguntas-frequentes-e-quando-algo-não-funciona)
13. [Base científica, com honestidade](#13-base-científica-com-honestidade)

A barra de navegação tem cinco abas: **Agora**, **Planejar**, **Estudo**, **Diário** e **Personagem**. **Objetivos** (com as jornadas dentro) e as **temporadas** ficam no **Planejar**.
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

1. Abra o endereço do app no **Safari**. É o endereço HTTPS do Tailscale: o deste PC (veja "Usar no iPhone com este
   PC" no `README.md`) ou o do servidor onde o app estiver.
2. Toque em **Compartilhar**.
3. Toque em **Adicionar à Tela de Início**.
4. Feche o Safari e, a partir daí, abra sempre pelo ícone da Tela de Início.
5. Na tela de boas-vindas, toque em **Já uso em outro aparelho** e informe o código de acesso.

A ordem importa: instale, abra pelo ícone e só então conecte. O app aberto pelo ícone guarda os dados separados do
Safari; conectar no Safari e instalar depois faria o app instalado começar vazio.

Abrir pelo ícone é necessário para receber notificações no iOS: o iPhone só entrega notificações
de apps instalados, e só em páginas HTTPS.

No computador, no Chrome ou no Edge, use o ícone "Instalar" da barra de endereço. O app abre em janela
própria e continua funcionando sem o servidor ligado.

### Conectar a sincronização

A sincronização copia seus dados para o servidor, faz os backups e leva tudo para os outros aparelhos.
Sem ela o app funciona, mas os dados ficam só no navegador daquele aparelho.

1. Descubra o **código de acesso**: ele está no arquivo `data/token`, na pasta do app no servidor
   (neste computador, a pasta `data/` do projeto; no servidor de casa, `~/projects/life-rpg/data/token`).
2. No app, vá em **Personagem → engrenagem → Sincronização**.
3. Cole o código no campo **Código de acesso**.

Basta uma vez por aparelho ou navegador. A seção mostra a **Situação** e quantos registros estão
**Pendentes**. Pendente não é problema: são mudanças que esperam o servidor aparecer.

---

## 2. Um dia típico

### A tela Agora

O Agora responde "o que faço agora?" sem exigir que você decida antes. De cima para baixo:

- **Faixa de status:** avatar e nível, sua energia atual (definida pelo tipo do dia; toque para ajustar),
  o tempo livre até o próximo compromisso e o indicador de sincronização, com o chip do **tipo do dia** ao lado.
- **Cuidados:** a faixa de sono e refeição (veja abaixo).
- **Linha da semana**, quando há algo a dizer: semana atípica, estratégias em teste, o experimento antigo e o link
  **Nova semana**, que reabre o card guardado.
- **Um card de momento por vez**, logo acima do bloco atual e da missão: "Como foi hoje?" (à noite, na sua janela),
  "Como está hoje?", "Nova semana", a reflexão do mês ou a "Revisão rápida". Quando mais de um vale, aparece o card
  mais acima nessa lista, e os outros esperam atrás do botão **Mais para hoje (N)**. Tocar num deles o traz para cima, e o
  que estava lá vai para a lista. Nada disso grava nada, e o bloco atual e a missão nunca somem.
- **Bloco atual**, quando há um em andamento.
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
- **Encerrar bloco** fecha quando você terminar. A folha pergunta, se você quiser, **Como foi?** (Feito, Parcial, **Investiguei**
  ou Não deu; Investiguei é pesquisa ou exploração sem entrega ainda e conta como trabalho, à parte de Não deu), **O que saiu?** em uma linha e a próxima ação. **Encerrar sem anotar** continua sendo um toque.
- **Escapei** (ícone da porta) é um registro de um toque para quando você percebe que escapou para
  outra coisa. Notar já é a parte útil. Você escolhe para onde escapou (por exemplo, YouTube, Redes ou
  Outra) e nada mais é cobrado.
- Se uma [estratégia](#estratégias) em teste estiver ligada a esse bloco (ou à jornada dele), o cartão mostra uma linha
  calma, "Estratégia em teste: …", antes e durante o bloco. Ela só lembra: não pede toque e não bloqueia nada.

**Começar tarde encolhe o bloco** até a versão mínima, sem empurrar o resto do dia. Se o horário do bloco
acaba, o Agora avisa e oferece "Voltar agora", sem drama. Blocos de rotina (por exemplo, o início do dia)
têm um checklist e o botão **Concluir rotina**.

### O cartão da missão

Os botões do cartão principal:

- **Começar** abre a ficha da missão (primeiro passo, checklist, notas). Começar nunca liga o
  cronômetro sozinho.
- **Concluir** conclui e dá o XP. Há um aviso "Desfazer" por alguns segundos; tocar no texto do aviso o fecha na hora. Depois, na ficha da missão
  concluída, o campo **O que saiu?** guarda em uma linha o que ficou pronto (opcional).
- **Parcial** aparece quando a missão está em andamento: anote, se quiser, **O que saiu?** e a **Próxima ação**
  (que vira o primeiro passo da próxima vez) e escolha quando ela volta (Mais tarde hoje, Amanhã ou Escolher
  dia). Marque **Investiguei** quando foi pesquisa ou exploração sem entrega ainda: o aviso diz "Investigação anotada" e o
  fechamento do dia e os relatórios contam à parte. Parcial é progresso: não conta como adiamento.
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

Quando a jornada da missão serve a um [objetivo](#objetivos-e-jornadas), o cartão e a ficha da missão mostram a cadeia em
uma linha: "Carreira em Dados › Tech News". É só o lembrete do porquê; sem objetivo, a linha não aparece.

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
**Agora não** esconde o card naquele dia. Na sua janela ele vem antes dos outros cards de momento; os outros ficam em
**Mais para hoje**.

A folha mostra:

- **Observado:** blocos iniciados (e em que versão), pulados e não iniciados, missões concluídas, parciais e investigações (contadas à parte),
  minutos de foco, o treino, cards revisados e sessões de prática encerradas.
- **Pendências de hoje:** Amanhã, Escolher dia ou Soltar para cada uma.
- **Como você esteve (tudo opcional):** quatro fileiras de um toque — **Cansaço durante o dia** (Pouco, Médio, Muito),
  **Humor** (Para baixo, Ok, Bem), **Sobrecarga** (Leve, Média, Pesada) e **Concentração** (Difícil, Ok, Boa). Tocar
  escolhe, tocar de novo desfaz. Só o que você tocou é gravado: uma escolha mudada em outro aparelho e não tocada aqui fica
  como está.
- Uma **Observação**, opcional, sem limite de tamanho, que fica no [Diário](#diário) como a entrada **fechamento do dia**
  (as notas escritas antes desta versão passaram para lá sozinhas, sem duplicar).
- **Correções:** ajustar o início e o fim de um bloco, marcar **Fiz, mas não registrei** num bloco que você
  fez sem tocar no app (fica "registrado depois" e não dá XP) e corrigir os minutos de uma sessão de foco ou
  apagá-la (com Desfazer).

**Fechar o dia** guarda o fechamento; abrir de novo mostra "Dia fechado às …" e deixa ajustar as escolhas e a nota. **Escrever no
diário** também guarda as escolhas que você tocou, sem fechar o dia.
A observação só é gravada se você mexeu nela: um texto mais novo (de outro aparelho ou do diário) nunca é trocado
pela cópia que a folha mostrou ao abrir. Se o fechamento estava em Apagadas recentemente com outro texto, ou mudou
enquanto a folha estava aberta e você escreveu outra observação, esse texto fica em Apagadas recentemente, como uma
entrada comum do dia (dá para restaurar), e a observação nova vira o fechamento.

**Situação de fala** guarda o que você já marcou ou escreveu e abre o registro de uma situação real (veja Fala, no Estudo).

### Diário

A aba **Diário** é um lugar para escrever livremente sobre os seus dias, com as suas palavras. Nada ali é
obrigatório: não há lembrete, sequência, XP nem "faltou" num dia sem entrada.

- **Escrever** abre uma entrada nova, com a data e a hora de agora. É só escrever e sair: a entrada se salva
  sozinha a cada pausa. Texto só com espaços não vira entrada, e uma entrada nova esvaziada antes de sair some.
  Se o iPhone fechar o app em segundo plano, ou se um salvamento não passar, o que você digitou fica guardado no
  aparelho e volta ao abrir a entrada. Se a entrada mudou depois disso (em outro aparelho ou no "Como foi hoje?"),
  ou mudou enquanto estava aberta e você continuou escrevendo, o campo mostra o texto salvo e um aviso, "Há um
  texto não salvo deste aparelho, de …", oferece **Usar este texto** ou **Descartar**: nenhum dos dois textos some
  sem você escolher. No topo do Diário, "Texto não salvo de …" com **Continuar** leva a um texto que ficou só no
  aparelho. Se você editar a mesma entrada em dois aparelhos sem internet, vale a última versão salva; o app guarda
  a outra como texto não salvo quando consegue perceber o conflito.
- **Mudar data e hora** troca o dia e a hora (o dia segue o início do seu dia: 01:30 conta para o dia anterior).
- Opcionais: **Ligar a…** uma missão ou uma jornada (as disciplinas são jornadas), até 3; **Temas** (Faculdade,
  Carreira, Projetos, Estudo, Saúde, Treino, Sono, Relacionamentos, Família, Lazer, Sentimentos, Ideias, Comunicação); e
  **Privada**, que deixa a entrada fora das exportações, a menos que você a inclua naquela exportação.
- A tela mostra **uma semana** (segunda a domingo), um grupo por dia, o mais recente primeiro, com as entradas na
  ordem da hora. **Semana anterior**, **Próxima semana** e **Mesma semana, mês passado** navegam. As respostas da
  **Nova semana** e da reflexão do mês escritas naquela semana aparecem como cartões só de leitura.
- **Buscar no diário** acha palavras em todas as semanas, sem diferenciar acentos e maiúsculas. Em **Filtros**:
  por tema, por vínculo e **Só privadas**.
- **Apagar** (dentro da entrada) leva para **Apagadas recentemente**, com **Desfazer** na hora. Lá, **Restaurar**
  devolve a entrada; **Apagar de vez** (numa entrada) e **Esvaziar** (todas) pedem confirmação e não têm volta:
  o texto sai do aparelho e, na sincronização, do servidor (num fechamento do dia, ou numa cópia dele, a nota antiga
  daquele dia sai junto). Os backups diários do servidor ainda guardam o texto antigo até girarem (14 dias).
- **Exportar semana** gera um arquivo `.md` com as suas palavras, sem alteração, para guardar ou levar a uma
  conversa com uma IA. Na folha: **Período** (setas para trocar a semana), **Incluir entradas privadas**
  (desligado), **Registrado pelo app** (ligado: tipo do dia, blocos iniciados, treino, sono e cansaço, só o que
  existe) e **Revisões da semana e do mês** (ligado). A **Prévia** mostra o texto exato. No iPhone,
  **Compartilhar** abre a folha de compartilhar (Salvar em Arquivos, enviar); no PC, **Baixar** salva o arquivo.

#### Relatórios

**Relatórios** (na barra do Diário) monta um texto em Markdown para levar a uma conversa com uma IA, ou para você reler.
Tudo vem do que está registrado, por regras: nada é inventado para completar, nada usa IA e nada sai sem o seu toque.

- **Período:** **Semana** (de segunda a domingo; na segunda e na terça a tela abre na semana passada, nos outros dias na
  atual), **Mês** ou **Personalizado** (duas datas, até hoje, no máximo 92 dias). Um período em andamento vai até hoje.
- **Tema:** **Geral** (todas as seções), **Aprendizagem** (blocos de estudo, revisões, prática técnica e matérias),
  **Hábitos e comportamento** (execução, hábitos — com estratégias e concentração —, adiamentos e travas), **Saúde** (sono, treino, cansaço, humor e sobrecarga),
  **Comunicação oral** (a prática de fala: as sessões por atividade e tamanho, as gravações como lista com datas, a velocidade
  das leituras como observação e as situações reais, com as suas percepções separadas dos fatos) ou **Personalizado** (você
  marca as seções; começa pelas do tema que estava escolhido).
- **Entradas do diário:** **Nenhuma**, **Do tema** (o padrão: as entradas com os temas daquele relatório; no Geral, todas; no Hábitos e comportamento, e no Personalizado com Execução, Hábitos ou Adiamentos, também as ligadas a uma missão),
  **Escolher** (você marca as entradas do período) ou **Todas**. **Incluir entradas privadas** fica desligado e volta a
  desligar toda vez que você abre a tela. As entradas vão com as suas palavras, sem resumo nem correção.
- **Dados de saúde** (quando o relatório tem Saúde): **Sono**, **Treino** e **Estado do dia**, ligados. Desligado, aquele
  dado some do texto, sem aviso. Eles não filtram o diário: para isso, use **Escolher**.
- Com [objetivos](#objetivos-e-jornadas), a **Visão geral** mostra, para cada um, o que esteve ligado a ele no período
  (em **Registrado**) e, em **Minhas percepções**, as respostas do **Avançou?**, que são a sua leitura, não um dado; as
  [temporadas](#temporadas) do período aparecem no cabeçalho, e a revisão de uma temporada entra em **Revisões**. Na
  **Execução**, **Investiguei** é contado à parte de Parcial e de Não deu.
- Cada seção separa **Registrado** (o que o app guardou), **Minhas percepções** (as suas palavras: "O que saiu?", o
  pensamento do card de início, a explicação da prática, o motivo da semana atípica), **Sem dados** (o que não foi
  registrado; ausência não é fracasso) e **Para investigar** (as mesmas regras de Padrões, como hipótese, nunca como
  conclusão). Uma seção sem nenhum registro mostra só a linha "Sem dados", sem números.
- Os blocos contam até ontem (hoje ainda está em andamento). Listas longas mostram as 8 primeiras e "e mais N".
- A **Prévia** é exatamente o arquivo. No iPhone, **Compartilhar** abre a folha de compartilhar; no PC, **Baixar** salva
  `relatorio-<tema>-<início>_a_<fim>.md`. Abrir a tela e mudar as escolhas não grava nada; as escolhas voltam ao padrão
  na próxima visita.

#### Estratégias

**Estratégias** (na barra do Diário) guarda o que você decidiu testar: uma ideia de uma conversa com uma IA, de uma
pesquisa, de Padrões ou sua. Nada chega de uma IA sozinho: a estratégia só existe se você a registrar.

- **Nova estratégia:** só o título é obrigatório ("O que vai testar?"). O resto são toques opcionais: **De onde veio?**
  (Conversa de IA, Pesquisa, Ideia minha, Padrões; com IA ou Pesquisa dá para dizer qual conversa ou fonte), **Por quê?**,
  **O que observar?**, **Ligar a** um bloco ou a uma jornada, **Desde** (até hoje) e **Decidir em** (1 a 4 semanas; o padrão
  é 2). **Começar a testar** guarda.
- A lista separa **Testando**, **Mantidas**, **Ajustadas** e **Descartadas**. A partir do dia de decidir, a estratégia
  mostra **Hora de decidir** (aqui e no card Nova semana). Decidir é opcional e não tem notificação.
- Tocar numa estratégia abre os mesmos campos e a **Decisão**: **Ainda testando**, **Manter**, **Ajustar** ou **Descartar**,
  com uma nota sua, se quiser. Quando chega o dia, aparece também **Decidir depois (+7 dias)**, que dá mais uma semana
  (e guarda o que você já tinha digitado). Numa estratégia ajustada, **Testar a versão ajustada** abre uma nova já
  preenchida; a antiga fica como histórico. Só o que você mudou é gravado.
- **Apagar** leva para **Apagadas recentemente** (no fim da tela): lá dá para **Restaurar** ou **Apagar de vez**.
- As estratégias em teste aparecem numa linha do Agora e do Painel ("Estratégias em teste: …", no máximo duas e "+N"); as
  ligadas a um bloco aparecem também no cartão daquele bloco.
- Os **Relatórios** citam no começo as estratégias em teste no período e, em Hábitos, cada uma com a origem, o estado e o que
  os registros mostram durante o teste (blocos iniciados, Escapei), com as suas palavras e a nota "Associação, não causa".
  Esses números são observação: não mostram que a estratégia funcionou.

#### Observação de 14 dias

O card **Observação de 14 dias**, no topo do Diário, liga um modo opcional: por 14 dias, marque no "Como foi hoje?" o humor,
a sobrecarga e a concentração, se quiser. **Começar** liga; enquanto dura, o card da noite mostra só "Observação: dia N de
14", sem insistir e sem notificação. **Encerrar observação** (com confirmação) termina antes; depois do dia 14 ela termina
sozinha.

No fim, **Ver resumo** mostra o que foi registrado, em dias: dias com algum registro, sono (pela duração da noite anterior),
tipo do dia, humor, sobrecarga, concentração, cansaço e blocos iniciados, cada um com "sem registro" à parte. Não há
interpretação nem cruzamento: 14 dias são poucos pontos e não sustentam conclusões. **Começar outra** substitui a
observação anterior; aqueles dias continuam num relatório de período personalizado.

---

## 3. A semana

### O card "Nova semana"

Na segunda de manhã, o Agora mostra o card **Nova semana**, em dois passos curtos (dá para
**Começar** ou **Fazer depois**). O primeiro passo, a revisão da semana passada, tem três partes:

1. **Observado:** os números da semana passada, "sem julgamento".
2. **Avançou nos seus objetivos?** Para cada [objetivo](#objetivos-e-jornadas) ativo, o que esteve ligado a ele na
   semana passada (missões concluídas e blocos iniciados das jornadas dele, ou "Sem registro ligado a ele na semana
   passada.") e três chips opcionais: **Sim**, **Um pouco** e **Não desta vez**. Tocar de novo desfaz; só o que você tocou
   é gravado.
3. **Sua leitura**, três perguntas opcionais com suas palavras:
   - O que funcionou?
   - Qual foi o maior obstáculo?
   - Que ajuste você quer testar?

O segundo passo se chama **Objetivos da semana**.

**Fazer depois** guarda o card até a próxima vez que você abrir o app; enquanto isso, o link
**Nova semana** no topo do Agora (e do Painel) o abre de novo. Ele é oferecido na segunda e na terça.

Cada linha do **ajuste** vira uma [estratégia](#estratégias) em teste (com origem Padrões quando veio de "Usar no ajuste"),
e o Agora passa a mostrar "Estratégias em teste: …". Se alguma estratégia já chegou ao dia de decidir, o card mostra
"Hora de decidir: …" com o link **Decidir em Estratégias**; decidir é opcional. Uma semana é pouco para concluir algo, então
compare com calma. Os experimentos de semanas anteriores a
esta versão continuam como estavam ("Experimento da semana: …" e "Experimentos anteriores" em Padrões).

Se a IA opcional estiver ligada, um **Resumo da semana** pode aparecer depois da sua leitura
(veja [IA opcional](#10-ia-opcional)). O que ficou aberto na semana passada vem para esta semana, a
não ser que você toque em **Soltar**. Se um bloco tiver caído de forma clara entre a 5ª e a 8ª semana
de uso, o card traz um aviso gentil, com a semana da temporada quando houver uma (veja [Padrões](#6-padrões)).

### Semana atípica

Provas, viagem, doença: em **Planejar → Semana**, o botão **Semana atípica** (ou o link "Esta semana vai
ser atípica?" no card Nova semana) marca a semana, com o motivo (**Provas**, **Viagem**, **Saúde** ou
**Outro**) e quando **o ritmo volta**. Durante ela, o Agora lembra que versões mínimas contam tanto
quanto, e os Padrões não comparam essa semana com as outras: as tendências mostram a barra tracejada,
o aviso das semanas 5–8 pula a semana e os adiamentos dela ficam fora da conta. Na segunda seguinte, o
card Nova semana dá as boas-vindas de volta. Dá para desmarcar a qualquer momento.

### Temporadas

Em vez de um programa fixo, o app oferece **temporadas** opcionais de 6 a 8 semanas, com um ou dois focos. No topo de
**Planejar → Semana**, **Nova temporada** pede o **Nome da temporada**, até dois focos (cada um com o seu texto e, se quiser,
**Ligar o foco 1 a** (ou **2**) um objetivo ou a uma estratégia em teste), **Começa em** e a **Duração** (6, 7 ou 8 semanas). A folha
diz em que semana ela termina.

O card mostra "Temporada: {nome} · semana N de M". **Semanas atípicas não entram na conta**: elas empurram o fim uma
semana, e o card diz quantas ficaram de fora. Ele nunca diz "7 de 6": depois da última semana planejada, diz que as
semanas planejadas terminaram. A partir da última semana, **Rever temporada** mostra os números da temporada (as mesmas
regras de Padrões, sem as semanas atípicas, só o que aconteceu), o **Avançou?** que você marcou nas Novas semanas e três
perguntas opcionais (O que avançou? O que atrapalhou? O que levar para a próxima?). **Encerrar temporada** guarda as
respostas, que aparecem no Diário e nos relatórios; **Agora não** guarda o que você escreveu neste aparelho para depois.
Em **Editar temporada** dá para mudar tudo e, se quiser parar antes, **Rever e encerrar agora**. Uma temporada por vez;
sem nenhuma, nada muda no app.

### Objetivos da semana

Cada bloco pode ter um objetivo para a semana. Eles aparecem na aba **Planejar → Semana** e vão sendo
marcados conforme você avança.

### Planejar: Semana, Quadro, Rotina, Objetivos e Casa

A aba **Planejar** tem cinco visões. Uma lembrança da última escolhida fica no aparelho.

- **Semana:** a semana em blocos, com setas para semana anterior e próxima. É onde se enxerga
  quais blocos caem em quais dias, compromissos e objetivos. Toque num dia para ver o plano dele. No topo fica a [temporada](#temporadas), se houver uma.
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
- **Objetivos:** os objetivos e, dentro de cada um, as jornadas (veja [Objetivos e jornadas](#objetivos-e-jornadas)).
- **Casa:** cardápio, compras e freezer (veja [Corpo e casa](#5-corpo-e-casa)).

Compromissos (aulas, consultas) entram pelo **+** (tipo **Compromisso**) ou pela folha de compromisso no
Planejar, com a opção **Repetir toda semana em…** (e **Repetir até**, opcional). Os lembretes de compromisso
são notificações do servidor e dependem de **Ajustes → Notificações**.

### Objetivos e jornadas

A visão **Objetivos**, no **Planejar**, junta o porquê e os projetos. Um **objetivo** é o porquê, com um **Horizonte**
opcional em texto livre (ex.: "Primeira vaga em Engenharia de Dados · 2027") e um **Por que importa?** opcional. Uma
**jornada** é um projeto que serve a ele: um resultado esperado e várias missões em ordem. **Só a próxima missão aparece
no Agora**, para não virar lista de tarefas.

- **Novo objetivo** cria um objetivo ativo. Até **5 ativos**: ao criar ou ativar um sexto, a folha pergunta qual pausar;
  sem escolher, ele fica pausado. Nada é bloqueado.
- Cada objetivo aparece com as suas jornadas (arraste para reordenar dentro dele) e um **Editar**, que muda o texto e a
  **Situação** (Ativo, Pausado, Concluído, Arquivado). Objetivos não são apagados: saem da frente como arquivados.
- As jornadas sem objetivo ficam em **Sem objetivo**. Escolha o objetivo de uma jornada com um toque em **Nova jornada** ou na
  ficha da jornada, em "Editar título, resultado, objetivo e área".
- **Mostrar concluídos e arquivados** mostra os objetivos e as jornadas que saíram da frente.

O endereço antigo `/jornadas` abre essa visão. Ao concluir uma jornada, você ganha um bônus de XP; objetivos e temporadas
não dão XP. Uma jornada pode ter área, um baralho de estudo e sessões de prática.

---

## 4. Estudo

A aba **Estudo** reúne revisão espaçada, lousas, prática técnica, os PDFs da aula (em **Materiais**) e o progresso
por matéria. Ela mostra, de cima para baixo:
**Hoje**, **Rascunhos para completar**, **Baralhos**, **Lousas**, **Prática técnica**, **Próximos dias**,
**Observado** e **Preferências de estudo**.

### Matérias

**Estudo → Matérias** mostra um cartão por matéria: cada disciplina, cada jornada ativa com baralho ou prática
ligada, e cada baralho sem jornada. Em cada uma: cards aprendidos do total (com uma barra), quanto você lembrou
dos cards maduros nos últimos 30 dias (a partir de 20 revisões), minutos de revisão nesta semana,
tópicos, sessões de prática e quantas com Autônomo, e a próxima entrega. Só números observados, sem nota.
Dali você abre a jornada, o baralho ou a revisão só daquele baralho.

**Perfil de estudo.** No topo de Matérias fica o **Perfil de estudo**: como você aprende melhor, seus horários, o
que funciona. Ele vale para todas as disciplinas: os chats de todas as matérias leem este perfil. Toque em
**Editar**, escreva (aceita Markdown: listas, **negrito**, títulos com #) e **Salvar**; um chat também pode propor
um perfil novo, que você revisa como as outras propostas.

**Disciplinas da faculdade.** Sem nenhuma disciplina cadastrada, Matérias oferece **Cadastrar a grade do
semestre?** com uma grade de exemplo (seg Estruturas de Dados, ter Matemática Discreta, qua Banco de Dados, qui
Redes de Computadores, sex Engenharia de Software, das 19h30 às 22h30). **Confirmar** cria uma jornada por disciplina na área
Faculdade e a aula semanal de cada uma; o que já existe com o mesmo nome é reaproveitado e nada é duplicado.
**Editar antes** troca nomes, dias e horários pelos seus. **Nova disciplina** cadastra outra quando a grade mudar.
O compromisso genérico "Aula" nunca é apagado sozinho: o card diz onde apagá-lo.

No cartão de cada disciplina aparecem a aula (dias e horário), a **próxima avaliação** ("em N dias"), "Sem
contato há N dias de estudo" (só a partir de 5; ler um PDF da disciplina por pelo menos um minuto também conta como
contato), os últimos
exercícios e os assuntos por nível. **Abrir disciplina** leva à tela dela, com:

- **Chat da disciplina:** cole o link do chat ou do projeto do ChatGPT (ou de qualquer endereço `https://`) em
  **Link do chat ou do projeto** e toque em **Salvar**. Depois, **Abrir chat** abre a conversa numa aba nova e
  **Trocar link** muda o endereço (apagar o campo e salvar remove o link). O link é colado à mão, porque o chat não
  sabe o próprio endereço, e nunca é enviado a um assistente. Dali também dá para mandar o que o chat ensinou para
  a disciplina (veja **Estudo pelos chats** em Assistentes).
- **Caderno:** a memória da disciplina entre as conversas, em quatro seções: **Plano de ensino** (ementa,
  objetivos, cronograma e critérios de avaliação), **O que já foi estudado**, **Dificuldades** e **Para o próximo
  chat** (o que um chat novo precisa saber para continuar, inclusive como ensinar você). Cada seção mostra o texto
  formatado (listas, **negrito**, títulos, fórmulas e código; nunca roda HTML) e tem **Editar**, com **Salvar** e
  **Cancelar**; texto longo aparece cortado, com **Ver tudo**. Seção vazia diz "Vazio. Peça ao chat da matéria para
  preencher." Na **Bibliografia**, cada livro tem título, autores e tipo (básica, complementar ou outra), **Abrir**
  (só links `https://`, numa aba nova) e **Apagar** (com **Desfazer**); **Adicionar livro** pede título, autores,
  tipo e link.
- **PDFs:** os PDFs da aula (slides, plano de ensino, capítulos de livros). **Adicionar PDF** escolhe o arquivo; o
  app mostra "Lendo o PDF…" enquanto conta as páginas e separa o texto de cada uma (é esse texto que o chat da
  matéria lê). Cada PDF mostra o título, o número de páginas, onde você parou ("p. 34 de 120") e a marca **Neste
  aparelho** quando o arquivo está guardado aqui. **Abrir** abre o leitor (veja [PDFs da aula](#pdfs-da-aula));
  **Baixar para ler sem internet** guarda o PDF neste aparelho; **Tirar deste aparelho** pergunta ao PC se ele tem o
  PDF ("Conferindo com o PC…") e só apaga a cópia daqui quando o PC responde que tem. Se o PDF ainda espera envio, se
  o PC está desligado ou fora de alcance, ou se o PC não tem o arquivo, o botão avisa "Este PDF ainda não foi enviado
  ao PC. Abra o app com o PC ligado antes de tirar." (quando o PC responde que não tem, o app manda o PDF de novo na
  próxima sincronização). **Apagar** tem **Desfazer**; um minuto depois, na próxima sincronização, o app tira deste
  aparelho os PDFs apagados, também só depois que o PC confirma que tem uma cópia. Um arquivo que não é PDF, que passa
  de 50 MB ou que tem senha recebe a frase do motivo. Um PDF escaneado (só imagem) abre normalmente, mas não tem texto
  para o chat.
- **Apostilas:** resumos, explicações e listas de exercícios que os chats escrevem para você, com o dia e quem
  escreveu. Um toque abre a apostila numa tela própria, boa de ler no celular e no notebook, com fórmulas e código.
  **Salvar como PDF** abre a impressão, e a folha sai sem os menus e os botões: no computador, escolha "Salvar como
  PDF" como impressora; no iPhone, abre a tela de impressão do iOS. **Apagar apostila** tem **Desfazer**.
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

### PDFs da aula

**Estudo → Materiais** (o botão **Materiais** em Baralhos) reúne todos os PDFs, por disciplina, e o grupo **Sem
disciplina**. Ali, **Adicionar PDF** tem ao lado a escolha da disciplina, e cada PDF tem **Disciplina** para mudá-lo
de lugar. Os chats das matérias leem só os PDFs ligados a uma disciplina; os de "Sem disciplina" ficam só com você.
Um PDF grande (mais de 8 MB) sobe para o PC depois dos outros dados, sem segurar a sincronização das revisões; até
terminar de subir, os outros aparelhos dizem que o PC ainda não tem o PDF.

**O leitor** abre na página onde você parou, mesmo que tenha parado em outro aparelho, e mostra "p. 12 de 120".
Dá para ir a uma página, **Ajustar à largura**, aumentar e diminuir o zoom (o zoom rola dentro da área do PDF). As
páginas são desenhadas quando chegam perto da tela, então um livro de 300 páginas não trava; no fim de um PDF de
slides, rolar até embaixo chega ao último slide ("p. 40 de 40"). A página atual é guardada a cada poucos segundos e
ao sair. Abrir pelo **Ver no PDF** não muda onde você parou: só se você seguir lendo dali, 2 páginas ou mais adiante
ou atrás. Num aparelho que ainda não tem o PDF, ele é baixado do PC na hora em que você abre ("Baixando o PDF…"),
nunca sozinho em segundo plano, para não encher o celular; sem internet e sem cópia local, o leitor diz "Este PDF
não está neste aparelho. Abra com o PC ligado para baixar." O leitor funciona sem internet quando o PDF já está no
aparelho, inclusive os escaneados em preto e branco (capítulos xerocados) e os com imagens JPEG 2000. No iPhone, os
PDFs precisam do iOS 17.4 ou mais novo (no computador, de um Chrome, Edge, Firefox ou Safari atual).

**Criar card desta página:** selecione um trecho e toque no botão. Abre uma folha com a **Frente** vazia (a
pergunta é sua), o **Verso** com o trecho, o baralho da disciplina já escolhido e a origem "Título · p. 12". Salvar
cria um card normal, que entra na revisão. Sem seleção, o verso começa vazio. Se a disciplina do PDF foi apagada, a
folha não escolhe baralho e diz por quê: escolha outro, ou mude a disciplina do PDF em Materiais. Na revisão, depois
de mostrar a resposta, um card criado de um PDF tem **Ver no PDF, p. 12**, que abre o leitor nessa página; **←
Revisão** volta para a mesma revisão (a do baralho, se era **Revisar este baralho**).

**Lembrar antes de sair:** ao sair do leitor depois de ler pelo menos 3 páginas novas ou 5 minutos, aparece "Sem
olhar, o que você lembra das páginas 12 a 18?". O que você escrever, um ponto por linha, vira um card de **Tópico**
no baralho da disciplina, com a frente "Título · p. 12–18". **Pular** fecha sem criar nada. Só conta o tempo de
leitura de verdade: o tempo com o celular bloqueado ou em outro app fica de fora, e um trecho sem tocar nem rolar
conta no máximo 3 minutos (uma página difícil lida com calma conta; o leitor esquecido aberto não). Uma página conta como lida depois de 8 segundos nela, então passar rápido por 10 páginas
não pergunta nada. Ler pelo menos um minuto conta como contato com a disciplina. Se o PDF ou a disciplina for
apagado com o leitor aberto, a folha não aparece. Ler não dá XP.

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

### Fala (comunicação oral)

Em **Estudo → Fala** você pratica falar com mais clareza, naturalidade, ritmo e conforto, com gravação e **sem nota**.
Abrir a tela não grava nada.

**Hoje.** Três atividades sugeridas, uma por tamanho: **5 min**, **15 min** e **25–30 min**. O tamanho é só um rótulo:
nada é cronometrado. **Começar** abre a sessão já preenchida; **Nova sessão** abre vazia. Com o programa de 12 semanas
ativo, as sugestões são as da semana; sem ele, são sugestões livres.

**A sessão.** Escolha a atividade: **Leitura de referência** (um dos três textos do app, sempre o mesmo texto), **Explicação
espontânea** (de 1 a 3 minutos, explicando algo seu: um JOIN, o pipeline do Tech News, um card de tópico), **Exercício**
(pausas, ritmo, ênfase ou articulação) ou **Simulação** (entrevista, apresentação, pergunta em aula). **Gravar** grava até
3 minutos; ao tocar **Parar**, a gravação já fica guardada no aparelho (e vai para o servidor na próxima sincronização).
Grave quantas vezes quiser. Fechar a sessão no meio de uma gravação para e guarda antes de fechar.
Se você sair da tela com uma gravação em andamento, o app também a guarda.

Depois, se quiser: **Como você percebeu?** (clareza percebida, ritmo, pausas e conforto vocal, de 1 a 5, em que 5 é "como
eu queria"), **Consegui explicar?** (o conteúdo, separado da fala) e notas. Tudo isso é percepção, não medida.
**Encerrar sessão** pede uma gravação ou **Fiz a atividade** e dá um pouco de XP de esforço, no máximo duas sessões por dia.
Fechar sem encerrar guarda o que você escreveu, com a sessão em aberto.

**Velocidade, só na leitura de referência.** Como o texto é fixo, o app divide as palavras do texto pela duração da
gravação. A duração vai do toque em Gravar ao toque em Parar: toque em Parar logo ao terminar. A velocidade é observação,
não meta: **mais devagar não é automaticamente melhor**. Na fala espontânea não há velocidade (seria preciso transcrever, e
transcrição automática não mede se você foi entendido), e o app **nunca mede volume** (o microfone depende do aparelho e da
distância).

**Comparar gravações.** Abre com a primeira e a última leitura do mesmo texto, lado a lado, com data e percepção. Ouça uma e
depois a outra; o que mudou é você quem percebe.

**Situação real.** Depois de uma aula, conversa, entrevista ou apresentação, **Registrar situação real** (também pelo botão
**Situação de fala** do "Como foi hoje?"): o contexto, se pediram para repetir (0, 1, 2, 3+), clareza e conforto percebidos e
uma frase. É o que mostra se a prática chega ao dia a dia, com a ressalva de que pedidos de repetição dependem também do
ambiente e de quem ouve.

**Programa de 12 semanas (opcional).** Quatro fases: observar e criar referências (semanas 1–2); pausas, ritmo, articulação,
ênfase e volume confortável (3–5); explicações técnicas e simulações (6–8); situações reais (9–12). **Você escolhe a semana**
com **Semana anterior** e **Próxima semana**: o calendário nunca avança sozinho, e pular, repetir ou parar não é atraso. No fim
de cada fase, uma pergunta opcional: o que mudou nas situações reais? A resposta que você digitar fica guardada mesmo se sair da tela.

**Gravações e espaço.** Leituras de referência e gravações com **Guardar** ficam sempre. As outras podem sair deste aparelho
depois de 30 dias: **Espaço das gravações → Tirar gravações antigas deste aparelho** mostra a lista e só tira com o seu toque.
Antes de tirar, o app confere com o servidor, uma a uma, e só sai a gravação que o servidor confirma ter; as outras ficam e o
aviso diz quantas. Para ouvir de novo uma que saiu, **Buscar no servidor**. Nada sai sozinho, e sem a sincronização conectada
(o servidor de casa) nenhuma gravação pode sair do aparelho.
Se você mexer na mesma sessão em dois aparelhos, as gravações dos dois são mantidas; nos outros campos vale a alteração mais
recente.

**Saúde vocal.** Rouquidão que não melhora em cerca de 4 semanas, dor ao falar, perda de voz ou esforço constante para ser
ouvido são motivos para procurar um otorrinolaringologista ou um fonoaudiólogo. Pratique num volume confortável; se a voz
cansar ou doer, pare. O app não avalia a sua voz e não faz diagnóstico.

**Ponte com o estudo.** No fim de uma prática técnica encerrada, **Explicar em voz alta** abre uma sessão de fala já com o tema
da prática. Abrir e fechar sem mexer não guarda nada. Na sessão, **Escolher de…** traz as suas jornadas, matérias e cards de
tópico.

O relatório **Comunicação oral** (Diário → Relatórios) mostra as sessões, as gravações (só a lista, com datas), a velocidade das
leituras, as situações reais e as suas percepções, separadas dos fatos.

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
descanso da musculação). **Editar plano** (`/corpo/plano`) muda o nome de cada dia e, por exercício, as **séries**,
as **repetições de/até**, o **descanso** (botões 60 s, 90 s, 2 min, 2–3 min, 3 min, 3–4 min ou **Outro**) e uma
**observação**; **Subir**, **Descer** e **Remover** arrumam a lista. Tudo além do nome é opcional, e planos antigos só
com nomes continuam valendo. Cargas nunca são inventadas: só entram quando você registra.

**Bloco de treino (opcional).** No fim do plano, **Começar um bloco** pede o início, o número de semanas (1 a 8) e,
por semana, a faixa de RIR (repetições que ainda daria para fazer com boa técnica) e, se quiser, os minutos de
cardio. O treino de hoje mostra "Semana 2 de 4 · RIR ~2 · cardio 30 min" e o cardio mostra a meta da semana.

**Treino de hoje.** O Corpo e o bloco Treino do Agora mostram "Treino de hoje: Pernas". **Abrir o treino de
hoje** (no Agora, **Abrir treino**) leva à tela do registro: em cada exercício, repetições e carga (kg) e
**Salvar série**, **Pulei** ou **Troquei por…**; a linha do plano ("3 × 6–8 · descanso 2–3 min") e a linha
"Última: 3 × 10 · 40 kg · RIR 2, 2, 1" lembram o pedido e a sessão anterior sem preencher nada. Na série, a fileira
**RIR 0 1 2 3 4 5+** é opcional. Salvar uma série de um exercício com descanso no plano abre a faixa **Descanso**
no rodapé (Pausar, Pular), que conta até o mínimo e mostra "Pode ir"; ela segue o relógio e não toca som.
**Senti desconforto** anota onde (ombro, cotovelo, punho, lombar, joelho, canela ou outro) e uma nota; o app só
registra, nunca diagnostica. Quando a última sessão chegou ao topo da faixa em todas as séries pedidas, com a mesma
carga e com o RIR da semana (sem bloco, só as repetições contam), aparece **Pronto para subir a carga** com o motivo.
A carga nova é você quem escreve. Também dá para pôr um **Exercício fora do plano**, registrar o **Cardio** (modalidade, minutos e
intensidade percebida de 1 a 10) e, se quiser, esforço e recuperação. **Terminei o treino** pede os minutos (o
tempo desde "Começar bloco", quando houver). Um dia passado pode ser corrigido em `/corpo/treino?dia=AAAA-MM-DD`;
o que você registra para um dia passado não dá XP.

**Evolução por exercício** e **Cardio por semana**, no Corpo, mostram como observado a melhor série e o volume
das últimas sessões de cada exercício e as sessões e minutos de cardio das últimas 8 semanas completas. Sem
recorde ou meta; o RIR das séries e as marcas de desconforto aparecem junto.

Também dá para usar **Registrar treino** direto: musculação, cardio ou outro,
mais os minutos. A contagem da semana é observada, sem meta. A **versão mínima do cardio** é 10 minutos de
caminhada leve ou bicicleta, em ritmo de conversa, e conta como cardio. No bloco, **Fiz o cardio mínimo** registra de
um toque. "Começar é a parte difícil: a versão mínima vale o mesmo XP."

### Nutrição

Em **Personagem → Corpo**, a seção **Nutrição** mostra o resumo de hoje ("Hoje: 1.180 de 2.350 kcal · P 80/170 · C
140/260 · G 35/70") e **Abrir nutrição** (`/corpo/nutricao`). Sem metas, aparece **Definir metas**. Os números deste
guia são exemplos inventados.

**Alimentos e receitas** (`/corpo/nutricao/alimentos`). O app não traz tabela nutricional: você cadastra os alimentos
que come em **Novo alimento**, com os valores por 100 g (calorias, proteína, carboidratos, gorduras e, se quiser,
fibra), a **referência** (**Pronto**, cozido e pronto para comer, ou **Cru**), a **fonte** (**Rótulo**, **Tabela** quando
você consultou uma base reconhecida, ou **Estimativa**, que aparece como "estimado" nos totais), o **grupo** (o plano usa
proteína, carboidrato, verdura, fruta e gordura; **Outro** fica de fora), a **preferência** (**Pouco** entra no plano no
máximo uma vez por dia; **Nunca** não é sugerido, mas dá para registrar) e, se quiser, uma **unidade** ("1 fatia = 25 g")
e uma **porção máxima** por refeição (sem ela, o plano usa o limite do grupo, como 250 g de proteína, e no máximo 4
unidades). **Bom para** marca as refeições em que o plano pode usar o alimento (nenhuma marcada vale para todas):
assim o café da manhã não recebe arroz e frango só porque estão no estoque. Se as calorias digitadas não batem com os
macros, a tela avisa sem impedir de salvar. **Nova receita** pede os ingredientes (um
alimento e as gramas, inclusive o óleo ou o azeite do preparo) e o rendimento final, pesado depois de pronto; os valores
por 100 g aparecem calculados enquanto você digita e ficam guardados ao salvar. Apagar um alimento não muda o diário:
cada registro guarda uma cópia dos valores.

**Metas e peso** (`/corpo/nutricao/metas`). As metas são gramas de proteína, carboidratos e gorduras em dois grupos,
**Segunda a sexta** e **Sábado e domingo**; as calorias saem delas (4 kcal por grama de proteína e de carboidrato, 9
por grama de gordura). **Salvar metas** vale a partir de hoje e guarda as anteriores no histórico ("Desde 11/11: …"),
e os dias passados continuam com a meta que valia neles. Em **Refeições**, ligue só as que você faz (café da manhã,
lanche da manhã, almoço, café da tarde, jantar e ceia). Em **Peso**, digite os kg e toque em **Registrar**: aparecem a
última pesagem, a média dos últimos 7 dias com pesagem e a mudança em relação à média anterior. Uma pesagem isolada não
muda as metas.

**O dia** (`/corpo/nutricao`). O topo mostra a meta do dia, o comido, o planejado e o que falta, em calorias e em
P/C/G, com barras. Passar da meta aparece como "passou 12 g", sem alarme.

- **Estoque de hoje:** o que você tem hoje. O que tinha antes aparece como "Tinha em 24/11" com **Confirmar**, porque o
  estoque de ontem precisa ser confirmado no dia. As gramas são opcionais; com elas, o que você come é descontado.
  **Adicionar ao estoque** usa a mesma busca de alimentos.
- **Adicionar o que comi**, em cada refeição: escolha o alimento (os do estoque de hoje vêm primeiro), digite as gramas
  (vírgula vale) ou toque nas unidades ("2 fatias") e **Registrar**. Toque num item comido para corrigir as gramas, ou
  **Apagar** (com **Desfazer**).
- **Montar o resto do dia:** escolha a fome (**Pouca**, **Normal** ou **Muita**) e, em "Treino hoje antes de…", a
  refeição que vem logo depois do treino (ou **Sem treino**): ela vira pós-treino e a anterior, pré-treino, e as duas
  recebem mais carboidrato no plano. **Montar** distribui o estoque confirmado nas refeições que faltam e mostra o total
  planejado, a diferença para a meta e frases como "Faltam 35 g de proteína.", com a sugestão de um alimento cadastrado
  que fecharia a diferença. O que você comeu nunca muda: montar de novo troca só os itens planejados das refeições sem
  nada comido. Num item planejado, **Comi** registra com as gramas sugeridas (dá para trocar antes) e **Tirar** o tira
  do plano. Sem metas ou sem estoque confirmado hoje, a folha explica e leva até lá.

Nada da nutrição dá XP, tem sequência ou aparece no personagem, como o sono. Os assistentes (ChatGPT e Claude) nunca
leem nada daqui.

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
- **Experimento sugerido:** uma mudança pequena e reversível para testar. **Testar como estratégia** a registra em
  [Estratégias](#estratégias), em teste a partir de hoje; ela aparece no Agora. Várias podem estar em teste ao mesmo
  tempo; uma que já está em teste mostra **Já está em teste**.

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
  vermelho, que também diz que pode ser só variação. Com uma temporada ativa, ele diz também em que semana dela você está. As opções são **Testar como estratégia** ("a meta é só a versão
  mínima"), **Ajustar a rotina** ou **Está tudo bem assim**, que dispensa o aviso daquele começo.
- **Reflexão do mês:** nos 7 primeiros dias de cada mês aparece no Agora uma reflexão opcional de 3
  perguntas, com os números do mês acima das perguntas. **Pular este mês** grava sem respostas e não volta;
  **Agora não** esconde pelo resto do dia, mesmo se você fechar e abrir o app. Em Padrões, as reflexões antigas ficam em **Reflexões do mês**
  e podem ser editadas.

### Como ler

1. Comece pelo **Observado**. É o único rótulo que afirma algo sobre o que aconteceu.
2. Leia a **Hipótese** como pergunta, não como veredito.
3. **Associação não é causa.** Uma semana de provas, ansiedade ou uma gripe pode encurtar o sono e também o
   dia seguinte. Os números lado a lado servem para pensar, não para concluir.
4. Compare com calma: uma estratégia é revista, por padrão, depois de 14 dias, e dá para testar várias ao mesmo tempo.
   Quando houver várias mudanças juntas, fica mais difícil saber o que ajudou. Uma semana ainda pode ser acaso.
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
- terminar uma sessão de prática técnica ou de fala, um treino ou um preparo em lote.

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

Quando um território sobe de estágio por XP ganho agora, o companheiro celebra uma vez, no aparelho
onde você ganhou o XP, e o Personagem desse aparelho mostra "Novidade" por 3 dias. Os outros aparelhos
só atualizam o mapa quando sincronizam, sem repetir a festa.

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

- **Agora:** o bloco e a missão principal, com alternativas, e um card de momento por vez com **Mais para hoje**, como no celular.
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
   - **No servidor de casa:** coloque `ANTHROPIC_API_KEY=...` (e, se quiser, `LIFE_RPG_AI_DAILY_LIMIT=30`) no arquivo
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

### Assistentes: ChatGPT e Claude

Dá para conectar o ChatGPT ou o Claude (os que você já usa e que já sabem da sua rotina) ao LIFE RPG por um conector
MCP. Numa conversa, o assistente lê como o app está montado e manda **propostas**: áreas, rotina em blocos,
compromissos fixos, jornadas com missões, missões avulsas, objetivos, temporada, plano de treino (com séries, faixas,
descansos e bloco), disciplinas, o que você estudou em cada disciplina, o caderno e as apostilas de cada disciplina,
o seu perfil de estudo e início e fim do dia. Nada muda sem você.

1. **Sincronização conectada** no app (o assistente fala com o seu servidor, não com o aparelho).
2. No computador que serve o app, rode `tailscale funnel --bg --https=8443 http://127.0.0.1:8788`. Isso publica na
   internet **só a porta do assistente** (MCP e login); o app e a sincronização continuam privados. O Funnel precisa
   estar liberado no painel do Tailscale. O computador precisa estar ligado durante a conversa.
3. Em **Ajustes → Assistentes (ChatGPT e Claude)**, cole o endereço `https://…` que o Funnel mostrou e toque em
   **Ligar assistentes**. O app mostra o endereço do conector (`…/mcp`).
4. No ChatGPT ou no Claude, adicione um **conector personalizado (MCP)** com esse endereço. Abre uma página do LIFE
   RPG que diz o que o assistente poderá fazer e pede o seu **código de acesso**; toque em **Permitir**. O assistente
   recebe uma chave limitada a ler o contexto e enviar propostas; o código de acesso nunca chega a ele.
5. Converse. Peça, por exemplo, "monte minha rotina no LIFE RPG com o que você sabe de mim". Ele chama
   `ler_contexto` e depois `enviar_proposta` (o ChatGPT pede a sua confirmação antes de enviar).
6. No app aparece **Proposta do assistente · N itens** no Agora. **Revisar** mostra os itens por grupo, com o porquê de
   cada um; desmarque o que não quiser e toque em **Aplicar selecionados** (ou **Recusar**). O que já existe com o
   mesmo nome é reaproveitado; o que não cabe mais é pulado com o motivo. Aplicar não dá XP.

**Sem conector:** se você não consegue adicionar um conector (limite do plano, outro chat), use **Ajustes → Assistentes → Sem conector**, que funciona com qualquer chat, sem servidor e sem sincronização, até offline. **Copiar pedido para o chat** copia um texto com as regras, o formato e como o app está montado (o mesmo que o assistente lê pelo conector, sem diário, sono nem nutrição). Cole no chat e converse; quando você concordar, o chat responde com um bloco JSON. Toque em **Colar resposta do chat**, cole a resposta e toque em **Revisar proposta**: o app confere o formato e, se estiver certo, abre a mesma revisão (fonte "Colada de um chat"); se houver problemas, mostra a lista para você levar de volta ao chat. Se o aparelho não deixar copiar sozinho, o texto aparece numa caixa para você copiar à mão.

**Estudo pelos chats:** se você tem um chat por matéria, dá para juntar o que cada um já ensinou dentro da
disciplina. Com o conector ligado, peça no chat da matéria algo como "manda para a disciplina Banco de Dados no LIFE
RPG o que vimos aqui". Sem conector, abra a disciplina e use **Chat da disciplina → Copiar pedido de estudo** (o
pedido do "Sem conector", já focado nessa disciplina), cole no chat e depois toque em **Colar resposta do chat** ali
mesmo. Na revisão aparece o grupo **Estudo**, um item por assunto, card, prova ou trabalho e tarefa, que você pode
desmarcar. Ao aplicar:

- os assuntos entram em **Assuntos** da disciplina; os que o chat marcou como já vistos ficam em **Vi na aula**. O
  chat nunca marca Entendi nem Resolvo sem ajuda (isso é você quem diz), e um nível nunca é rebaixado;
- os cards entram como **rascunho** no baralho da disciplina (se ela não tiver baralho, é criado um com o nome
  dela) e aparecem em **Estudo → Rascunhos para completar**. Só viram cards de revisão quando você abre, confere e
  salva cada um;
- as provas e os trabalhos entram em **Avaliações**, como os criados à mão;
- as tarefas viram missões da jornada da disciplina (uma dúvida vira, por exemplo, "Perguntar ao professor sobre …").

O que já existe na disciplina (assunto com o mesmo nome, card com a mesma frente, avaliação do mesmo tipo no mesmo
dia, missão aberta com o mesmo título) aparece como "já existia" e não é duplicado. Nada disso dá XP.

**Caderno da disciplina e apostilas:** os chats "conversam entre si" pelo app. Antes de ensinar ou propor estudo de
uma disciplina, o chat chama `ler_disciplina` e recebe o caderno, o seu perfil de estudo, os assuntos com o nível
de cada um, as provas e trabalhos, a lista de apostilas e até 150 cards dos baralhos da disciplina; `ler_apostila`
lê uma apostila inteira. Assim, um chat recém-criado começa lendo esse material em vez de começar do zero. Ao
terminar, peça algo como "atualiza o caderno de Banco de Dados no LIFE RPG" ou "faz uma apostila de normalização e
manda para o LIFE RPG". Na revisão, no grupo **Estudo**, aparecem itens como "Caderno · Banco de Dados: Plano de
ensino (substitui o atual)" (com "Hoje está vazio." quando a seção ainda está vazia), "Bibliografia · …" e
"Apostila · Banco de Dados: Normalização passo a passo · 12 mil caracteres"; o "Perfil de estudo (substitui o
atual)" vem primeiro. Ao aplicar, cada seção enviada substitui a atual (o mesmo texto aparece como "já existia");
um livro com o mesmo título é atualizado, um novo entra no fim (até 40); uma apostila com o mesmo título na
disciplina tem o texto substituído (a revisão avisa antes: "Já existe uma apostila com este título: o texto será
substituído."), senão é criada. Sem conector, o **Copiar pedido de estudo** da disciplina já leva o mesmo conteúdo
de `ler_disciplina`, com os 60 cards mais recentes, então qualquer chat recebe a memória da disciplina. Uma proposta
pelo conector tem até 256 KB; acima disso o chat recebe "A proposta passou de 256 KB. Mande as apostilas em propostas
separadas."

**PDFs da aula:** `ler_disciplina` também lista os PDFs da disciplina (título, páginas e se têm texto), e
`ler_material` lê o texto das páginas que o chat pedir, com o número de cada página, até 40 mil caracteres por vez
(se passar, ele diz de que página continuar). Assim o chat monta apostilas, cards e o caderno a partir dos slides e do
plano de ensino, citando a página. Peça algo como "lê os slides da aula 3 e faz uma apostila de normalização". O texto
é lido no PC, então o PDF precisa ter chegado ao PC: se ainda não chegou, o chat recebe "O texto deste PDF ainda não
chegou ao PC. Abra o app no aparelho onde o PDF foi adicionado, com o PC ligado."; um PDF escaneado responde "Este
PDF não tem texto: é uma imagem escaneada." PDFs em "Sem disciplina" ou de disciplinas arquivadas ou concluídas nunca
são lidos. Sem conector, o **Copiar
pedido de estudo** lista os PDFs da disciplina só com o título e as páginas, sem o texto.

**O que o assistente lê:** perfil, áreas, rotina, compromissos fixos, jornadas, objetivos, temporada, missões abertas,
treino, disciplinas (com os nomes dos assuntos e as provas e trabalhos ainda abertos), um resumo em números das
últimas 4 semanas, o que aconteceu com as propostas anteriores e o estudo das disciplinas: caderno, apostilas, o texto
dos PDFs das disciplinas, assuntos, provas e trabalhos, os cards dos baralhos ligados a cada disciplina e o perfil de
estudo. **Nunca lê** diário, sono, nutrição, check-ins, registros de energia, estratégias, baralhos e cards fora das
disciplinas, PDFs fora das disciplinas nem o link do chat da disciplina. A conversa fica guardada pela empresa do assistente, pelas regras dela.

**Limites e segurança:** até 60 chamadas por hora e 10 propostas por dia por assistente; no máximo 3 propostas
esperando (a mais antiga é substituída). O login aceita 5 tentativas por minuto e bloqueia por 1 hora depois de 20
erros. Em **Assistentes conectados** você vê cada assistente e o último uso, e **Revogar** corta o acesso na hora;
**Desligar assistentes** revoga todos.

---

## 11. Backups e dados

- **Onde estão:** tudo fica em `data/` no servidor: o banco (`life-rpg.sqlite`), `token`, `vapid.json`
  (chaves de notificação) e `backups/`. Imagens, áudios, os PDFs da aula e o texto extraído deles ficam em
  `data/media/`. **Não apague `data/` nem `vapid.json`.**
- **Backup diário:** o servidor faz um backup por volta das 3h e guarda os 14 mais recentes. As mídias
  também são espelhadas em `data/backups/media/`, sem ocupar espaço extra e sem apagar nada.
- **Exportar:** em **Ajustes → Dados**, **Exportar JSON** (no iPhone, **Preparar exportação** e depois
  **Compartilhar arquivo**, para salvar em Arquivos). Imagens e áudios entram até 25 MB. Se passar, as que
  ainda esperam envio ao servidor têm prioridade, e Ajustes avisa antes. Os PDFs da aula e o texto extraído deles
  ficam fora da exportação (Ajustes diz isso); o backup diário do PC guarda uma cópia deles.
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
precisa estar ligado e acessível (no servidor de casa, o Tailscale precisa estar ligado nos dois aparelhos).

**Não recebo notificações no iPhone.**
No iPhone, notificações só chegam com o app **instalado** na Tela de Início, aberto pelo ícone, em uma página
**HTTPS**, e com a permissão do iOS aceita. Abra o app pelo ícone, vá em **Ajustes → Notificações** e
toque em **Ativar notificações**. Se a permissão foi negada, libere nos ajustes do iPhone.

**O microfone não funciona (gravar áudio ou "Responder falando").**
O navegador só libera o microfone em páginas **HTTPS** (ou `localhost`). Neste computador, o endereço
`localhost:8787` já serve. No servidor de casa, o endereço do Tailscale precisa de HTTPS (`tailscale serve`). Sem isso,
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
  mínima e as estratégias ligadas a um bloco vêm daí. O efeito é médio, não garantido.
- **Regularidade do sono:** em universitários, horários mais irregulares aparecem associados a notas mais
  baixas (Phillips e colegas, 2017, observacional, cerca de 60 estudantes). É **associação, não causa**. O
  app só mostra a sua regularidade como dado observado para você testar. Não é aconselhamento médico.
- **Hábitos levam tempo:** em um estudo, a formação de um hábito levou de semanas a meses, com grande
  variação entre pessoas, e perder um dia não comprometeu a formação (Lally e colegas, 2010). Por isso não há
  sequências que zeram, as temporadas de 6 a 8 semanas deixam as semanas atípicas fora da conta, e uma queda entre a 5ª e a 8ª semana é tratada como momento de ajuste, não como
  fracasso.
- **Mudar a situação:** estratégias de ambiente (celular em outro cômodo, biblioteca) aparecem numa revisão como mais
  fáceis de sustentar do que resistir na hora (Duckworth, Gendler e Gross, 2016). É evidência **promissora**, ainda em
  construção: o app registra e lembra, mas os números de um teste são observação, não prova de efeito.
- **Acompanhar o progresso dos objetivos:** registrar o progresso aumenta a chance de atingir metas, mais quando fica
  anotado (Harkin e colegas, 2016, meta-análise). Por isso o **Avançou?** é leve e opcional, e o app mostra o que esteve
  ligado a cada objetivo sem nota. Metas ligadas ao que importa para você aparecem associadas a esforço mais sustentado
  (Sheldon e Elliot, 1999): **associação, não causa**.
- **Pesquisar é trabalho:** em tarefas novas e complexas, metas de aprendizagem (descobrir como fazer) costumam render mais
  do que metas só de desempenho (revisão de Locke e Latham, 2002), sobretudo em estudos de laboratório. **Investiguei** é
  só um registro honesto disso; não promete efeito.
- **Registrar o estado do dia:** anotar humor e estado ajuda a notar variações pessoais, mas a adesão cai com o tempo e
  poucos dias não sustentam causas. Por isso são três toques opcionais e o resumo de 14 dias vem com essa ressalva.
- **Fala clara:** em estudos de laboratório sobre "fala clara" (revisão de Smiljanić e Bradlow, 2009), quem fala com
  articulação mais cuidadosa, mais pausas e ritmo um pouco mais lento costuma ser mais bem entendido por quem ouve. Esses
  estudos não separam qual ajuste pesa mais, os resultados variam entre pessoas, e a transferência para o dia a dia depende
  de prática. Por isso o app não trata "mais devagar" como meta, mostra a velocidade só como observação e usa as situações
  reais como termômetro. Gravar e ouvir a própria fala é **promissor, com evidência limitada**: daí a comparação sem nota.
- **Saúde vocal:** a diretriz clínica de rouquidão (disfonia) da Academia Americana de Otorrinolaringologia e Cirurgia de
  Cabeça e Pescoço (atualização de 2018) orienta avaliação quando a rouquidão não melhora em cerca de 4 semanas. O app só
  repete essa orientação geral; não avalia a voz.
- **Autoperdão:** perdoar-se por procrastinar associou-se a menos procrastinação depois (Wohl e colegas,
  2010). Daí o tom sem culpa em todo o app.

Os limites de nível, o orçamento de tempo, o teto de novos cards, os estágios do mapa, o limite de 5 objetivos, as 12 semanas do programa de fala, os 30 dias das gravações, a
duração das temporadas e o "um card por vez" do Agora são **decisões de produto**, não resultados de estudos.
