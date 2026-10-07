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
  dateStr: string;
  timestamp: number;
  durationSec: number;
  durationFormatted: string;
  distanceMeters: number;
  distanceDisplay: string;
  paceFormatted: string;
  avgSpeedKmh: number;
  steps: number;
  calories: number;
  elevationGain: number;
  route: { latitude: number; longitude: number }[];
}

export interface DailyGoal {
  date: string;
  steps: number;
  targetSteps: number;
  calories: number;
  targetCalories: number;
  activeMinutes: number;
  targetActiveMinutes: number;
  waterMl: number;
  targetWaterMl: number;
  streak: number;
  lastBaselineStep?: number;
}

const PROFILE_KEY = '@app_profile';
const HISTORY_KEY = '@run_history';
const DAILY_KEY = '@app_daily_goal';

export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const today = getTodayDateString();
  const data = await AsyncStorage.getItem(DAILY_KEY);

  if (data) {
    const parsed: DailyGoal = JSON.parse(data);
    // Jika tanggal masih sama dengan hari ini, gunakan datanya
    if (parsed.date === today) {
      return parsed;
    }

    // JIKA MELEWATI JAM 00:00 (Ganti Hari Baru) -> Reset ke 0
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const nextStreak = parsed.date === yesterdayStr && parsed.steps > 0 ? parsed.streak + 1 : 1;

    const resetDaily: DailyGoal = {
      date: today,
      steps: 0,
      targetSteps: parsed.targetSteps || 10000,
      calories: 0,
      targetCalories: parsed.targetCalories || 500,
      activeMinutes: 0,
      targetActiveMinutes: parsed.targetActiveMinutes || 45,
      waterMl: 0,
      targetWaterMl: parsed.targetWaterMl || 2500,
      streak: nextStreak,
    };

    await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(resetDaily));
    return resetDaily;
  }

  // Nilai default awal jika belum ada data sama sekali
  const initialDaily: DailyGoal = {
    date: today,
    steps: 0,
    targetSteps: 10000,
    calories: 0,
    targetCalories: 500,
    activeMinutes: 0,
    targetActiveMinutes: 45,
    waterMl: 0,
    targetWaterMl: 2500,
    streak: 1,
  };

  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(initialDaily));
  return initialDaily;
};

export const updateDailyStats = async (patch: Partial<DailyGoal>): Promise<DailyGoal> => {
  const current = await getDailyStats();
  const updatedSteps = patch.steps !== undefined ? patch.steps : current.steps;
  
  // Kalori harian dihitung otomatis dari langkah kaki (0.04 kcal / langkah) + kalori aktivitas jika dipatch
  const calculatedCal = patch.calories !== undefined 
    ? patch.calories 
    : Math.round(updatedSteps * 0.04);

  const updated: DailyGoal = {
    ...current,
    ...patch,
    steps: updatedSteps,
    calories: calculatedCal,
  };

  await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(updated));
  return updated;
};