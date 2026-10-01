import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UserProfile {
  weight: number;
  height: number;
  gender: 'pria' | 'wanita';
  idealWeight: number;
  bmi: number;
}

export type ActivityType = 'walk' | 'run' | 'bike';

export interface ActivityHistory {
  id: string;
  title: string;
  description: string;
  type: ActivityType;
  dateStr: string; // Format lengkap: "Senin, 7 Sep 2026 • 14:30"
  timestamp: number;
  durationSec: number;
  durationFormatted: string;
  distanceMeters: number;
  distanceDisplay: string; // "350 m" atau "1.25 km"
  paceFormatted: string;
  steps: number;
  calories: number;
  elevationGain: number;
  route: { latitude: number; longitude: number }[];
}

export interface DailyGoal {
  date: string;
  steps: number;
  targetSteps: number;
  waterMl: number;
  targetWaterMl: number;
  streak: number;
}

const PROFILE_KEY = '@app_profile';
const HISTORY_KEY = '@run_history';
const DAILY_KEY = '@app_daily_goal';

export const getProfile = async (): Promise<UserProfile | null> => {
  const data = await AsyncStorage.getItem(PROFILE_KEY);
  return data ? JSON.parse(data) : null;
};

export const saveProfile = async (profile: UserProfile) => {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

export const getHistory = async (): Promise<ActivityHistory[]> => {
  const data = await AsyncStorage.getItem(HISTORY_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveActivity = async (activity: ActivityHistory) => {
  const list = await getHistory();
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify([activity, ...list]));
};

export const getDailyStats = async (): Promise<DailyGoal> => {
  const today = new Date().toISOString().slice(0, 10);
  const data = await AsyncStorage.getItem(DAILY_KEY);
  if (data) {
    const parsed: DailyGoal = JSON.parse(data);
    if (parsed.date === today) return parsed;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextStreak = parsed.date === yesterday ? parsed.streak + 1 : 1;
    return { date: today, steps: 0, targetSteps: 10000, waterMl: 0, targetWaterMl: 2500, streak: nextStreak };
  }
  return { date: today, steps: 0, targetSteps: 10000, waterMl: 0, targetWaterMl: 2500, streak: 1 };
};

export const updateDailyStats = async (patch: Partial<DailyGoal>) => {
  const current = await getDailyStats();
  const updated = { ...current, ...patch };
  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(updated));
  return updated;
};