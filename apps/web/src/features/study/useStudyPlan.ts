import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { StudyInput, StudyPlan } from '@life/shared';
import { studyPlan, studySettingsOf, weekdayOf } from '@life/shared';
import { useDayMode, useNow, useSettings, useToday } from '../../db/hooks';
import { readStudyData, type StudyData } from '../../db/studyData';

export interface StudyState { loaded: boolean; plan?: StudyPlan; input?: StudyInput; data?: StudyData; restDay: boolean }

/** Today's study plan, live (data changes) and on every clock tick (learning steps come due). */
export function useStudyPlan(): StudyState {
  const settings = useSettings();
  const today = useToday();
  const now = useNow();
  const mode = useDayMode();
  const loaded = useLiveQuery(async () => (today ? { today, data: await readStudyData(today) } : undefined), [today]);
  return useMemo(() => {
    if (!settings || !today || !loaded || loaded.today !== today) return { loaded: false, restDay: false };
    const study = studySettingsOf(settings);
    const input: StudyInput = {
      cards: loaded.data.cards, reviews: loaded.data.reviews, deckOrder: loaded.data.deckOrder,
      settings: study, mode, today, now, dayStartHour: settings.dayStartHour,
    };
    return { loaded: true, plan: studyPlan(input), input, data: loaded.data, restDay: study.restDays.includes(weekdayOf(today)) };
  }, [settings, today, loaded, mode, now]);
}
