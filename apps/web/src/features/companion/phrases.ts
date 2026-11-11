// What the companion says, by moment. Tone: warm, supports autonomy, never guilt (§11).
// Placeholders: {name} (only as ", {name}" so it can be dropped when there is no name)
// and {companion}.

export type PhraseCategory =
  | 'greetMorning' | 'greetAfternoon' | 'greetNight' | 'start' | 'complete' | 'shrink' | 'snooze'
  | 'postponed' | 'hardDay' | 'focusDone' | 'levelUp' | 'empty' | 'review' | 'drop';

export const PHRASES: Record<PhraseCategory, string[]> = {
  greetMorning: [
    'Bom dia, {name}! Que tal um passo pequeno para acender o dia?',
    'Bom dia! A lanterna já está acesa. Por onde quer começar?',
    'Manhã nova, chama nova. Escolha uma coisa e eu te acompanho.',
    'Bom dia, {name}. Sem pressa: um passo de cada vez.',
    'Acordei faiscando! Quer ver o que cabe agora?',
  ],
  greetAfternoon: [
    'Boa tarde, {name}! Ainda dá tempo para uma coisa boa hoje.',
    'Boa tarde! Quer escolher o próximo passo comigo?',
    'A tarde chegou. Uma missão curta pode ser um bom recomeço.',
    'Boa tarde, {name}. O que parece leve o bastante para agora?',
    'Oi de novo! A chama segue acesa por aqui.',
  ],
  greetNight: [
    'Boa noite, {name}. Se quiser, algo leve — ou descanso, que também conta.',
    'A taverna está quieta. Quer fechar o dia com um passo pequeno?',
    'Boa noite! Descansar também faz parte da jornada.',
    'A noite chegou. Que tal deixar o amanhã um pouco mais claro?',
    'Boa noite, {name}. O que foi feito hoje já está guardado.',
  ],
  start: [
    'Começou! A parte mais difícil já passou.',
    'Isso! Só o primeiro passo; o resto vem depois.',
    'Chama acesa. Estou aqui do lado.',
    'Bom começo, {name}. Vai no seu ritmo.',
    'Uma faísca basta para começar. Bora!',
  ],
  complete: [
    'Feito! Cada passo conta.',
    'Mais uma luz acesa no caminho, {name}!',
    'Missão cumprida. Quer respirar um pouco antes da próxima?',
    'Boa! Sua chama ficou mais forte.',
    'Concluído. Você escolheu e fez — isso é seu.',
  ],
  shrink: [
    'Menor é ótimo. Cinco minutos já movem as coisas.',
    'Boa estratégia! Passo pequeno também é passo.',
    'Assim fica mais leve, né? Quando quiser, é só começar.',
    'Versão mini guardada. Às vezes é só disso que a gente precisa.',
  ],
  snooze: [
    'Tudo bem, ela espera. Você decide o momento.',
    'Guardei para depois. Agora é outra coisa.',
    'Combinado. Não é agora, e está tudo certo.',
    'Deixei de lado por enquanto. Sem problema nenhum.',
  ],
  postponed: [
    'Essa voltou algumas vezes. Quer deixar menor?',
    'Talvez ela precise de outro formato. Encolher, dividir ou soltar?',
    'Parece que essa pesa. Que tal uma versão de 5 minutos?',
    'Soltar também é uma escolha válida. O que faz sentido para você?',
  ],
  hardDay: [
    'Dia pesado? Vamos só no essencial, sem cobrança.',
    'Estou aqui. Hoje, qualquer passo pequeno já vale muito.',
    'Tudo bem ir devagar. Deixei à mostra só o leve e o importante.',
    'Dias assim acontecem. Cuide de você primeiro, {name}.',
  ],
  focusDone: [
    'Foco concluído! Que tal uma pausa?',
    'Tempo de foco cumprido. Respira, alonga, bebe uma água.',
    'Bela sessão, {name}! Sua chama agradece.',
    'Fim do bloco de foco. Você decide o que vem agora.',
  ],
  levelUp: [
    'Subiu de nível! Olha só essa chama crescendo.',
    'Novo nível, {name}! Esforço que vira história.',
    'Nível novo! Cada passo trouxe você até aqui.',
    'Subiu! Estou faiscando de orgulho.',
  ],
  empty: [
    'Nada pendente. Capture algo com +, ou descanse.',
    'Lista vazia. Descanso também conta.',
    'Tudo em dia por aqui. Quer anotar alguma ideia?',
    'Silêncio na taverna. Aproveite — ou capture o que vier à cabeça.',
  ],
  review: [
    'Algumas missões ficaram para trás. Quer dar uma olhada rápida?',
    'Revisão rápida: hoje, outro dia ou soltar — você escolhe.',
    'Bora reorganizar? Leva só um minutinho.',
    'Planos mudam. Vamos ajustar o que ficou pelo caminho?',
  ],
  drop: [
    'Soltou. Às vezes é a melhor escolha.',
    'Menos peso na mochila. Bom para seguir viagem.',
    'Tudo bem deixar ir. Sobra espaço para o que importa.',
    'Missão solta, sem culpa. Você decidiu.',
  ],
};

export interface PhraseVars { name?: string; companion?: string }

export function renderPhrase(template: string, vars: PhraseVars): string {
  const name = vars.name?.trim();
  const withName = name ? template.replaceAll('{name}', name) : template.replace(/,\s*\{name\}/g, '').replaceAll('{name}', '');
  return withName.replaceAll('{companion}', vars.companion?.trim() || 'Faísca');
}

/** Random phrase of a category, never equal to `last` when there is an alternative. */
export function pickPhrase(cat: PhraseCategory, last: string | undefined, vars: PhraseVars, rnd: () => number = Math.random): string {
  const all = PHRASES[cat].map((p) => renderPhrase(p, vars));
  const fresh = all.filter((p) => p !== last);
  const pool = fresh.length > 0 ? fresh : all;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rnd() * pool.length)));
  return pool[i]!;
}
