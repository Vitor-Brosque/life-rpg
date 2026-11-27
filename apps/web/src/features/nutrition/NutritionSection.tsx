import { Link } from 'wouter';
import { daySummaryText, estimateText } from '@life/shared';
import { useNutritionDay } from '../../db/nutritionData';
import { useToday } from '../../db/hooks';
import './nutrition.css';

/** Corpo → "Nutrição": today's summary (or "Definir metas" without a target) and "Abrir nutrição" (spec §6). No XP. */
export function NutritionSection() {
  const today = useToday();
  const day = useNutritionDay(today);
  const estimate = day?.estimate ? ` · ${estimateText(true)}` : '';
  return (
    <section className="stack" aria-labelledby="nutricao-title">
      <h2 id="nutricao-title" className="section-title">Nutrição</h2>
      {day && (day.target ? (
        <p className="nutri-summary">{`${daySummaryText(day)}${estimate}`}</p>
      ) : (
        <>
          {day.eaten.grams > 0 && <p className="nutri-summary">{`${daySummaryText(day)}${estimate}`}</p>}
          <p className="muted">Com as metas de proteína, carboidratos e gorduras, aqui aparece quanto já foi comido de cada uma.</p>
          <div><Link href="/corpo/nutricao/metas" className="btn btn--secondary btn--md">Definir metas</Link></div>
        </>
      ))}
      <div><Link href="/corpo/nutricao" className="body-card__link">Abrir nutrição</Link></div>
    </section>
  );
}
