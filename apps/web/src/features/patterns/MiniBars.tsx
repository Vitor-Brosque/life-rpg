export interface MiniBarsProps {
  /** One value per period; undefined = no value (no bar, a dash). */
  values: Array<number | undefined>;
  /** Drawn behind each bar (e.g. planned blocks). */
  background?: number[];
  labels: string[];
}

/** Small decorative bar chart (CSS only); the card's sentence and screen-reader list carry the data. */
export function MiniBars({ values, background, labels }: MiniBarsProps) {
  const top = Math.max(1, ...values.map((v) => v ?? 0), ...(background ?? []));
  const pctOf = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="minibars" aria-hidden="true">
      {values.map((v, i) => (
        <div key={labels[i] ?? i} className="minibars__col">
          <div className="minibars__track">
            {background && <span className="minibars__bg" style={{ height: pctOf(background[i] ?? 0) }} />}
            {v === undefined ? <span className="minibars__none">–</span>
              : v <= 0 ? <span className="minibars__zero" />
                : <span className="minibars__bar" style={{ height: `max(2px, ${pctOf(v)})` }} />}
          </div>
          <span className="minibars__label">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
