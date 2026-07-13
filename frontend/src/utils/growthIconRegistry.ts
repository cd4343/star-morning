import type { LucideIcon } from 'lucide-react';
import {
  Activity, Badge, BadgeCheck, BedDouble, BookMarked, BookOpen, Building2, CalendarCheck,
  CalendarDays, Camera, Coins, Compass, Flag, Flame, Footprints,
  Goal, GraduationCap, HeartHandshake, HeartPulse, HelpingHand, Home, Image, Landmark,
  Leaf, Library, LifeBuoy, Lightbulb, ListChecks, Map, MapPin, Medal, Mic2, Microscope,
  Mountain, Music, Orbit, PackageCheck, Palette, Pencil, PiggyBank, Repeat2, Route,
  ShieldCheck, Sparkles, Sprout, Star, Trophy, Users, WalletCards, Wind, MessageCircle, Hand,
} from 'lucide-react';

export const GROWTH_ICON_REGISTRY: Readonly<Record<string, LucideIcon>> = Object.freeze({
  'task.first-step': Sprout, 'task.ten-steps': Footprints, 'task.fifty': Flag, 'task.hundred': Trophy, 'task.three-hundred': Route,
  'streak.three': CalendarCheck, 'streak.week': CalendarDays, 'streak.twenty-one': Sprout, 'streak.month': CalendarDays, 'streak.sixty': Flame, 'streak.hundred': Trophy,
  'life.first': Hand, 'life.ten': BedDouble, 'life.thirty': ListChecks, 'life.sixty': PackageCheck, 'life.hundred': Home,
  'life.streak-three': Home, 'life.streak-week': CalendarCheck, 'life.streak-twenty-one': Repeat2, 'life.independent': BadgeCheck, 'life.extra-step': Footprints,
  'study.first': BookOpen, 'study.ten': Pencil, 'study.thirty': BookMarked, 'study.sixty': Library, 'study.hundred': Lightbulb,
  'study.streak-three': BookOpen, 'study.streak-week': CalendarCheck, 'study.streak-twenty-one': Library, 'study.self-correct': Microscope, 'study.teach': GraduationCap,
  'sport.first': Footprints, 'sport.ten': Flame, 'sport.thirty': Medal, 'sport.sixty': HeartPulse, 'sport.hundred': Trophy,
  'sport.streak-three': Activity, 'sport.streak-week': CalendarCheck, 'sport.streak-twenty-one': HeartPulse, 'sport.finish': Flag,
  'activity.first': Lightbulb, 'activity.ten': Music, 'activity.thirty': Palette, 'activity.sixty': Image, 'activity.hundred': Sparkles,
  'activity.streak-week': CalendarCheck, 'activity.streak-twenty-one': Palette,
  'emotion.voice': MessageCircle, 'emotion.calm': Wind, 'emotion.help': LifeBuoy,
  'character.polite': MessageCircle, 'character.helpful': HelpingHand, 'character.honest': ShieldCheck,
  'family.helper': Home, 'family.cooperate': Users, 'family.promise': ShieldCheck,
  'saving.hundred': PiggyBank, 'saving.five-hundred': Coins, 'saving.thousand': Landmark, 'saving.three-thousand': ListChecks,
  'saving.five-thousand': WalletCards, 'saving.ten-thousand': Goal,
  'level.two': Sprout, 'level.five': Star, 'level.ten': Orbit, 'level.twenty': Sparkles, 'level.thirty': Compass,
  'growth.try-again': Repeat2,
  'explore.first': Compass, 'explore.five': MapPin, 'explore.ten': Route, 'explore.twenty-five': Footprints, 'explore.fifty': Map,
  'explore.museum-one': Building2, 'explore.museum-three': Landmark, 'explore.museum-five': Badge,
  'explore.nature-three': Leaf, 'explore.city-three': Map,
  'explore.science-one': Microscope, 'explore.science-three': Orbit, 'explore.travel-three': Route,
  'explore.voice-one': Mic2, 'explore.voice-five': MessageCircle, 'explore.photo-three': Camera, 'explore.photo-ten': Image,
  'explore.family-three': Users, 'explore.family-ten': Route, 'explore.all-types': Compass,
  'explore.plan-first': Map, 'explore.family-guide': Mic2, 'explore.public-good': HeartHandshake, 'explore.outdoor': Mountain,
});

export const getGrowthIconTone = (iconKey?: string | null) => {
  if (!iconKey) return 'bg-slate-50 text-slate-500 border-slate-100';
  if (iconKey.startsWith('life.')) return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  if (iconKey.startsWith('study.')) return 'bg-indigo-50 text-indigo-600 border-indigo-100';
  if (iconKey.startsWith('sport.')) return 'bg-orange-50 text-orange-600 border-orange-100';
  if (iconKey.startsWith('activity.')) return 'bg-pink-50 text-pink-600 border-pink-100';
  if (iconKey.startsWith('emotion.')) return 'bg-rose-50 text-rose-600 border-rose-100';
  if (iconKey.startsWith('character.')) return 'bg-teal-50 text-teal-600 border-teal-100';
  if (iconKey.startsWith('family.')) return 'bg-amber-50 text-amber-700 border-amber-100';
  if (iconKey.startsWith('saving.')) return 'bg-yellow-50 text-yellow-700 border-yellow-100';
  if (iconKey.startsWith('level.') || iconKey.startsWith('growth.')) return 'bg-violet-50 text-violet-600 border-violet-100';
  if (iconKey.startsWith('explore.')) return 'bg-cyan-50 text-cyan-700 border-cyan-100';
  if (iconKey.startsWith('streak.')) return 'bg-teal-50 text-teal-600 border-teal-100';
  return 'bg-sky-50 text-sky-600 border-sky-100';
};

const MILESTONE_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['ten-thousand', '1万'], ['five-thousand', '5千'], ['three-thousand', '3千'], ['three-hundred', '300'],
  ['five-hundred', '500'], ['twenty-five', '25'], ['twenty-one', '21'], ['hundred', '100'],
  ['fifty', '50'], ['thirty', '30'], ['sixty', '60'], ['ten', '10'], ['week', '7'], ['five', '5'], ['three', '3'], ['two', '2'], ['one', '1'], ['first', '1'],
];

export const getGrowthIconMilestone = (iconKey?: string | null) => {
  if (!iconKey) return null;
  return MILESTONE_LABELS.find(([token]) => iconKey.includes(token))?.[1] || null;
};

export const getGrowthIcon = (iconKey?: string | null) => (
  iconKey ? GROWTH_ICON_REGISTRY[iconKey] : undefined
);

export const GROWTH_ICON_COUNT = Object.keys(GROWTH_ICON_REGISTRY).length;
