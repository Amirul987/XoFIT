import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const TRACKER_LOCATION_TASK = 'TRACKER_LOCATION_BACKGROUND_TASK';
export const TRACKER_STATE_KEY = '@tracker_live_state';

export interface LiveTrackerState {
  isTracking: boolean;
  isPaused: boolean;
  mode: 'walk' | 'run' | 'bike';
  startTime: number;
  totalPausedMs: number;
  pauseStartedAt: number | null;
  seconds: number;
  distanceMeters: number;
  stepCount: number;
  elevationGain: number;
  lastAltitude: number | null;
  lastCoord: { latitude: number; longitude: number } | null;
  route: { latitude: number; longitude: number; altitude?: number | null }[];
}

const calculateDistanceMeters = (
  c1: { latitude: number; longitude: number },
  c2: { latitude: number; longitude: number }
): number => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(c2.latitude - c1.latitude);
  const dLon = toRad(c2.longitude - c1.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(c1.latitude)) * Math.cos(toRad(c2.latitude)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

TaskManager.defineTask(TRACKER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;

  const rawState = await AsyncStorage.getItem(TRACKER_STATE_KEY);
  if (!rawState) return;

  const state: LiveTrackerState = JSON.parse(rawState);
  if (!state.isTracking || state.isPaused) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const now = Date.now();
  const currentElapsedSec = Math.max(0, Math.floor((now - state.startTime - (state.totalPausedMs || 0)) / 1000));

  let updatedDist = Number(state.distanceMeters) || 0;
  let updatedElev = Number(state.elevationGain) || 0;
  let lastAlt = state.lastAltitude;
  let lastPoint = state.lastCoord;
  const route = Array.isArray(state.route) ? [...state.route] : [];

  for (const loc of locations) {
    const coords = loc.coords;
    const acc = coords.accuracy ?? 99;
    const speed = coords.speed ?? 0;

    if (acc > 14) continue;

    const minSpeedThreshold = state.mode === 'bike' ? 0.8 : 0.45;
    if (speed < minSpeedThreshold && acc > 6) {
      continue;
    }

    const currentPoint = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude,
    };

    if (lastPoint) {
      const dist = calculateDistanceMeters(lastPoint, currentPoint);
      const minStepDist = state.mode === 'bike' ? 3.5 : 2.0;

      if (dist >= minStepDist) {
        const maxRealSpeed = state.mode === 'bike' ? 24 : 12;
        if (dist > maxRealSpeed * 5) continue;

        updatedDist += dist;
        lastPoint = currentPoint;
        route.push(currentPoint);

        if (coords.altitude != null) {
          if (lastAlt == null) {
            lastAlt = coords.altitude;
          } else {
            const diffElev = coords.altitude - lastAlt;
            if (diffElev >= 1.5 && diffElev < 15) {
              updatedElev += Math.round(diffElev);
              lastAlt = coords.altitude;
            } else if (diffElev <= -1.5) {
              lastAlt = coords.altitude;
            }
          }
        }
      }
    } else {
      lastPoint = currentPoint;
      lastAlt = coords.altitude ?? null;
      route.push(currentPoint);
    }
  }

  const newState: LiveTrackerState = {
    ...state,
    seconds: currentElapsedSec,
    distanceMeters: Math.round(updatedDist * 100) / 100,
    elevationGain: updatedElev,
    lastAltitude: lastAlt,
    lastCoord: lastPoint,
    route,
  };

  await AsyncStorage.setItem(TRACKER_STATE_KEY, JSON.stringify(newState));
});