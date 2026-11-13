import { useState } from 'react';
import { Link } from 'wouter';
import type { XpReason } from '@life/shared';
import { titleForLevel } from '@life/shared';
import { Avatar } from '../../art/Avatar';
import { areaIcon, Icon } from '../../art/icons';
import { useCharacterStats, useNow, useProfile } from '../../db/hooks';
import { Button } from '../../ui/Button';
import { relativeTime } from '../../ui/format';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { WeekDots, workdaysText } from '../../ui/WeekDots';
import { BodyCard } from '../corpo/BodyCard';
import { LookEditor } from './LookEditor';
import './character.css';

export const XP_REASON_LABEL: Record<XpReason, string> = {
  complete: 'Missão concluída',
  start: 'Coragem para começar',
  strategy: 'Estratégia',
  focus: 'Foco',
  review: 'Revisão rápida',
  journey: 'Jornada concluída',
  resilience: 'Resistência',
  block: 'Bloco iniciado',
  resumption: 'Retomada',
  checkin: 'Card de início',
  objective: 'Objetivo da semana',
  study: 'Revisão espaçada',
  practice: 'Prática técnica',
  sleep: 'Noite registrada',
  mealprep: 'Preparo em lote',
  workout: 'Treino',
};

const xpLabel = (into: number, needed: number) => `${into} / ${needed} XP`;

/**
 * "Personagem" (§11): avatar, level and title, one attribute per life area, constancy in workdays
 * without streaks (a day off never resets anything, free days are not counted) and the latest XP earned.
 */
export function CharacterScreen() {
  const profile = useProfile();
  const stats = useCharacterStats();
  const now = useNow();
  const [editing, setEditing] = useState(false);

  return (
    <section className="screen character stack" aria-labelledby="character-title">
      <div className="character__top">
        <h1 id="character-title">Personagem</h1>
        <Link href="/ajustes" className="btn btn--ghost btn--md btn--icon-only" aria-label="Ajustes">
          <Icon name="gear" size={24} />
        </Link>
      </div>

      <Panel className="character__card" role="region" aria-label="Ficha do personagem">
        {/* Nothing drawn until the profile is read, so the default look never flashes. */}
        <div className="character__pedestal" aria-hidden="true">
          {profile ? <Avatar look={profile.look} scale={6} /> : <span className="character__avatar-slot" />}
        </div>
        <div className="character__identity">
          <h2 className="character__name">{profile ? profile.name || 'Aventureiro' : ' '}</h2>
          {stats && (
            <>
              <p className="character__rank">
                <span className="character__title">{titleForLevel(stats.total.level)}</span>
                <span className="character__level">Nv {stats.total.level}</span>
              </p>
              <ProgressBar value={stats.total.into} max={stats.total.needed} label={xpLabel(stats.total.into, stats.total.needed)} />
            </>
          )}
          <Button size="sm" icon="character" className="character__edit" onClick={() => setEditing(true)}>Editar aparência</Button>
        </div>
      </Panel>

      <section aria-labelledby="attributes-title">
        <h2 id="attributes-title" className="section-title">Atributos</h2>
        <ul className="attributes" aria-label="Atributos">
          {stats?.byArea.map(({ area, info }) => (
            <li key={area.id} className="attribute px-border" style={{ ['--area-color' as string]: area.color }}>
              <span className="attribute__icon" aria-hidden="true"><Icon name={areaIcon(area.icon)} size={24} /></span>
              <span className="attribute__text">
                <span className="attribute__name">{area.attribute}</span>
                <span className="attribute__area">{area.name}</span>
              </span>
              <span className="attribute__level">Nv {info.level}</span>
              <span className="attribute__bar">
                <ProgressBar value={info.into} max={info.needed} color={area.color} label={xpLabel(info.into, info.needed)} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Panel variant="stone" className="constancy" aria-labelledby="constancy-title" role="region">
        <h2 id="constancy-title" className="section-title">Constância</h2>
        {stats && (
          <>
            <WeekDots week={stats.weekWorkdays} />
            <p className="constancy__count">{workdaysText(stats.weekWorkdays)}</p>
            <p className="constancy__month">{`${workdaysText(stats.monthWorkdays)} nos últimos 30`}</p>
          </>
        )}
        <p className="constancy__note">Dias livres não entram na conta. Um dia parado não apaga nada.</p>
      </Panel>

      <BodyCard />

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className="section-title">Conquistas recentes</h2>
        {stats && stats.recent.length === 0 ? (
          <Panel variant="stone"><p className="muted">Ainda nada por aqui. Começar uma missão já conta.</p></Panel>
        ) : (
          <ul className="recent" aria-label="Conquistas recentes">
            {stats?.recent.map((x) => (
              <li key={x.id} className="recent__item">
                <span className="recent__label">{XP_REASON_LABEL[x.reason] ?? x.reason}</span>
                <span className="recent__xp">+{x.amount} XP</span>
                <span className="recent__when">{relativeTime(x.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LookEditor open={editing} onClose={() => setEditing(false)} />
    </section>
  );
}
