import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const TRACKER_LOCATION_TASK = 'TRACKER_LOCATION_BACKGROUND_TASK';
export const TRACKER_STATE_KEY = '@tracker_live_state';

interface LiveTrackerState {
  isTracking: boolean;
  isPaused: boolean;
  mode: 'walk' | 'run' | 'bike';
  seconds: number;
  distanceMeters: number;
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

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatPace = (distanceMeters: number, seconds: number) => {
  if (distanceMeters < 5 || seconds < 2) return "--'--\"";
  const paceSec = (seconds / distanceMeters) * 1000;
  if (paceSec > 2400) return "--'--\"";
  const m = Math.floor(paceSec / 60);
  const s = Math.floor(paceSec % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
};

TaskManager.defineTask(TRACKER_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;

  const rawState = await AsyncStorage.getItem(TRACKER_STATE_KEY);
  if (!rawState) return;

  const state: LiveTrackerState = JSON.parse(rawState);
  if (!state.isTracking || state.isPaused) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  let updatedDist = state.distanceMeters;
  let updatedElev = state.elevationGain;
  let lastAlt = state.lastAltitude;
  let lastPoint = state.lastCoord;
  const route = [...state.route];

  for (const loc of locations) {
    const coords = loc.coords;
    const acc = coords.accuracy ?? 99;
    const speed = coords.speed ?? 0;

    // Filter 1: Buang sinyal tidak akurat
    if (acc > 16) continue;

    // Filter 2 (Anti Diam): Cek ambang batas kecepatan minimum
    const minSpeedThreshold = state.mode === 'bike' ? 0.9 : 0.6;
    if (speed < minSpeedThreshold && acc > 8) {
      continue;
    }

    const currentPoint = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude,
    };

    if (lastPoint) {
      const dist = calculateDistanceMeters(lastPoint, currentPoint);

      // Filter 3 (Jarak Ambang): Cegah drift mikro saat berhenti/berdiri
      const minStepDist = state.mode === 'bike' ? 3.5 : 2.5;
      if (dist >= minStepDist) {
        // Validasi kecepatan fisik realistis
        const impliedSpeed = dist / 1.0;
        const maxRealSpeed = state.mode === 'bike' ? 22 : 12; // 22 m/s (~80km/h), 12 m/s (~43km/h)
        if (impliedSpeed > maxRealSpeed) continue;

        updatedDist += dist;
        lastPoint = currentPoint;
        route.push(currentPoint);

        // Filter 4: Kenaikan elevasi dengan smoothing threshold
        if (coords.altitude != null) {
          if (lastAlt == null) {
            lastAlt = coords.altitude;
          } else {
            const diffElev = coords.altitude - lastAlt;
            // Hanya akumulasikan tanjakan nyata (minimal naik 1.8 meter bertahap dan wajar < 15m)
            if (diffElev >= 1.8 && diffElev < 15) {
              updatedElev += Math.round(diffElev);
              lastAlt = coords.altitude;
            } else if (diffElev <= -1.8) {
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
    distanceMeters: updatedDist,
    elevationGain: updatedElev,
    lastAltitude: lastAlt,
    lastCoord: lastPoint,
    route,
  };

  await AsyncStorage.setItem(TRACKER_STATE_KEY, JSON.stringify(newState));
});