import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { updateDailyStats, getDailyStats, getTodayDateString } from './storage';

export const BACKGROUND_STEP_TASK = 'BACKGROUND_STEP_TRACKER_TASK';

TaskManager.defineTask(BACKGROUND_STEP_TASK, async ({ error }) => {
  if (error) {
    console.error('Background step task error:', error);
    return;
  }

  try {
    const isAvailable = await Pedometer.isAvailableAsync();
    if (!isAvailable) return;

    // Reset otomatis jika sudah melewati jam 00:00 tengah malam
    const daily = await getDailyStats();
    const today = getTodayDateString();

    if (daily.date !== today) {
      // getDailyStats() sudah menangani reset ke 0 jika tanggal berganti
      return;
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const end = new Date();

    // Di Android & iOS, minta hitungan langkah dari sensor hardware sejak jam 00:00 hari ini
    const result = await Pedometer.getStepCountAsync(startOfDay, end).catch(() => null);
    if (result && typeof result.steps === 'number') {
      const stepVal = Math.max(0, result.steps);
      await updateDailyStats({
        steps: stepVal,
        calories: Math.round(stepVal * 0.04),
      });
    }
  } catch (e) {
    console.log('Background steps tracking loop error:', e);
  }
});

export const requestBackgroundStepPermissions = async (): Promise<boolean> => {
  try {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') return false;

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') return false;

    const pedometerPermission = await Pedometer.requestPermissionsAsync();
    if (!pedometerPermission.granted) return false;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_STEP_TASK);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_STEP_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20000, // Sync periodik tiap 20 detik
        distanceInterval: 15,
        showsBackgroundLocationIndicator: false,
        foregroundService: {
          notificationTitle: 'XoFit Sedang Aktif',
          notificationBody: 'Melacak target langkah kaki dan kalori harian Anda.',
          notificationColor: '#ea580c',
        },
      });
    }
    return true;
  } catch (err) {
    console.log('Permission request error:', err);
    return false;
  }
};