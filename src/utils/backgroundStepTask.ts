import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { getDailyStats, updateDailyStats } from './storage';

export const BACKGROUND_STEP_TASK = 'BACKGROUND_STEP_TRACKER_TASK';

// Mendaftarkan task latar belakang
TaskManager.defineTask(BACKGROUND_STEP_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background task error:', error);
    return;
  }
  try {
    const isAvailable = await Pedometer.isAvailableAsync();
    if (isAvailable) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      const result = await Pedometer.getStepCountAsync(start, end);
      if (result) {
        await updateDailyStats({ steps: result.steps });
      }
    }
  } catch (e) {
    console.log('Background steps calculation failed', e);
  }
});

// Fungsi Permintaan Izin Latar Belakang Lengkap
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
        timeInterval: 15000,
        distanceInterval: 10,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'XoFit Sedang Aktif',
          notificationBody: 'Melacak langkah harian dan progres kebugaran di latar belakang.',
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