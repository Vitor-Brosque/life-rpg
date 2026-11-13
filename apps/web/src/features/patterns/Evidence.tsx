import type { ReactNode } from 'react';

export type EvidenceKind = 'observado' | 'hipotese' | 'experimento';
const LABEL: Record<EvidenceKind, string> = { observado: 'Observado', hipotese: 'Hipótese', experimento: 'Experimento sugerido' };

/** The fixed label before every reading (spec §5): the word is always written; colour only reinforces it. */
export function Evidence({ kind }: { kind: EvidenceKind }) {
  return <span className={`evidence evidence--${kind}`}>{LABEL[kind]}<span className="visually-hidden">:</span></span>;
}

/** A paragraph that starts with its label; `children` is the sentence. */
export function EvidenceLine({ kind, children }: { kind: EvidenceKind; children: ReactNode }) {
  return <p className="evidence-line"><Evidence kind={kind} />{' '}{children}</p>;
}
