# LIFE RPG à luz da pesquisa científica (13/11/2026)

Análise do app na versão 1.0.0 contra a base `Scientific_Life_System_Research` (64 fontes, matriz de afirmações A01–A17, revisões temáticas e documento de contradições). Segue as instruções de transferência da própria base: descrever os fluxos que existem, localizar o obstáculo, ligar cada proposta a IDs de fontes e propor um teste proporcional. Nada aqui foi implementado. Código e escopo ficam para depois da sua escolha.

**Como ler os IDs.** B = execução e hábitos, L = aprendizagem e atenção, H = sono, fadiga e exercício, D = intervenções digitais, A = afirmação da matriz. "Direta" quer dizer que a evidência testou algo parecido com o fluxo do app; "indireta" quer dizer que o mecanismo tem evidência, mas a interface é uma tradução nossa.

## Resumo

- O desenho do app já segue a parte mais sólida da base: recuperação ativa e espaçamento (A07, confiança alta), plano com primeiro passo e retomada, versões mínimas, nenhuma sequência punitiva, notificações raras e opcionais, sono sem sensor e sem diagnóstico, e IA com pistas graduais em vez de resposta pronta (A17, L15).
- Um ponto contraria a base: **+2 XP por registrar uma noite de sono** recompensa o registro, não o comportamento (B14, D11, A06, A16). É a mudança mais barata e mais justificada.
- As melhores oportunidades novas são pequenas e testáveis com o "experimento da semana" que o app já tem: **reconstruir em outro dia** na prática técnica (transferência sem ajuda), **semana atípica** (provas, viagem) para não ler falta de oportunidade como desistência, e **previsão antes de revelar** na revisão (calibração), esta com evidência mais fraca.
- Alguns elementos são escolhas de experiência, não de evidência: XP, níveis, mapa e cores desbloqueáveis (gamificação tem efeito heterogêneo, A06), e a janela "semanas 5–8" (B09 mostra prazos de 18 a 254 dias). Vale mantê-los como gosto pessoal e deixar o texto do app honesto sobre isso.

## 1. O que já está alinhado com a evidência

| Fluxo no app (onde) | Mecanismo e evidência | Força e limite |
|---|---|---|
| Estudo → revisão espaçada FSRS, com orçamento diário e notas "Tópico" de lembrança livre | Recuperação ativa e espaçamento (A07: L01–L04, L16, L17 com g=0,37 para recuperação e g=0,20 para espaçamento) | Alta para retenção; o corpus L17 é escolar (K–12), a transferência para universitários é indireta. O orçamento evita a "fila que acumula", um risco citado em A07. |
| Revisão → responder escrevendo, desenhando ou falando antes de ver a resposta | Recuperação gerada, não reconhecimento (A07; mapa: "tentar explicar antes de ver material") | Moderada para o formato específico. |
| Agora → card "Antes de começar" em missões adiadas: nomear o que aparece e tentar 10 minutos | Pergunta opcional sobre o obstáculo + primeiro passo executável (A01; B01–B05, B18) | Baixa a moderada; opcional e pulável, o que respeita o risco de "formulário virar outra tarefa". |
| Missões com primeiro passo; blocos com horário; retomada com "onde parei" (ResumePrompt, Pausar na prática) | Plano se–então e nota de retomada (A03: B06 d=0,27; A12: H07, L13) | Moderada para direção (B06 robusto bayesiano d=0,15). O "se" está implícito no bloco; ver proposta P5. |
| Blocos com versão mínima; tipo do dia normal / baixa energia / recuperação; "Pular hoje" | Repetição viável em dias ruins, sem rigidez (A05: B09–B11) | Baixa para a interface, mas o desenho evita a sequência rígida que a base aponta como risco. |
| Constância conta dias de trabalho, sem sequência; "um dia parado não apaga nada"; mapa nunca regride | Evitar contagem punitiva e confundir pausa com abandono (D12, D13, contradições) | Coerente com o risco de "exibir perda de sequência pode desmotivar". |
| Padrões → observado / hipótese / experimento sugerido, amostras mínimas, "adiou" ao lado de "começou", associações sem coeficiente | Separar uso de progresso e não inferir causa individual (A01, A04, A16; D11–D13, D15) | Segue quase literalmente as recomendações de interpretação da base. |
| Semana → revisão curta e **um** experimento por semana | Metas com revisão de progresso e marco observável (A04: B07 d=0,34, B08 d=0,40) | Moderada para os componentes; baixa para a cadência semanal. É também a infraestrutura para testar as propostas abaixo. |
| Prática técnica → reconstruir sem consultar, comparar, indicador "Autônomo" separado de "Entregue" | Separar desempenho assistido de independente; exemplos e autoexplicação seguidos de retirada da ajuda (A09: L06–L11; A17: L15) | Moderada para suporte inicial; a base pede exatamente essa separação. |
| IA → pistas 1→2→3, sem código longo, pausadas durante a reconstrução, opcionais por ajuda | L15: GPT "Base" elevou a prática assistida em 48% e reduziu em 17% o desempenho sem ajuda; o "Tutor" com pistas mitigou grande parte do prejuízo | Moderada no contexto original (ensino médio, matemática, Turquia); extrapolação para programação é baixa. O desenho segue o braço protetor do ensaio. |
| Notificações → só compromissos e lembrete de desaceleração, ambos opcionais | Alertas ativos têm custo proximal de atenção (A10: L13, D06); lembretes mudam a ação imediata, manutenção incerta (A15) | Moderada para o custo; o app já escolhe pouco aviso. |
| Cronômetro → Livre, Pomodoro ou regressivo; a pausa só começa quando você toca | Pausas reduzem fadiga (H08 d=0,35); cadência fixa não superou pausa autorregulada (H13, H14) | O modo livre e a pausa sob controle seguem a evidência; ver P6 sobre o texto. |
| Sono em dois toques, sem sensor, médias só com 3+ noites, sintomas → "procure avaliação profissional" | Restrição de sono prejudica vigilância e memória (A11), mas a inferência individual é indevida; privacidade | Alta para a direção do efeito; o app não promete nada individual, como a base pede. |
| Treino com "versão mínima do cardio", sem promessa cognitiva | Atividade física como desfecho próprio (A14: H09 g=0,13 agudo; H10 ajustado ≈0) | A base desaconselha prometer ganho cognitivo; o app não promete. |

## 2. Onde o app vai além da evidência

1. **XP por registrar sono (+2 por noite).** Recompensa a entrada de dados, não o descanso. B14 (128 experimentos) mostra queda do comportamento de livre escolha após recompensa esperada (d≈−0,40) e D11 mostra que medir aumenta volume e pode reduzir prazer e intenção de continuar. Também contradiz a regra do próprio app: "XP nunca por volume de registro". → **P1.**
2. **XP, níveis, mapa, cores desbloqueáveis.** A gamificação educacional tem efeito agregado heterogêneo e a base dá confiança baixa a "sequências, rankings e recompensas de presença" (A06, B17, D10). No app o XP vem de esforço real (começar, concluir, revisar, praticar), sem ranking nem sequência, o que é o arranjo menos arriscado. Não há evidência de que o mapa mude comportamento; ele é identidade e gosto. Recomendo manter e não justificá-lo como técnica.
3. **Janela "semanas 5–8".** Vem da ideia de que a motivação inicial cai antes do hábito se formar. B09 descreve mediana de 66 dias, mas com intervalo de 18 a 254 dias e só 39 curvas bem ajustadas. O aviso já é gentil e opcional; o texto pode dizer que é uma janela de atenção, não um prazo.
4. **Cadência Pomodoro como opção de destaque.** H13 e H14 não encontraram vantagem de desempenho; H14 viu fadiga crescer mais rápido no Pomodoro (exploratório). Não é um erro oferecer, só não deve parecer a recomendação. → **P6.**

## 3. Propostas (formato pedido pela base)

Cada proposta é reversível e pode ser testada como experimento da semana. A ordem é pelo equilíbrio entre força da evidência, custo e risco.

### P1. Tirar o XP do registro de sono

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Faixa Cuidados → Deitei/Acordei e folha da noite. Alvo: dormir com regularidade, não registrar mais. |
| Mecanismo e evidência | B14 (recompensa esperada reduz livre escolha), D11 (medir aumenta volume e pode reduzir prazer), A06, A16. Indireta: nenhum estudo testou XP de sono. |
| Opção e comparador | Sem XP por noite registrada (o registro continua, as médias continuam). Comparador: fluxo atual. |
| Benefício, custo e dano | Coerência com a regra do app e menos incentivo a registrar por pontos. Custo de implementação mínimo. Dano possível: registrar menos; se acontecer, a falta de dado já aparece como "sem registro", não como zero. |
| Critério de decisão | 4 semanas: se as noites registradas caírem a ponto de as médias ficarem indisponíveis por semanas e você sentir falta, reavaliar (por exemplo, voltar a dar XP só para "dormir na janela escolhida", que é comportamento). |

### P2. Reconstruir em outro dia (prática técnica)

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Prática → passo Reconstruir → depois de comparar. Hoje o app só sugere em texto: "Fazer isso em outro dia é um teste ainda melhor". Alvo: resolver sem ajuda depois de um intervalo. |
| Mecanismo e evidência | Recuperação espaçada (A07), retirada de apoio e teste sem ajuda (A09: L08–L11), desempenho assistido ≠ independente (A17: L15). Direta para o mecanismo; indireta para a interface. |
| Opção e comparador | Botão "Reconstruir de novo daqui a N dias" que agenda uma nova reconstrução (como card do baralho escolhido ou missão datada), com o código escondido. Comparador: sessões em que você não agenda. |
| Benefício, custo e dano | Mede transferência real (o indicador "Autônomo" na segunda tentativa). Custo: um toque. Dano: fila extra; limitar a uma reconstrução pendente por sessão. |
| Critério de decisão | Após 6 a 8 sessões: comparar a taxa de "Autônomo: sim" na reconstrução tardia contra a imediata. Se quase sempre falhar, o intervalo está longo ou falta pré-requisito; se quase sempre passar, encurtar o apoio antes. |

### P3. Semana atípica

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Card "Nova semana" e Planejar → Semana. Alvo: retomar depois de provas, viagem ou feriado, sem que a semana conte como queda. |
| Mecanismo e evidência | Repetição em contexto estável e retorno após ruptura (A05: B09–B11); pausas e retomadas de registro (D12). A base insiste em "distinguir dia sem oportunidade de dia em que houve desistência". Indireta. |
| Opção e comparador | Marcar a semana como atípica, com motivo e data de retorno. Efeitos: blocos sugerem a versão mínima, o aviso das semanas 5–8 e as tendências tratam a semana como atípica (anotada, fora das comparações), e na data de retorno o Agora oferece retomar. Comparador: semanas atípicas sem marca (o fluxo atual). |
| Benefício, custo e dano | Padrões mais honestos e retomada explícita. Custo moderado (toca dados de Padrões). Dano: usar como desculpa recorrente; o app pode mostrar quantas semanas foram marcadas. |
| Critério de decisão | No próximo período de provas: blocos retomados em até uma semana após a data de retorno, comparados ao último período sem marca. |

### P4. Previsão antes de revelar (calibração), opcional por baralho

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Revisão → antes de "Mostrar resposta". Alvo: saber onde erra (confiança × acerto). |
| Mecanismo e evidência | Treino de autorregulação com feedback (L06 g=0,38 em 5.786 universitários; L07 d=0,48 com conteúdo informativo); mapa: "ciclo previsão–tentativa–feedback", confiança baixa a moderada. Indireta: pacotes combinam componentes. |
| Opção e comparador | Desligado por padrão. Ligado: dois botões "Acho que sei / Não sei" antes de revelar; Padrões mostra a diferença entre previsão e resultado por baralho. Comparador: baralhos sem previsão no mesmo período. |
| Benefício, custo e dano | Mostra excesso de confiança em tópicos específicos. Custo: um toque por card, o que pesa no orçamento de 15 minutos. Dano: preencher mecanicamente (a base cita isso). |
| Critério de decisão | 4 semanas: se a diferença entre previsão e acerto não diminuir e a retenção (acerto em cards maduros) não mudar, desligar. |

### P5. Deixar o "se" do plano explícito em missões adiadas

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Agora → card "Antes de começar" e adiar missão. Alvo: transformar uma intenção adiada em início numa ocasião real. |
| Mecanismo e evidência | B06 (642 testes): d=0,27 para comportamento, maior em formato contingente "se X, então Y"; estimativa robusta d=0,15. Direção moderada; interface indireta. |
| Opção e comparador | Ao adiar pela segunda vez, oferecer "Quando?" com um bloco da semana ou horário, e "Então:" pré-preenchido com o primeiro passo. A missão aparece no bloco escolhido. Comparador: adiar com data, como hoje. |
| Benefício, custo e dano | Ocasião concreta + ação. Custo: um passo extra só para missões já adiadas. Dano: plano para tudo vira manutenção (risco de A03); limitar às missões com 2+ adiamentos. |
| Critério de decisão | 4 semanas: fração de missões adiadas com plano que começam na ocasião escolhida, contra as adiadas sem plano (Padrões → Adiamentos já mede "adiou × começou"). |

### P6. Texto do cronômetro sem sugerir que Pomodoro é o melhor

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Cronômetro de foco e Ajustes → Foco. Alvo: pausar quando a fadiga aparecer ou no limite natural da etapa. |
| Mecanismo e evidência | H08 (micropausas reduzem fadiga, desempenho incerto), H13 (176 universitários: pausa autorregulada com melhor energia e concentração, |d| 0,36–0,55, sem diferença de desempenho), H14 (25/5 sem vantagem; fadiga subiu mais rápido no Pomodoro, exploratório). Direta para universitários estudando. |
| Opção e comparador | Modo Livre como padrão, com a frase "Pause quando sentir que caiu, ou ao fim de uma etapa". Pomodoro continua disponível. Comparador: configuração atual. |
| Benefício, custo e dano | Coerência com a evidência. Custo quase zero (texto e padrão). Dano: nenhum relevante. |
| Critério de decisão | Não precisa de teste; é ajuste de texto. Se quiser, comparar duas semanas Livre vs Pomodoro pela sua percepção de fadiga no fim do bloco. |

### P7. Mostrar o uso de pistas ao lado do "Autônomo"

| Campo | Conteúdo |
|---|---|
| Fluxo e comportamento alvo | Prática → lista de sessões e histórico observado; Padrões → Prática técnica. Alvo: ver se a ajuda está virando dependência. |
| Mecanismo e evidência | A17 e L15: o ganho com ajuda não prevê o desempenho sem ajuda. A base pede para "registrar uso de pistas" junto do desempenho independente (A09). |
| Opção e comparador | No histórico: "pistas usadas: 0/1/2/3" por sessão ao lado de Entregue / Compreendido / Autônomo. Sem pontuação. Comparador: histórico atual. |
| Benefício, custo e dano | Torna visível o padrão "pistas sobem, autonomia não". Custo baixo (os dados já existem no Feedback). Dano: culpa por usar ajuda; o texto deve dizer que pista é parte do método. |
| Critério de decisão | Manter se em algum mês ajudar a decidir pedir menos pistas ou reconstruir mais; senão, esconder. |

## 4. Como testar no uso pessoal

O app já tem o mecanismo: **experimento da semana** + Padrões → experimentos anteriores (que mostram blocos começados / planejados por semana). Para cada proposta acima:

1. Defina antes o desfecho, a janela e o comparador (estão nas tabelas).
2. Marque semanas atípicas (ou anote, enquanto P3 não existir).
3. Olhe o resultado depois de retirar o apoio, quando fizer sentido (P2, P4, P5).
4. Abertura do app e quantidade de registros são métricas de processo, não de resultado (A15, A16).

Uma comparação pessoal sustenta decisões pessoais; não vira evidência geral (base, seção "Como comparar no uso pessoal").

## 5. Decisões que são suas

- **P1 (XP do sono):** tirar? A única que corrige uma contradição com a regra do próprio app.
- **P2, P3, P5:** quais implementar agora? São as de melhor relação evidência/custo depois de P1.
- **P4 (previsão antes de revelar):** vale o toque extra por card? Evidência mais fraca; sugiro só se você sentir que erra tópicos "que achava que sabia".
- **P6 e P7:** ajustes pequenos; posso fazer junto com qualquer uma das outras.
- **Gamificação:** manter XP, mapa e cores como gosto pessoal (minha recomendação) ou testar uma semana sem eles?

## 6. Lacunas que a base não resolve

- Qual barreira domina em cada tipo de tarefa sua (decidir, preparar, iniciar, persistir, voltar). Só o uso real responde; Padrões → Adiamentos é o lugar para observar.
- Quanto planejamento basta para um projeto longo como o Tech News (A04 tem confiança baixa para a cadência).
- Se a IA ajuda ou atrapalha a sua autonomia em programação: L15 é de matemática no ensino médio. P2 e P7 são o jeito de observar isso no seu caso.
- A base não pôde pesquisar Google Scholar, Semantic Scholar e PsycINFO; algumas fontes foram verificadas só pelo resumo (metodologia da base).
