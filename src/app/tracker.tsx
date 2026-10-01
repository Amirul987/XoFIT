import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  PermissionsAndroid,
  Platform,
  BackHandler,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import { saveActivity, getProfile, ActivityType } from '../utils/storage';
import NotificationModal from '../components/NotificationModal';

interface Coordinate {
  latitude: number;
  longitude: number;
  altitude?: number | null;
}

const calculateDistanceMeters = (coord1: Coordinate, coord2: Coordinate): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(coord2.latitude - coord1.latitude);
  const dLon = toRad(coord2.longitude - coord1.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.latitude)) * Math.cos(toRad(coord2.latitude)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const generateLeafletHtml = (lat: number, lng: number, isDark: boolean) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: ${isDark ? '#090d16' : '#e2e8f0'}; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    var marker = L.circleMarker([${lat}, ${lng}], {
      radius: 8,
      fillColor: '#38bdf8',
      color: '#ffffff',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(map);

    var polyline = L.polyline([], { color: '#ea580c', weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map);

    window.updateInitialPosition = function(lat, lng) {
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], 16);
      map.invalidateSize();
    };

    window.updateTrackingPosition = function(lat, lng) {
      marker.setLatLng([lat, lng]);
      polyline.addLatLng([lat, lng]);
      map.panTo([lat, lng]);
    };
  </script>
</body>
</html>
`;

export default function TrackerScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const webViewRef = useRef<WebView>(null);

  const [mode, setMode] = useState<ActivityType>('walk');
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [elevationGain, setElevationGain] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [currentSpeedMs, setCurrentSpeedMs] = useState<number>(0);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [userWeight, setUserWeight] = useState(65);

  const [targetDistanceKm, setTargetDistanceKm] = useState<number | null>(null);
  const [targetPaceSec, setTargetPaceSec] = useState<number | null>(null);
  const [showTargetSetupModal, setShowTargetSetupModal] = useState(false);
  const [targetDistInput, setTargetDistInput] = useState('');

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDesc, setActivityDesc] = useState('');

  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    type?: 'success' | 'warning' | 'danger' | 'info';
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [currentCoord, setCurrentCoord] = useState<Coordinate>({
    latitude: -6.175392,
    longitude: 106.827153,
  });

  const timerRef = useRef<any>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const accelSub = useRef<any>(null);
  const lastAccelMag = useRef(0);
  const lastStepTime = useRef(0);
  const currentSpeedRef = useRef(0);
  const isActuallyWalkingRef = useRef(false);

  // Pencarian GPS Instan Cepat (Memanfaatkan Cache LastKnown Terlebih Dahulu)
  useEffect(() => {
    (async () => {
      const p = await getProfile();
      if (p) setUserWeight(p.weight);

      if (Platform.OS === 'android' && Platform.Version >= 29) {
        try {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
        } catch (e) {}
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        try {
          // 1. Ambil lokasi terakhir dari cache sistem (Instan < 50ms)
          const lastLoc = await Location.getLastKnownPositionAsync();
          if (lastLoc) {
            const pos = { latitude: lastLoc.coords.latitude, longitude: lastLoc.coords.longitude };
            setCurrentCoord(pos);
            setGpsAccuracy(lastLoc.coords.accuracy || 12);
            if (webViewRef.current) {
              webViewRef.current.injectJavaScript(`if (window.updateInitialPosition) { window.updateInitialPosition(${pos.latitude}, ${pos.longitude}); } true;`);
            }
          }

          // 2. Ambil koordinat GPS akurat terkini
          const currentLoc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const exactPos = { latitude: currentLoc.coords.latitude, longitude: currentLoc.coords.longitude };
          setCurrentCoord(exactPos);
          setGpsAccuracy(currentLoc.coords.accuracy || 8);
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`if (window.updateInitialPosition) { window.updateInitialPosition(${exactPos.latitude}, ${exactPos.longitude}); } true;`);
          }
        } catch (e) {
          console.log('GPS quick lock timeout', e);
        }
      }
    })();

    return () => cleanupTracker();
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (isTracking) {
        handleBackPress();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [isTracking]);

  const theme = {
    bg: isDark ? '#090d16' : '#f8fafc',
    card: isDark ? '#131c2e' : '#ffffff',
    border: isDark ? '#1e293b' : '#e2e8f0',
    textMain: isDark ? '#ffffff' : '#0f172a',
    textMuted: isDark ? '#94a3b8' : '#64748b',
    subCard: isDark ? '#090d16' : '#f1f5f9',
    overlayBg: isDark ? 'rgba(9, 13, 22, 0.94)' : 'rgba(255, 255, 255, 0.95)',
  };

  const cleanupTracker = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (locationSub.current) locationSub.current.remove();
    if (accelSub.current) accelSub.current.remove();
  };

  const handleBackPress = () => {
    if (isTracking) {
      setModalConfig({
        visible: true,
        type: 'warning',
        title: 'Keluar dari Latihan?',
        message: 'Aktivitas sedang berjalan. Keluar sekarang akan membatalkan seluruh data sesi ini.',
        confirmText: 'Keluar & Batal',
        cancelText: 'Lanjut Latihan',
        onConfirm: () => {
          cleanupTracker();
          setIsTracking(false);
          setModalConfig(prev => ({ ...prev, visible: false }));
          router.back();
        },
      });
    } else {
      router.back();
    }
  };

  const startTracking = async () => {
    setIsTracking(true);
    setIsPaused(false);
    setSeconds(0);
    setStepCount(0);
    setDistanceMeters(0);
    setElevationGain(0);
    setRouteCoordinates([]);
    currentSpeedRef.current = 0;
    isActuallyWalkingRef.current = false;

    timerRef.current = setInterval(() => {
      setSeconds(prev => prev + 1);
    }, 1000);

    if (mode === 'walk') {
      Accelerometer.setUpdateInterval(120);
      accelSub.current = Accelerometer.addListener(data => {
        const mag = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
        const delta = Math.abs(mag - lastAccelMag.current);
        const now = Date.now();

        const isPhysicallyMoving = isActuallyWalkingRef.current || currentSpeedRef.current >= 0.45;

        if (isPhysicallyMoving && delta > 0.42 && now - lastStepTime.current > 280) {
          setStepCount(prev => prev + 1);
          lastStepTime.current = now;
        }
        lastAccelMag.current = mag;
      });
    }

    locationSub.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1.2,
      },
      loc => {
        const acc = loc.coords.accuracy || 99;
        const spd = loc.coords.speed || 0;

        setGpsAccuracy(acc);
        const validSpeed = spd > 0.3 ? spd : 0;
        setCurrentSpeedMs(validSpeed);
        currentSpeedRef.current = validSpeed;

        if (acc > 25) return;

        const newPoint: Coordinate = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          altitude: loc.coords.altitude,
        };

        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`if (window.updateTrackingPosition) { window.updateTrackingPosition(${newPoint.latitude}, ${newPoint.longitude}); } true;`);
        }

        setRouteCoordinates(prev => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            const addedMeters = calculateDistanceMeters(last, newPoint);

            if (addedMeters >= 1.6) {
              isActuallyWalkingRef.current = true;
              setDistanceMeters(curr => curr + addedMeters);

              if (last.altitude != null && newPoint.altitude != null) {
                const diff = newPoint.altitude - last.altitude;
                if (diff > 0.5 && diff < 30) {
                  setElevationGain(curr => Math.round(curr + diff));
                }
              }
              return [...prev, newPoint];
            } else {
              isActuallyWalkingRef.current = false;
            }
            return prev;
          }
          return [newPoint];
        });
      }
    );
  };

  const togglePause = () => {
    if (isPaused) {
      setIsPaused(false);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } else {
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleFinish = () => {
    cleanupTracker();
    setIsTracking(false);
    setIsPaused(false);

    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? 'Pagi' : hour < 15 ? 'Siang' : hour < 18 ? 'Sore' : 'Malam';
    const modeName = mode === 'walk' ? 'Jalan Santai' : mode === 'run' ? 'Lari' : 'Gowes Sepeda';
    setActivityTitle(`${modeName} ${timeGreeting}`);
    setActivityDesc('');
    setShowSaveModal(true);
  };

  const handleSaveActivity = async () => {
    const durationHours = seconds / 3600;
    const met = mode === 'walk' ? 3.8 : mode === 'run' ? 8.0 : 6.8;
    const calories = Math.round(met * userWeight * durationHours);

    const now = new Date();
    const fullDateStr = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const record = {
      id: Date.now().toString(),
      title: activityTitle.trim() || 'Aktivitas Saya',
      description: activityDesc.trim(),
      type: mode,
      dateStr: fullDateStr,
      timestamp: now.getTime(),
      durationSec: seconds,
      durationFormatted: formatTime(seconds),
      distanceMeters,
      distanceDisplay: getFormattedDistance(distanceMeters),
      paceFormatted: calculateInstantPace(),
      steps: mode === 'walk' ? stepCount : 0,
      calories,
      elevationGain,
      route: routeCoordinates,
    };

    await saveActivity(record);
    setShowSaveModal(false);

    setModalConfig({
      visible: true,
      type: 'success',
      title: 'Berhasil Disimpan!',
      message: 'Sesi latihan telah tercatat di profil & riwayat kamu.',
      confirmText: 'Kembali',
      onConfirm: () => {
        setModalConfig(prev => ({ ...prev, visible: false }));
        router.replace('/');
      },
    });
  };

  const getFormattedDistance = (meters: number) => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getPaceInSeconds = () => {
    if (currentSpeedMs > 0.3) return 1000 / currentSpeedMs;
    if (distanceMeters >= 2 && seconds >= 1) return (seconds / distanceMeters) * 1000;
    return null;
  };

  const calculateInstantPace = () => {
    const paceSec = getPaceInSeconds();
    if (!paceSec || paceSec > 2400) return '--:--';
    const m = Math.floor(paceSec / 60);
    const s = Math.floor(paceSec % 60);
    return `${m}'${String(s).padStart(2, '0')}"`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color="#38bdf8" />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {!isTracking && (
            <TouchableOpacity
              style={[
                styles.targetToggleBtn,
                { borderColor: '#38bdf8', backgroundColor: theme.card },
                (targetDistanceKm || targetPaceSec) && styles.targetToggleActive,
              ]}
              onPress={() => setShowTargetSetupModal(true)}
            >
              <Ionicons
                name="flag"
                size={14}
                color={targetDistanceKm || targetPaceSec ? '#ffffff' : '#38bdf8'}
              />
              <Text
                style={[
                  styles.targetToggleText,
                  (targetDistanceKm || targetPaceSec) && { color: '#ffffff' },
                ]}
              >
                {targetDistanceKm ? `${targetDistanceKm} km` : 'Target'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={[styles.gpsBadge, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.gpsDot, { backgroundColor: gpsAccuracy && gpsAccuracy <= 15 ? '#22c55e' : '#f59e0b' }]} />
            <Text style={[styles.gpsText, { color: gpsAccuracy && gpsAccuracy <= 15 ? '#22c55e' : '#f59e0b' }]}>
              {gpsAccuracy && gpsAccuracy <= 15 ? 'GPS Siap' : 'Mencari GPS...'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.mapArea}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: generateLeafletHtml(currentCoord.latitude, currentCoord.longitude, isDark) }}
          style={styles.map}
          scrollEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />

        <View style={[styles.overlayCard, { backgroundColor: theme.overlayBg, borderColor: theme.border }]}>
          {mode === 'walk' && (
            <>
              <View style={styles.overlayRow}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>JARAK</Text>
                  <Text style={[styles.metricBig, { color: theme.textMain }]}>
                    {getFormattedDistance(distanceMeters).split(' ')[0]}{' '}
                    <Text style={styles.metricUnit}>{getFormattedDistance(distanceMeters).split(' ')[1]}</Text>
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>LANGKAH</Text>
                  <Text style={[styles.metricBig, { color: '#38bdf8' }]}>{stepCount}</Text>
                </View>
              </View>
              <View style={[styles.overlayRow, { marginTop: 6 }]}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>WAKTU</Text>
                  <Text style={styles.metricSub}>{formatTime(seconds)}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>PACE</Text>
                  <Text style={styles.metricSub}>{calculateInstantPace()}</Text>
                </View>
              </View>
            </>
          )}

          {mode === 'run' && (
            <>
              <View style={styles.overlayRow}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>JARAK</Text>
                  <Text style={[styles.metricBig, { color: theme.textMain }]}>
                    {getFormattedDistance(distanceMeters).split(' ')[0]}{' '}
                    <Text style={styles.metricUnit}>{getFormattedDistance(distanceMeters).split(' ')[1]}</Text>
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>PACE</Text>
                  <Text style={[styles.metricBig, { color: theme.textMain }]}>
                    {calculateInstantPace()} <Text style={styles.metricUnit}>/km</Text>
                  </Text>
                </View>
              </View>
              <View style={[styles.overlayRow, { marginTop: 6 }]}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>WAKTU</Text>
                  <Text style={styles.metricSub}>{formatTime(seconds)}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                  <Text style={[styles.metricSub, { color: '#34d399' }]}>+{elevationGain} m</Text>
                </View>
              </View>
            </>
          )}

          {mode === 'bike' && (
            <>
              <View style={styles.overlayRow}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>JARAK</Text>
                  <Text style={[styles.metricBig, { color: theme.textMain }]}>
                    {getFormattedDistance(distanceMeters).split(' ')[0]}{' '}
                    <Text style={styles.metricUnit}>{getFormattedDistance(distanceMeters).split(' ')[1]}</Text>
                  </Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                  <Text style={[styles.metricBig, { color: '#34d399' }]}>+{elevationGain} m</Text>
                </View>
              </View>
              <View style={[styles.overlayRow, { marginTop: 6 }]}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>WAKTU</Text>
                  <Text style={styles.metricSub}>{formatTime(seconds)}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>KECEPATAN</Text>
                  <Text style={[styles.metricSub, { color: '#f59e0b' }]}>{(currentSpeedMs * 3.6).toFixed(1)} km/j</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>

      <View style={[styles.bottomSection, { backgroundColor: theme.card }]}>
        {!isTracking && (
          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.modeTab, { backgroundColor: theme.subCard, borderColor: theme.border }, mode === 'walk' && styles.modeTabActive]}
              onPress={() => setMode('walk')}
            >
              <Ionicons name="footsteps" size={16} color={mode === 'walk' ? '#ffffff' : theme.textMuted} />
              <Text style={[styles.modeText, { color: theme.textMuted }, mode === 'walk' && styles.modeTextActive]}>Jalan</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeTab, { backgroundColor: theme.subCard, borderColor: theme.border }, mode === 'run' && styles.modeTabActive]}
              onPress={() => setMode('run')}
            >
              <Ionicons name="walk" size={16} color={mode === 'run' ? '#ffffff' : theme.textMuted} />
              <Text style={[styles.modeText, { color: theme.textMuted }, mode === 'run' && styles.modeTextActive]}>Lari</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeTab, { backgroundColor: theme.subCard, borderColor: theme.border }, mode === 'bike' && styles.modeTabActive]}
              onPress={() => setMode('bike')}
            >
              <Ionicons name="bicycle" size={16} color={mode === 'bike' ? '#ffffff' : theme.textMuted} />
              <Text style={[styles.modeText, { color: theme.textMuted }, mode === 'bike' && styles.modeTextActive]}>Sepeda</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.controlPanel}>
          {!isTracking ? (
            <TouchableOpacity style={styles.btnStart} onPress={startTracking}>
              <Ionicons name="play" size={18} color="#ffffff" />
              <Text style={styles.btnTextWhite}>MULAI {mode.toUpperCase()}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.activeBtnRow}>
              <TouchableOpacity style={styles.btnPause} onPress={togglePause}>
                <Ionicons name={isPaused ? 'play' : 'pause'} size={18} color="#ffffff" />
                <Text style={styles.btnTextWhite}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnFinish} onPress={handleFinish}>
                <Ionicons name="stop" size={18} color="#ffffff" />
                <Text style={styles.btnTextWhite}>SELESAI</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <Modal visible={showTargetSetupModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.saveCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.saveHeaderRow}>
              <Text style={[styles.saveHeading, { color: theme.textMain }]}>Atur Target</Text>
              <TouchableOpacity onPress={() => setShowTargetSetupModal(false)}>
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Target Jarak (KM)</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: theme.subCard, borderColor: theme.border, color: theme.textMain }]}
              value={targetDistInput}
              onChangeText={setTargetDistInput}
              placeholder="Contoh: 5"
              placeholderTextColor={theme.textMuted}
              keyboardType="numeric"
            />

            <View style={styles.actionModalRow}>
              <TouchableOpacity
                style={[styles.btnDiscard, { borderColor: theme.border }]}
                onPress={() => {
                  setTargetDistanceKm(null);
                  setShowTargetSetupModal(false);
                }}
              >
                <Text style={styles.btnDiscardText}>Hapus</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnSaveAction}
                onPress={() => {
                  const val = parseFloat(targetDistInput);
                  if (val > 0) setTargetDistanceKm(val);
                  setShowTargetSetupModal(false);
                }}
              >
                <Text style={styles.btnTextWhite}>Terapkan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showSaveModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.saveCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.saveHeaderRow}>
              <Text style={[styles.saveHeading, { color: theme.textMain }]}>Aktivitas Selesai</Text>
              <TouchableOpacity onPress={() => setShowSaveModal(false)}>
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Judul Aktivitas</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: theme.subCard, borderColor: theme.border, color: theme.textMain }]}
              value={activityTitle}
              onChangeText={setActivityTitle}
              placeholder="Contoh: Lari Pagi"
              placeholderTextColor={theme.textMuted}
            />

            <View style={[styles.summaryMiniBox, { backgroundColor: theme.subCard }]}>
              <View style={styles.miniItem}>
                <Text style={[styles.miniLabel, { color: theme.textMuted }]}>Jarak</Text>
                <Text style={styles.miniVal}>{getFormattedDistance(distanceMeters)}</Text>
              </View>
              <View style={styles.miniItem}>
                <Text style={[styles.miniLabel, { color: theme.textMuted }]}>Waktu</Text>
                <Text style={[styles.miniVal, { color: theme.textMain }]}>{formatTime(seconds)}</Text>
              </View>
              <View style={styles.miniItem}>
                <Text style={[styles.miniLabel, { color: theme.textMuted }]}>Pace</Text>
                <Text style={styles.miniVal}>{calculateInstantPace()}</Text>
              </View>
            </View>

            <View style={styles.actionModalRow}>
              <TouchableOpacity
                style={[styles.btnDiscard, { borderColor: '#ef4444' }]}
                onPress={() => {
                  setShowSaveModal(false);
                  router.replace('/');
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#ef4444" />
                <Text style={styles.btnDiscardText}>Buang</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnSaveAction} onPress={handleSaveActivity}>
                <Ionicons name="checkmark" size={18} color="#ffffff" />
                <Text style={styles.btnTextWhite}>Simpan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <NotificationModal
        visible={modalConfig.visible}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: '#38bdf8', fontSize: 14, fontWeight: '700' },
  targetToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  targetToggleActive: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  targetToggleText: { fontSize: 11, fontWeight: '700', color: '#38bdf8' },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, gap: 6 },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { fontSize: 11, fontWeight: '700' },
  mapArea: { flex: 1, position: 'relative' },
  map: { width: '100%', height: '100%' },
  overlayCard: { position: 'absolute', top: 12, left: 14, right: 14, borderRadius: 16, padding: 14, borderWidth: 1 },
  overlayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricItem: { flex: 1 },
  metricLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  metricBig: { fontSize: 26, fontWeight: '900', marginTop: 2 },
  metricUnit: { fontSize: 13, fontWeight: '600', color: '#ea580c' },
  metricSub: { color: '#38bdf8', fontSize: 18, fontWeight: '800', marginTop: 2 },
  bottomSection: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 6 },
  modeTabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  modeTab: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  modeTabActive: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  modeText: { fontSize: 12, fontWeight: '700' },
  modeTextActive: { color: '#ffffff' },
  controlPanel: { padding: 14 },
  btnStart: { backgroundColor: '#ea580c', padding: 16, borderRadius: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  activeBtnRow: { flexDirection: 'row', gap: 10 },
  btnPause: { flex: 1, backgroundColor: '#0284c7', padding: 16, borderRadius: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  btnFinish: { flex: 1, backgroundColor: '#ef4444', padding: 16, borderRadius: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  btnTextWhite: { color: '#fff', fontSize: 15, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.75)', justifyContent: 'center', padding: 20 },
  saveCard: { padding: 22, borderRadius: 20, borderWidth: 1 },
  saveHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  saveHeading: { fontSize: 18, fontWeight: '800' },
  inputLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  textInput: { borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, marginBottom: 12 },
  summaryMiniBox: { flexDirection: 'row', justifyContent: 'space-around', padding: 12, borderRadius: 12, marginBottom: 16 },
  miniItem: { alignItems: 'center' },
  miniLabel: { fontSize: 10, fontWeight: '700' },
  miniVal: { color: '#38bdf8', fontSize: 14, fontWeight: '800', marginTop: 2 },
  actionModalRow: { flexDirection: 'row', gap: 10 },
  btnDiscard: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1 },
  btnDiscardText: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  btnSaveAction: { flex: 1.5, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ea580c', padding: 14, borderRadius: 12 },
});