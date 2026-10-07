import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  Dimensions,
  Modal,
  Image,
  ActivityIndicator,
  PanResponder,
  useColorScheme,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Polyline } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getHistory,
  getDailyStats,
  updateDailyStats,
  getTodayDateString,
  ActivityHistory,
  DailyGoal,
} from '../utils/storage';
import { shareActivityGpx, downloadActivityGpx } from '../utils/gpxHelper';
import { requestBackgroundStepPermissions } from '../utils/backgroundStepTask';
import NotificationModal from '../components/NotificationModal';

const { width } = Dimensions.get('window');
const SAVED_DOWNLOAD_DIR_KEY = '@xofit_saved_download_dir_uri';

const SolidFlameWithNumber = ({ count, size = 56 }: { count: number; size?: number }) => {
  return (
    <View style={{ width: size, height: size * 1.15, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size * 1.15} viewBox="0 0 24 28">
        <Defs>
          <SvgGrad id="flameSolidGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#f97316" />
            <Stop offset="100%" stopColor="#ea580c" />
          </SvgGrad>
        </Defs>
        <Path
          d="M12 0C11.5 3 9 5.5 8 8C7 5.5 5 5 4 6.5C2.5 8.5 2 11.5 2 15C2 21 6.5 27 12 27C17.5 27 22 21 22 15C22 10.5 19 6 15 3C14.8 5 13.5 6.5 12 7C12.5 4.5 12.5 2 12 0Z"
          fill="url(#flameSolidGrad)"
        />
      </Svg>
      <View style={styles.solidFlameNumberBadge}>
        <Text style={[styles.solidFlameNumberText, { fontSize: size > 40 ? 15 : 11 }]}>{count}</Text>
      </View>
    </View>
  );
};

interface RecommendedRoute {
  id: string;
  title: string;
  type: 'run' | 'bike';
  distanceKm: number;
  elevationM: number;
  difficulty: 'Mudah' | 'Sedang' | 'Tantangan';
  desc: string;
  waypoints: [number, number][];
}

export default function MainApp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [activeTab, setActiveTab] = useState<'home' | 'radar' | 'profile'>('home');
  const [history, setHistory] = useState<ActivityHistory[]>([]);
  const [daily, setDaily] = useState<DailyGoal | null>(null);

  const [profileSubTab, setProfileSubTab] = useState<'progress' | 'history'>('progress');
  const [progressFilter, setProgressFilter] = useState<'all' | 'run' | 'bike' | 'walk'>('all');
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(11);

  const [selectedDownloadItem, setSelectedDownloadItem] = useState<ActivityHistory | null>(null);
  const downloadCardRef = useRef<ViewShot>(null);
  const [selectedGpxItem, setSelectedGpxItem] = useState<ActivityHistory | null>(null);
  const [streakModalVisible, setStreakModalVisible] = useState(false);

  const [gpsData, setGpsData] = useState<{ lat: number; lng: number; accuracy: number | null }>({
    lat: -6.175392,
    lng: 106.827153,
    accuracy: null,
  });
  const [routeFilter, setRouteFilter] = useState<'run' | 'bike'>('run');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [recommendedRoutes, setRecommendedRoutes] = useState<RecommendedRoute[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

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

  const radarMapRef = useRef<WebView>(null);
  const pedometerSubRef = useRef<any>(null);

  const streakPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80) {
          setStreakModalVisible(false);
        }
      },
    })
  ).current;

  const syncHardwareSteps = async () => {
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (!isAvailable) return;

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();

      const pedo = await Pedometer.getStepCountAsync(start, end).catch(() => null);
      if (pedo && typeof pedo.steps === 'number') {
        const fresh = await updateDailyStats({
          steps: pedo.steps,
          calories: Math.round(pedo.steps * 0.04),
        });
        setDaily(fresh);
      }
    } catch (e) {
      console.log('Hardware pedometer sync error:', e);
    }
  };

  const loadData = async () => {
    const [h, d] = await Promise.all([getHistory(), getDailyStats()]);
    setHistory(h || []);
    setDaily(d);
    await syncHardwareSteps();
  };

  useEffect(() => {
    const checkMidnightReset = async () => {
      const todayStr = getTodayDateString();
      if (daily && daily.date !== todayStr) {
        const fresh = await getDailyStats();
        setDaily(fresh);
      }
    };

    const interval = setInterval(checkMidnightReset, 5000);
    return () => clearInterval(interval);
  }, [daily]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      return () => {
        if (pedometerSubRef.current) {
          pedometerSubRef.current.remove();
          pedometerSubRef.current = null;
        }
      };
    }, [])
  );

  useEffect(() => {
    (async () => {
      await requestBackgroundStepPermissions();
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsData((prev) => ({
          ...prev,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy || null,
        }));
      } catch (e) {
        console.log('Location error:', e);
      }
    })();
  }, []);

  const calculateRealWeeklyStreak = (): number => {
    if (!history || history.length === 0) return 0;

    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = (currentDay + 6) % 7;
    const startOfCurrentWeek = new Date(now);
    startOfCurrentWeek.setDate(now.getDate() - distanceToMonday);
    startOfCurrentWeek.setHours(0, 0, 0, 0);

    let streakWeeks = 0;
    const hasActivityThisWeek = history.some((h) => (h.timestamp || 0) >= startOfCurrentWeek.getTime());
    if (hasActivityThisWeek) streakWeeks++;

    for (let i = 1; i <= 52; i++) {
      const prevWeekStart = new Date(startOfCurrentWeek);
      prevWeekStart.setDate(startOfCurrentWeek.getDate() - i * 7);
      const prevWeekEnd = new Date(prevWeekStart);
      prevWeekEnd.setDate(prevWeekStart.getDate() + 7);

      const hasAct = history.some((h) => {
        const t = h.timestamp || 0;
        return t >= prevWeekStart.getTime() && t < prevWeekEnd.getTime();
      });

      if (hasAct) {
        streakWeeks++;
      } else {
        break;
      }
    }
    return streakWeeks;
  };

  const calculatedWeeklyStreak = calculateRealWeeklyStreak();

  const fetchSafeRoute = async (points: [number, number][], type: 'run' | 'bike') => {
    try {
      const coordString = points.map((p) => `${p[1]},${p[0]}`).join(';');
      const routingEngine = type === 'run' ? 'foot' : 'bike';
      const url = `https://routing.openstreetmap.de/routed-${routingEngine}/route/v1/driving/${coordString}?overview=full&geometries=geojson&continue_straight=true`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.routes && json.routes.length > 0) {
        const roadCoords = json.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        const roadDist = (json.routes[0].distance / 1000).toFixed(2);
        return { coords: roadCoords, dist: parseFloat(roadDist) };
      }
    } catch {
      try {
        const coordString = points.map((p) => `${p[1]},${p[0]}`).join(';');
        const urlFallback = `https://router.project-osrm.org/route/v1/${type === 'run' ? 'foot' : 'bike'}/${coordString}?overview=full&geometries=geojson&continue_straight=true`;
        const resFb = await fetch(urlFallback);
        const jsonFb = await resFb.json();
        if (jsonFb.routes && jsonFb.routes.length > 0) {
          const roadCoords = jsonFb.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          const roadDist = (jsonFb.routes[0].distance / 1000).toFixed(2);
          return { coords: roadCoords, dist: parseFloat(roadDist) };
        }
      } catch {}
    }
    return { coords: points, dist: type === 'run' ? 2.85 : 14.2 };
  };

  useEffect(() => {
    if (activeTab !== 'radar') return;

    let isMounted = true;
    (async () => {
      setIsLoadingRoutes(true);
      const lat = gpsData.lat;
      const lng = gpsData.lng;

      let blueprints: {
        id: string;
        title: string;
        type: 'run' | 'bike';
        difficulty: 'Mudah' | 'Sedang' | 'Tantangan';
        desc: string;
        elevationM: number;
        pts: [number, number][];
      }[] = [];

      if (routeFilter === 'run') {
        blueprints = [
          {
            id: 'run-safe-1',
            title: 'Sirkuit Blok Timur',
            type: 'run',
            difficulty: 'Mudah',
            desc: 'Rute memutar satu arah mengelilingi blok pemukiman dan kembali ke titik start.',
            elevationM: 6,
            pts: [
              [lat, lng],
              [lat + 0.0035, lng + 0.0025],
              [lat + 0.004, lng + 0.007],
              [lat - 0.001, lng + 0.0065],
              [lat - 0.002, lng + 0.002],
              [lat, lng],
            ],
          },
          {
            id: 'run-safe-2',
            title: 'Lingkar Luar Taman',
            type: 'run',
            difficulty: 'Sedang',
            desc: 'Jalur memutar satu arah melintasi sisi jalan sekeliling ruang terbuka hijau.',
            elevationM: 10,
            pts: [
              [lat, lng],
              [lat - 0.003, lng + 0.003],
              [lat - 0.006, lng + 0.0025],
              [lat - 0.0055, lng - 0.003],
              [lat - 0.0015, lng - 0.0035],
              [lat, lng],
            ],
          },
        ];
      } else {
        blueprints = [
          {
            id: 'bike-safe-1',
            title: 'Loop Cepat Arteri Sekunder',
            type: 'bike',
            difficulty: 'Sedang',
            desc: 'Gowes melingkar satu arah mengitari perimeter jalan mulus dan kembali ke start.',
            elevationM: 32,
            pts: [
              [lat, lng],
              [lat + 0.015, lng + 0.012],
              [lat + 0.025, lng + 0.022],
              [lat + 0.012, lng + 0.032],
              [lat - 0.008, lng + 0.02],
              [lat, lng],
            ],
          },
          {
            id: 'bike-safe-2',
            title: 'Grand Loop Kawasan Luar',
            type: 'bike',
            difficulty: 'Tantangan',
            desc: 'Sirkuit endurance memutar penuh melewati jalan utama tanpa jalur bolak-balik.',
            elevationM: 85,
            pts: [
              [lat, lng],
              [lat - 0.018, lng + 0.02],
              [lat - 0.035, lng + 0.015],
              [lat - 0.038, lng - 0.018],
              [lat - 0.012, lng - 0.022],
              [lat, lng],
            ],
          },
        ];
      }

      const generated: RecommendedRoute[] = [];
      for (const item of blueprints) {
        const routeData = await fetchSafeRoute(item.pts, item.type);
        generated.push({
          id: item.id,
          title: item.title,
          type: item.type,
          difficulty: item.difficulty,
          desc: item.desc,
          elevationM: item.elevationM,
          distanceKm: routeData.dist,
          waypoints: routeData.coords,
        });
      }

      if (isMounted) {
        setRecommendedRoutes(generated);
        setIsLoadingRoutes(false);
        if (generated.length > 0) {
          setSelectedRouteId(generated[0].id);
          if (radarMapRef.current) {
            radarMapRef.current.injectJavaScript(`
              if (window.showRecommendedRoute) {
                window.showRecommendedRoute(${JSON.stringify(generated[0].waypoints)});
              }
              true;
            `);
          }
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [activeTab, routeFilter, Math.round(gpsData.lat * 100), Math.round(gpsData.lng * 100)]);

  const handleDeleteItem = (id: string) => {
    setModalConfig({
      visible: true,
      type: 'danger',
      title: 'Hapus Aktivitas',
      message: 'Apakah Anda yakin ingin menghapus aktivitas ini dari riwayat?',
      confirmText: 'Hapus',
      cancelText: 'Batal',
      onConfirm: async () => {
        const nextList = history.filter((h) => h.id !== id);
        await AsyncStorage.setItem('@run_history', JSON.stringify(nextList));
        setHistory(nextList);
        setModalConfig((prev) => ({ ...prev, visible: false }));
      },
    });
  };

  const handleExecuteSaveImage = async () => {
    try {
      if (!downloadCardRef.current) return;
      await new Promise((r) => setTimeout(r, 150));
      const uri = await captureRef(downloadCardRef, { format: 'png', quality: 1.0 });

      if (Platform.OS === 'android') {
        const fileName = `xofit_${Date.now()}.png`;
        const base64Data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        let dirUri = await AsyncStorage.getItem(SAVED_DOWNLOAD_DIR_KEY);

        if (dirUri) {
          try {
            const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
              dirUri,
              fileName,
              'image/png'
            );
            await FileSystem.writeAsStringAsync(createdUri, base64Data, {
              encoding: FileSystem.EncodingType.Base64,
            });
            Alert.alert('Berhasil Disimpan', 'Gambar hasil aktivitas telah disimpan ke folder Download.');
            setSelectedDownloadItem(null);
            return;
          } catch {
            dirUri = null;
          }
        }

        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          await AsyncStorage.setItem(SAVED_DOWNLOAD_DIR_KEY, permissions.directoryUri);
          const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'image/png'
          );
          await FileSystem.writeAsStringAsync(createdUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          Alert.alert('Berhasil Disimpan', 'Gambar hasil aktivitas telah disimpan ke folder Download.');
          setSelectedDownloadItem(null);
          return;
        }
      }

      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Simpan Gambar' });
      setSelectedDownloadItem(null);
    } catch {
      Alert.alert('Gagal Mengunduh', 'Tidak dapat memproses berkas gambar hasil aktivitas.');
    }
  };

  const handleExecuteShareImage = async () => {
    try {
      if (!downloadCardRef.current) return;
      await new Promise((r) => setTimeout(r, 150));
      const uri = await captureRef(downloadCardRef, { format: 'png', quality: 1.0 });

      const fileName = `xofit_${Date.now()}.png`;
      const targetPath = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.copyAsync({ from: uri, to: targetPath });

      await Sharing.shareAsync(targetPath, {
        mimeType: 'image/png',
        dialogTitle: 'Bagikan Hasil Aktivitas',
        UTI: 'public.png',
      });
      setSelectedDownloadItem(null);
    } catch {
      Alert.alert('Gagal Membagikan', 'Terjadi kesalahan saat membagikan gambar.');
    }
  };

  const handleExecuteDownloadGpx = async () => {
    if (!selectedGpxItem) return;
    const success = await downloadActivityGpx(selectedGpxItem);
    setSelectedGpxItem(null);
    if (success) {
      Alert.alert('Berhasil', 'Berkas GPX berhasil disimpan ke folder Download.');
    }
  };

  const handleExecuteShareGpx = async () => {
    if (!selectedGpxItem) return;
    const success = await shareActivityGpx(selectedGpxItem);
    setSelectedGpxItem(null);
    if (!success) {
      Alert.alert('Gagal', 'Tidak ada koordinat rute yang valid untuk dibagikan.');
    }
  };

  const theme = {
    bg: isDark ? '#0b0f19' : '#f8fafc',
    card: isDark ? '#111827' : '#ffffff',
    border: isDark ? '#1f2937' : '#e2e8f0',
    textMain: isDark ? '#f9fafb' : '#0f172a',
    textMuted: isDark ? '#9ca3af' : '#64748b',
    subCard: isDark ? '#1f2937' : '#f1f5f9',
    bottomBar: isDark ? '#0b0f19' : '#ffffff',
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayActivities = history.filter((h) => {
    const isToday = (h.timestamp || 0) >= todayStart.getTime();
    const isEligibleSport = h.type === 'walk' || h.type === 'run' || h.type === 'bike';
    return isToday && isEligibleSport;
  });

  const todayActiveMinutes = Math.round(
    todayActivities.reduce((acc, h) => acc + (h.durationSec || 0), 0) / 60
  );
  const targetActiveMinutes = daily?.targetActiveMinutes || 45;
  const minPercent = Math.min(100, Math.round((todayActiveMinutes / targetActiveMinutes) * 100));

  const todaySteps = daily?.steps || 0;
  const targetSteps = daily?.targetSteps || 10000;
  const stepPercent = Math.min(100, Math.round((todaySteps / targetSteps) * 100));

  const todayCalories =
    (daily?.calories || Math.round(todaySteps * 0.04)) +
    todayActivities.reduce((acc, h) => acc + (h.calories || 0), 0);
  const targetCalories = daily?.targetCalories || 500;
  const calPercent = Math.min(100, Math.round((todayCalories / targetCalories) * 100));

  const renderCircleProgress = (radius: number, percent: number) => {
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (circumference * percent) / 100;
    return { circumference, strokeDashoffset };
  };

  const ringSteps = renderCircleProgress(62, stepPercent);
  const ringCal = renderCircleProgress(46, calPercent);
  const ringMin = renderCircleProgress(30, minPercent);

  const latestActivity = history.length > 0 ? history[0] : null;

  const nowForCal = new Date();
  const currentYear = nowForCal.getFullYear();
  const currentMonth = nowForCal.getMonth();
  const monthName = nowForCal.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
  const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;

  const currentMonthCells = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    currentMonthCells.push({ empty: true, date: 0, activity: null, weekIndex: Math.floor(i / 7) });
  }
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    const found = history.find((h) => {
      const dt = new Date(h.timestamp || 0);
      return dt.getFullYear() === currentYear && dt.getMonth() === currentMonth && dt.getDate() === d;
    });
    const cellIdx = firstDayOfMonth + d - 1;
    currentMonthCells.push({
      empty: false,
      date: d,
      activity: found ? found.type || 'run' : null,
      weekIndex: Math.floor(cellIdx / 7),
    });
  }

  const todayCellIndex = firstDayOfMonth + nowForCal.getDate() - 1;
  const todayWeekRowIndex = Math.floor(todayCellIndex / 7);
  const totalCalendarRows = Math.ceil((firstDayOfMonth + daysInCurrentMonth) / 7);

  const getWeeklyProgressData = () => {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = (currentDay + 6) % 7;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - distanceToMonday);
    thisMonday.setHours(0, 0, 0, 0);

    const weeks = [];
    const filteredHistory = history.filter((h) => {
      if (progressFilter === 'all') return true;
      return h.type === progressFilter;
    });

    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() - i * 7);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const itemsInWeek = filteredHistory.filter((h) => {
        const t = h.timestamp || 0;
        return t >= weekStart.getTime() && t <= weekEnd.getTime();
      });

      const totalDistMeters = itemsInWeek.reduce((acc, c) => acc + (c.distanceMeters || 0), 0);
      const totalSec = itemsInWeek.reduce((acc, c) => acc + (c.durationSec || 0), 0);
      const totalElev = itemsInWeek.reduce((acc, c) => acc + (c.elevationGain || 0), 0);
      const distKm = parseFloat((totalDistMeters / 1000).toFixed(2));

      weeks.push({
        index: 11 - i,
        label: `${weekStart.getDate()} ${weekStart.toLocaleString('id-ID', { month: 'short' })} - ${weekEnd.getDate()} ${weekEnd.toLocaleString('id-ID', { month: 'short' })} ${weekEnd.getFullYear()}`,
        distKm,
        durationSec: totalSec,
        elevationM: totalElev,
        count: itemsInWeek.length,
      });
    }
    return weeks;
  };

  const weeklyProgress = getWeeklyProgressData();
  const activeWeekStats = weeklyProgress[selectedWeekIndex] || weeklyProgress[weeklyProgress.length - 1];

  const maxWeeklyKmReal = Math.max(...weeklyProgress.map((w) => w.distKm), 0);
  const chartMaxY = maxWeeklyKmReal > 0 ? Math.ceil(maxWeeklyKmReal * 1.25) : 10;

  const chartSvgWidth = width - 64;
  const chartSvgHeight = 150;
  const chartPoints = weeklyProgress.map((w, idx) => {
    const x = (idx / (weeklyProgress.length - 1)) * (chartSvgWidth - 24) + 12;
    const y = chartSvgHeight - 20 - (w.distKm / chartMaxY) * (chartSvgHeight - 44);
    return { x, y, val: w.distKm, data: w, idx };
  });

  const svgPathD = chartPoints.reduce((acc, p, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
  const svgAreaD = `${svgPathD} L ${chartPoints[chartPoints.length - 1].x} ${chartSvgHeight - 20} L ${chartPoints[0].x} ${chartSvgHeight - 20} Z`;

  const chartPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleChartTouch(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleChartTouch(evt.nativeEvent.locationX),
    })
  ).current;

  const handleChartTouch = (touchX: number) => {
    const clampedX = Math.max(12, Math.min(chartSvgWidth - 12, touchX));
    const step = (chartSvgWidth - 24) / 11;
    const closestIndex = Math.round((clampedX - 12) / step);
    const validIndex = Math.max(0, Math.min(11, closestIndex));
    setSelectedWeekIndex(validIndex);
  };

  const getXAxisMonths = () => {
    const months = [];
    const now = new Date();
    for (let m = 2; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      months.push(d.toLocaleString('id-ID', { month: 'short' }).toUpperCase());
    }
    return months;
  };
  const xAxisMonths = getXAxisMonths();

  const generateInteractiveRouteHtml = (route: { latitude: number; longitude: number }[]) => {
    const safeRoute = Array.isArray(route) ? route : [];
    const coordsJson = JSON.stringify(safeRoute.map((r) => [r.latitude, r.longitude]));
    const fallbackLat = safeRoute.length > 0 ? safeRoute[0].latitude : -6.175392;
    const fallbackLng = safeRoute.length > 0 ? safeRoute[0].longitude : 106.827153;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: ${isDark ? '#0b0f19' : '#ffffff'}; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var coords = ${coordsJson};
        var map = L.map('map', { zoomControl: false, dragging: false, scrollWheelZoom: false, touchZoom: false }).setView([${fallbackLat}, ${fallbackLng}], 15);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

        if (coords.length > 0) {
          var polyline = L.polyline(coords, { color: '#ea580c', weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map);
          var bounds = polyline.getBounds();
          
          function fitMap() {
            map.invalidateSize();
            map.fitBounds(bounds.pad(0.25));
          }

          fitMap();
          setTimeout(fitMap, 250);
          setTimeout(fitMap, 600);
        }
      </script>
    </body>
    </html>
    `;
  };

  const convertRouteToSvgPoints = (route: { latitude: number; longitude: number }[], svgW: number, svgH: number) => {
    if (!route || !Array.isArray(route) || route.length < 2) return '';
    const lats = route.map((r) => r.latitude);
    const lngs = route.map((r) => r.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const deltaLat = maxLat - minLat || 0.001;
    const deltaLng = maxLng - minLng || 0.001;

    const pad = 24;
    const drawW = svgW - pad * 2;
    const drawH = svgH - pad * 2;

    return route
      .map((pt) => {
        const x = pad + ((pt.longitude - minLng) / deltaLng) * drawW;
        const y = svgH - pad - ((pt.latitude - minLat) / deltaLat) * drawH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={styles.contentArea}>
        {/* ==================== TAB 1: HOME ==================== */}
        {activeTab === 'home' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollPadding}>
            <View style={styles.header}>
              <View>
                <Text style={styles.brandTitle}>XOFIT PRO</Text>
                <Text style={[styles.greetingTitle, { color: theme.textMain }]}>Beranda Latihan</Text>
              </View>
            </View>

            <View style={[styles.cardClean, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.titleWithIcon}>
                  <Ionicons name="pie-chart" size={18} color="#ea580c" />
                  <Text style={[styles.sectionTitle, { color: theme.textMain }]}>Target Gerak Harian</Text>
                </View>
                <TouchableOpacity
                  style={styles.bgSyncBadge}
                  onPress={async () => {
                    const granted = await requestBackgroundStepPermissions();
                    if (granted) {
                      await syncHardwareSteps();
                      setModalConfig({
                        visible: true,
                        type: 'success',
                        title: 'Izin Latar Belakang Aktif',
                        message: 'Pelacakan langkah & kalori otomatis tersinkronisasi dengan sensor internal hardware ponsel.',
                        confirmText: 'OK',
                        onConfirm: () => setModalConfig((prev) => ({ ...prev, visible: false })),
                      });
                    }
                  }}
                >
                  <Ionicons name="shield-checkmark" size={13} color="#22c55e" />
                  <Text style={styles.bgSyncText}>Background Aktif</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.ringsContainerRow}>
                <View style={styles.ringsSvgWrapper}>
                  <Svg width={150} height={150} viewBox="0 0 150 150">
                    <Circle cx="75" cy="75" r="62" stroke={isDark ? '#1e293b' : '#e2e8f0'} strokeWidth="9" fill="none" />
                    <Circle
                      cx="75"
                      cy="75"
                      r="62"
                      stroke="#38bdf8"
                      strokeWidth="9"
                      fill="none"
                      strokeDasharray={ringSteps.circumference}
                      strokeDashoffset={ringSteps.strokeDashoffset}
                      strokeLinecap="round"
                      transform="rotate(-90 75 75)"
                    />
                    <Circle cx="75" cy="75" r="46" stroke={isDark ? '#1e293b' : '#e2e8f0'} strokeWidth="9" fill="none" />
                    <Circle
                      cx="75"
                      cy="75"
                      r="46"
                      stroke="#ea580c"
                      strokeWidth="9"
                      fill="none"
                      strokeDasharray={ringCal.circumference}
                      strokeDashoffset={ringCal.strokeDashoffset}
                      strokeLinecap="round"
                      transform="rotate(-90 75 75)"
                    />
                    <Circle cx="75" cy="75" r="30" stroke={isDark ? '#1e293b' : '#e2e8f0'} strokeWidth="9" fill="none" />
                    <Circle
                      cx="75"
                      cy="75"
                      r="30"
                      stroke="#22c55e"
                      strokeWidth="9"
                      fill="none"
                      strokeDasharray={ringMin.circumference}
                      strokeDashoffset={ringMin.strokeDashoffset}
                      strokeLinecap="round"
                      transform="rotate(-90 75 75)"
                    />
                  </Svg>
                </View>

                <View style={styles.ringsLegendCol}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicatorDot, { backgroundColor: '#38bdf8' }]} />
                    <View>
                      <Text style={[styles.legendTitle, { color: theme.textMuted }]}>Langkah Kaki</Text>
                      <Text style={[styles.legendValue, { color: theme.textMain }]}>
                        {todaySteps.toLocaleString('id-ID')} <Text style={styles.legendGoal}>/ {targetSteps / 1000}k</Text>
                      </Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicatorDot, { backgroundColor: '#ea580c' }]} />
                    <View>
                      <Text style={[styles.legendTitle, { color: theme.textMuted }]}>Kalori Terbakar</Text>
                      <Text style={[styles.legendValue, { color: theme.textMain }]}>
                        {todayCalories} <Text style={styles.legendGoal}>/ {targetCalories} kcal</Text>
                      </Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicatorDot, { backgroundColor: '#22c55e' }]} />
                    <View>
                      <Text style={[styles.legendTitle, { color: theme.textMuted }]}>Waktu Olahraga</Text>
                      <Text style={[styles.legendValue, { color: theme.textMain }]}>
                        {todayActiveMinutes} <Text style={styles.legendGoal}>/ {targetActiveMinutes} mnt</Text>
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {latestActivity ? (
              <View style={[styles.cardClean, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.titleWithIcon}>
                    <Ionicons name="time" size={18} color="#0284c7" />
                    <Text style={[styles.sectionTitle, { color: theme.textMain }]}>Aktivitas Terakhir</Text>
                  </View>
                  <Text style={[styles.subNote, { color: theme.textMuted }]}>{latestActivity.dateStr}</Text>
                </View>

                <Text style={[styles.latestActTitle, { color: theme.textMain }]}>{latestActivity.title}</Text>

                {latestActivity.route && latestActivity.route.length > 0 && (
                  <View style={[styles.miniMapWrap, { borderColor: theme.border }]}>
                    <WebView
                      originWhitelist={['*']}
                      source={{ html: generateInteractiveRouteHtml(latestActivity.route) }}
                      style={styles.miniMap}
                      scrollEnabled={false}
                    />
                  </View>
                )}

                <View style={styles.historyStatsRow}>
                  <View>
                    <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>JARAK</Text>
                    <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.distanceDisplay}</Text>
                  </View>

                  {latestActivity.type === 'bike' ? (
                    <>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                        <Text style={[styles.statSubVal, { color: '#34d399' }]}>+{latestActivity.elevationGain || 0} m</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.durationFormatted}</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>KECEPATAN</Text>
                        <Text style={[styles.statSubVal, { color: '#f59e0b' }]}>
                          {latestActivity.avgSpeedKmh ? `${latestActivity.avgSpeedKmh} km/j` : '--'}
                        </Text>
                      </View>
                    </>
                  ) : latestActivity.type === 'run' ? (
                    <>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                        <Text style={[styles.statSubVal, { color: '#34d399' }]}>+{latestActivity.elevationGain || 0} m</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.durationFormatted}</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>PACE</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.paceFormatted}</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>LANGKAH</Text>
                        <Text style={[styles.statSubVal, { color: '#38bdf8' }]}>{latestActivity.steps || 0}</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.durationFormatted}</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>PACE</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.paceFormatted}</Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            ) : null}

            {/* Widget Streak */}
            <TouchableOpacity
              style={[styles.streakWidgetCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              activeOpacity={0.85}
              onPress={() => setStreakModalVisible(true)}
            >
              <View style={styles.streakWidgetHeader}>
                <Text style={[styles.streakWidgetTitle, { color: theme.textMain }]}>Beruntun</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text style={[styles.streakWidgetSub, { color: theme.textMuted }]}>Bulan ini</Text>
                  <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
                </View>
              </View>

              <View style={styles.streakWidgetContent}>
                <View style={styles.flameContainer}>
                  <SolidFlameWithNumber count={calculatedWeeklyStreak} size={54} />
                  <Text style={styles.flameWeekText}>Minggu</Text>
                </View>

                <View style={styles.dotMatrix}>
                  {[
                    [0, 0, 0, 1, 0, 1],
                    [1, 0, 0, 0, 1, 1, 1],
                    [0, 1, 0, 0, 0, 0, 1],
                    [0, 1, 0, 0, 1, 0, 1],
                    [0, 1, 2, 0, 0, 0, 0],
                  ].map((row, rIdx) => (
                    <View key={rIdx} style={styles.dotMatrixRow}>
                      {row.map((val, cIdx) => (
                        <View
                          key={cIdx}
                          style={[
                            styles.matrixDot,
                            val === 1 && { backgroundColor: isDark ? '#ffffff' : '#0f172a' },
                            val === 2 && styles.matrixDotRing,
                            val === 0 && { backgroundColor: isDark ? '#1f2937' : '#e2e8f0' },
                          ]}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ==================== TAB 2: MAPS & PILIHAN RUTE ==================== */}
        {activeTab === 'radar' && (
          <View style={styles.fullscreenMapContainer}>
            <WebView
              ref={radarMapRef}
              originWhitelist={['*']}
              source={{
                html: `
                <!DOCTYPE html>
                <html><head>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                  <style>body,html,#map{margin:0;padding:0;width:100%;height:100%;background:${isDark ? '#0b0f19' : '#e2e8f0'};}</style>
                </head><body><div id="map"></div>
                <script>
                  var map = L.map('map', { zoomControl: false }).setView([${gpsData.lat}, ${gpsData.lng}], 15);
                  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                  var cur = L.circleMarker([${gpsData.lat}, ${gpsData.lng}], { radius: 8, fillColor: '#38bdf8', color: '#fff', fillOpacity: 1 }).addTo(map);
                  var activePoly = null;
                  var startPin = null;

                  window.showRecommendedRoute = function(pts) {
                    if (activePoly) map.removeLayer(activePoly);
                    if (startPin) map.removeLayer(startPin);

                    if (pts && pts.length > 0) {
                      activePoly = L.polyline(pts, { color: '#ea580c', weight: 5, opacity: 0.9 }).addTo(map);
                      startPin = L.circleMarker(pts[0], { radius: 7, fillColor: '#22c55e', color: '#fff', fillOpacity: 1 }).addTo(map);
                      map.fitBounds(activePoly.getBounds(), { padding: [40, 40] });
                    }
                  };
                </script></body></html>`,
              }}
              style={styles.fullscreenWebView}
            />

            <View style={[styles.routeSheetContainer, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.titleWithIcon}>
                  <Ionicons name="navigate-circle" size={20} color="#ea580c" />
                  <Text style={[styles.sectionTitle, { color: theme.textMain }]}>
                    Rute {routeFilter === 'run' ? 'Lari / Jalan' : 'Gowes Sepeda'}
                  </Text>
                </View>

                <View style={[styles.routeFilterRow, { backgroundColor: theme.subCard }]}>
                  <TouchableOpacity
                    style={[styles.smallFilterBtn, routeFilter === 'run' && styles.smallFilterActive]}
                    onPress={() => setRouteFilter('run')}
                  >
                    <Ionicons name="walk" size={13} color={routeFilter === 'run' ? '#fff' : theme.textMuted} />
                    <Text style={[styles.smallFilterText, routeFilter === 'run' && styles.smallFilterTextActive]}>Lari / Jalan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.smallFilterBtn, routeFilter === 'bike' && styles.smallFilterActive]}
                    onPress={() => setRouteFilter('bike')}
                  >
                    <Ionicons name="bicycle" size={13} color={routeFilter === 'bike' ? '#fff' : theme.textMuted} />
                    <Text style={[styles.smallFilterText, routeFilter === 'bike' && styles.smallFilterTextActive]}>Sepeda</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isLoadingRoutes ? (
                <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#ea580c" />
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
                    Menghitung rute memutar satu arah...
                  </Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {recommendedRoutes.map((item) => {
                    const isSelected = selectedRouteId === item.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.85}
                        style={[
                          styles.routeCardItem,
                          { backgroundColor: theme.subCard, borderColor: isSelected ? '#ea580c' : theme.border },
                        ]}
                        onPress={() => {
                          setSelectedRouteId(item.id);
                          if (radarMapRef.current) {
                            radarMapRef.current.injectJavaScript(`
                              if (window.showRecommendedRoute) {
                                window.showRecommendedRoute(${JSON.stringify(item.waypoints)});
                              }
                              true;
                            `);
                          }
                        }}
                      >
                        <Text style={[styles.routeCardTitle, { color: theme.textMain }]} numberOfLines={1}>{item.title}</Text>
                        <Text style={[styles.routeCardDesc, { color: theme.textMuted }]} numberOfLines={2}>{item.desc}</Text>
                        <View style={[styles.routeMetricsRow, { borderTopColor: theme.border }]}>
                          <Text style={[styles.routeMetricVal, { color: theme.textMain }]}>
                            {item.distanceKm} <Text style={{ fontSize: 10, color: theme.textMuted }}>km</Text>
                          </Text>
                          <View style={styles.badgeLoopWrap}>
                            <Ionicons name="repeat" size={12} color="#ea580c" />
                            <Text style={styles.badgeLoopText}>Rute Loop</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        )}

        {/* ==================== TAB 3: ANDA ==================== */}
        {activeTab === 'profile' && (
          <View style={styles.profileContainer}>
            <View style={styles.profileHeader}>
              <View style={[styles.segmentedRow, { backgroundColor: theme.subCard }]}>
                <TouchableOpacity
                  style={[styles.segBtn, profileSubTab === 'progress' && styles.segBtnActive]}
                  onPress={() => setProfileSubTab('progress')}
                >
                  <Text style={[styles.segText, profileSubTab === 'progress' && styles.segTextActive]}>Kemajuan</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, profileSubTab === 'history' && styles.segBtnActive]}
                  onPress={() => setProfileSubTab('history')}
                >
                  <Text style={[styles.segText, profileSubTab === 'history' && styles.segTextActive]}>Riwayat</Text>
                </TouchableOpacity>
              </View>
            </View>

            {profileSubTab === 'progress' && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollPadding}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginBottom: 16 }}>
                  <TouchableOpacity
                    style={[styles.filterSportPill, { backgroundColor: theme.card, borderColor: theme.border }, progressFilter === 'all' && styles.filterSportPillActive]}
                    onPress={() => { setProgressFilter('all'); setSelectedWeekIndex(11); }}
                  >
                    <Ionicons name="pulse" size={16} color={progressFilter === 'all' ? '#ea580c' : theme.textMuted} />
                    <Text style={[styles.filterSportText, { color: theme.textMain }, progressFilter === 'all' && { color: '#ea580c' }]}>Semua olahraga</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.filterSportPill, { backgroundColor: theme.card, borderColor: theme.border }, progressFilter === 'run' && styles.filterSportPillActive]}
                    onPress={() => { setProgressFilter('run'); setSelectedWeekIndex(11); }}
                  >
                    <Ionicons name="walk" size={16} color={progressFilter === 'run' ? '#ea580c' : theme.textMuted} />
                    <Text style={[styles.filterSportText, { color: theme.textMain }, progressFilter === 'run' && { color: '#ea580c' }]}>Berlari</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.filterSportPill, { backgroundColor: theme.card, borderColor: theme.border }, progressFilter === 'bike' && styles.filterSportPillActive]}
                    onPress={() => { setProgressFilter('bike'); setSelectedWeekIndex(11); }}
                  >
                    <Ionicons name="bicycle" size={16} color={progressFilter === 'bike' ? '#ea580c' : theme.textMuted} />
                    <Text style={[styles.filterSportText, { color: theme.textMain }, progressFilter === 'bike' && { color: '#ea580c' }]}>Bersepeda</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.filterSportPill, { backgroundColor: theme.card, borderColor: theme.border }, progressFilter === 'walk' && styles.filterSportPillActive]}
                    onPress={() => { setProgressFilter('walk'); setSelectedWeekIndex(11); }}
                  >
                    <Ionicons name="footsteps" size={16} color={progressFilter === 'walk' ? '#ea580c' : theme.textMuted} />
                    <Text style={[styles.filterSportText, { color: theme.textMain }, progressFilter === 'walk' && { color: '#ea580c' }]}>Jalan Kaki</Text>
                  </TouchableOpacity>
                </ScrollView>

                <View style={[styles.cardClean, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text style={[styles.weekDateHeader, { color: theme.textMain, marginBottom: 0 }]}>
                      {activeWeekStats?.label}
                    </Text>
                    {activeWeekStats?.count > 0 && (
                      <View style={{ backgroundColor: '#ffedd5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ color: '#ea580c', fontSize: 10, fontWeight: '800' }}>{activeWeekStats.count} Aktivitas</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.metricsTripleRow}>
                    <View>
                      <Text style={[styles.metricTripleLabel, { color: theme.textMuted }]}>Jarak</Text>
                      <Text style={[styles.metricTripleVal, { color: theme.textMain }]}>
                        {activeWeekStats?.distKm} km
                      </Text>
                    </View>

                    <View>
                      <Text style={[styles.metricTripleLabel, { color: theme.textMuted }]}>Waktu</Text>
                      <Text style={[styles.metricTripleVal, { color: theme.textMain }]}>
                        {Math.floor((activeWeekStats?.durationSec || 0) / 60)}m {(activeWeekStats?.durationSec || 0) % 60}d
                      </Text>
                    </View>

                    <View>
                      <Text style={[styles.metricTripleLabel, { color: theme.textMuted }]}>Kenaikan Elev</Text>
                      <Text style={[styles.metricTripleVal, { color: theme.textMain }]}>
                        {activeWeekStats?.elevationM || 0} m
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.subNote, { color: theme.textMuted, marginTop: 14, marginBottom: 8 }]}>
                    12 minggu terakhir (geser di diagram untuk melihat minggu lain)
                  </Text>

                  <View style={styles.chartWrapper} {...chartPanResponder.panHandlers}>
                    <Svg width={chartSvgWidth} height={chartSvgHeight}>
                      <Defs>
                        <SvgGrad id="gradFillDynamic" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor="#ea580c" stopOpacity="0.4" />
                          <Stop offset="100%" stopColor="#ea580c" stopOpacity="0.0" />
                        </SvgGrad>
                      </Defs>

                      <Path d={`M 0 20 L ${chartSvgWidth} 20`} stroke={theme.border} strokeWidth="1" />
                      <Path d={`M 0 ${(chartSvgHeight - 20) / 2} L ${chartSvgWidth} ${(chartSvgHeight - 20) / 2}`} stroke={theme.border} strokeWidth="1" />
                      <Path d={`M 0 ${chartSvgHeight - 20} L ${chartSvgWidth} ${chartSvgHeight - 20}`} stroke={theme.border} strokeWidth="1" />

                      <Path d={svgAreaD} fill="url(#gradFillDynamic)" />
                      <Path d={svgPathD} fill="none" stroke="#ea580c" strokeWidth="2.5" />

                      {chartPoints[selectedWeekIndex] && (
                        <Path
                          d={`M ${chartPoints[selectedWeekIndex].x} 10 L ${chartPoints[selectedWeekIndex].x} ${chartSvgHeight - 20}`}
                          stroke={isDark ? '#f8fafc' : '#0f172a'}
                          strokeWidth="2"
                        />
                      )}

                      {chartPoints.map((pt, i) => {
                        const isSelected = i === selectedWeekIndex;
                        return (
                          <Circle
                            key={i}
                            cx={pt.x}
                            cy={pt.y}
                            r={isSelected ? 7 : 4}
                            fill={isSelected ? '#ea580c' : '#ffffff'}
                            stroke="#ea580c"
                            strokeWidth="2.5"
                          />
                        );
                      })}
                    </Svg>

                    <View style={styles.yAxisLabels}>
                      <Text style={[styles.axisText, { color: theme.textMuted }]}>{chartMaxY} km</Text>
                      <Text style={[styles.axisText, { color: theme.textMuted }]}>{(chartMaxY / 2).toFixed(0)} km</Text>
                      <Text style={[styles.axisText, { color: theme.textMuted }]}>0 km</Text>
                    </View>
                  </View>

                  <View style={styles.xAxisRow}>
                    {xAxisMonths.map((mName, idx) => (
                      <Text key={idx} style={[styles.axisText, { color: theme.textMuted }]}>{mName}</Text>
                    ))}
                  </View>

                  <TouchableOpacity
                    style={[styles.btnMoreProgress, { borderColor: theme.border }]}
                    onPress={() => {
                      setModalConfig({
                        visible: true,
                        type: 'info',
                        title: 'Total Statistik Kategori',
                        message: `Total Jarak: ${weeklyProgress.reduce((a, b) => a + b.distKm, 0).toFixed(1)} km\nTotal Waktu: ${Math.floor(weeklyProgress.reduce((a, b) => a + b.durationSec, 0) / 3600)} jam\nTotal Elevasi: ${weeklyProgress.reduce((a, b) => a + b.elevationM, 0)} m`,
                        confirmText: 'Tutup',
                        onConfirm: () => setModalConfig((prev) => ({ ...prev, visible: false })),
                      });
                    }}
                  >
                    <Text style={[styles.btnMoreProgressText, { color: theme.textMain }]}>Lihat ringkasan akumulasi</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}

            {/* TAB RIWAYAT */}
            {profileSubTab === 'history' && (
              <FlatList
                data={history}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollPadding}
                ListEmptyComponent={
                  <View style={styles.emptyBox}>
                    <Ionicons name="folder-open-outline" size={36} color={theme.textMuted} />
                    <Text style={[styles.metaText, { color: theme.textMuted, marginTop: 6 }]}>
                      Belum ada riwayat aktivitas tersimpan.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.cardClean, { backgroundColor: theme.card, borderColor: theme.border, marginBottom: 14 }]}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.activityBadge}>{(item.type || 'run').toUpperCase()}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Text style={[styles.metaText, { color: theme.textMuted }]}>{item.dateStr || ''}</Text>
                        <TouchableOpacity onPress={() => handleDeleteItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="trash-outline" size={17} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={[styles.activityTitle, { color: theme.textMain }]}>{item.title || 'Aktivitas Latihan'}</Text>

                    {item.route && item.route.length > 0 && (
                      <View style={[styles.miniMapWrap, { borderColor: theme.border }]}>
                        <WebView
                          originWhitelist={['*']}
                          source={{ html: generateInteractiveRouteHtml(item.route) }}
                          style={styles.miniMap}
                          scrollEnabled={false}
                        />
                      </View>
                    )}

                    <View style={styles.historyStatsRow}>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>JARAK</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.distanceDisplay || '0 m'}</Text>
                      </View>

                      {item.type === 'bike' ? (
                        <>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                            <Text style={[styles.statSubVal, { color: '#34d399' }]}>+{item.elevationGain || 0} m</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                            <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.durationFormatted || '00:00'}</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>KECEPATAN</Text>
                            <Text style={[styles.statSubVal, { color: '#f59e0b' }]}>
                              {item.avgSpeedKmh ? `${item.avgSpeedKmh} km/j` : '--'}
                            </Text>
                          </View>
                        </>
                      ) : item.type === 'run' ? (
                        <>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>ELEVASI</Text>
                            <Text style={[styles.statSubVal, { color: '#34d399' }]}>+{item.elevationGain || 0} m</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                            <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.durationFormatted || '00:00'}</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>PACE</Text>
                            <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.paceFormatted || '--:--'}</Text>
                          </View>
                        </>
                      ) : (
                        <>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>LANGKAH</Text>
                            <Text style={[styles.statSubVal, { color: '#38bdf8' }]}>{item.steps || 0}</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>WAKTU</Text>
                            <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.durationFormatted || '00:00'}</Text>
                          </View>
                          <View>
                            <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>PACE</Text>
                            <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.paceFormatted || '--:--'}</Text>
                          </View>
                        </>
                      )}
                    </View>

                    <View style={styles.cardActionRow}>
                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: '#ea580c' }]} onPress={() => setSelectedDownloadItem(item)}>
                        <Ionicons name="image-outline" size={15} color="#ea580c" />
                        <Text style={[styles.outlineBtnText, { color: '#ea580c' }]}>Gambar</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: '#0284c7' }]} onPress={() => setSelectedGpxItem(item)}>
                        <Ionicons name="document-text-outline" size={15} color="#0284c7" />
                        <Text style={[styles.outlineBtnText, { color: '#0284c7' }]}>GPX</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        )}
      </View>

      {/* ==================== BOTTOM TAB BAR ==================== */}
      <View
        style={[
          styles.bottomTabBar,
          {
            backgroundColor: theme.bottomBar,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 12),
            height: 64 + Math.max(insets.bottom, 12),
          },
        ]}
      >
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('home')}>
          <Ionicons name={activeTab === 'home' ? 'home' : 'home-outline'} size={22} color={activeTab === 'home' ? '#ea580c' : theme.textMuted} />
          <Text style={[styles.tabLabel, { color: activeTab === 'home' ? '#ea580c' : theme.textMuted }]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('radar')}>
          <Ionicons name={activeTab === 'radar' ? 'map' : 'map-outline'} size={22} color={activeTab === 'radar' ? '#ea580c' : theme.textMuted} />
          <Text style={[styles.tabLabel, { color: activeTab === 'radar' ? '#ea580c' : theme.textMuted }]}>Maps</Text>
        </TouchableOpacity>

        <View style={styles.startBtnAnchor}>
          <TouchableOpacity style={styles.floatingStartBtn} activeOpacity={0.85} onPress={() => router.push('/tracker')}>
            <Ionicons name="play" size={26} color="#ffffff" style={{ marginLeft: 3 }} />
          </TouchableOpacity>
          <Text style={[styles.tabLabel, { color: '#ea580c', fontWeight: '800', marginTop: 2 }]}>Mulai</Text>
        </View>

        <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/bmi')}>
          <Ionicons name="scale-outline" size={22} color={theme.textMuted} />
          <Text style={[styles.tabLabel, { color: theme.textMuted }]}>BMI</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('profile')}>
          <Ionicons name={activeTab === 'profile' ? 'person' : 'person-outline'} size={22} color={activeTab === 'profile' ? '#ea580c' : theme.textMuted} />
          <Text style={[styles.tabLabel, { color: activeTab === 'profile' ? '#ea580c' : theme.textMuted }]}>Anda</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== MODAL STREAK KALENDER ==================== */}
      <Modal visible={streakModalVisible} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.streakModalBackdrop}>
          <TouchableOpacity
            style={styles.streakBackdropDismiss}
            activeOpacity={1}
            onPress={() => setStreakModalVisible(false)}
          />

          <View
            style={[
              styles.streakCalendarSheet,
              {
                backgroundColor: theme.card,
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}
          >
            <View {...streakPanResponder.panHandlers} style={styles.dragHandleArea}>
              <View style={styles.streakSheetHandle} />
            </View>

            <View style={{ backgroundColor: theme.card, paddingBottom: 10 }}>
              <View style={styles.streakCalendarTopBar}>
                <Text style={[styles.calendarMonthHeading, { color: theme.textMain }]}>{monthName}</Text>
                <TouchableOpacity style={styles.btnSharePill} onPress={() => setStreakModalVisible(false)}>
                  <Ionicons name="close" size={16} color={theme.textMain} />
                  <Text style={[styles.btnSharePillText, { color: theme.textMain }]}>Tutup</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.streakMetricsHeader}>
                <View>
                  <Text style={[styles.streakSubLabel, { color: theme.textMuted }]}>Beruntun Anda</Text>
                  <Text style={[styles.streakBigVal, { color: theme.textMain }]}>{calculatedWeeklyStreak} Minggu</Text>
                </View>
                <View>
                  <Text style={[styles.streakSubLabel, { color: theme.textMuted }]}>Aktivitas Beruntun</Text>
                  <Text style={[styles.streakBigVal, { color: theme.textMain }]}>{daily?.streak || 1}</Text>
                </View>
              </View>

              <View style={styles.calendarBodyRow}>
                <View style={styles.calendarDaysGrid}>
                  <View style={styles.dayNamesRow}>
                    {['S', 'S', 'R', 'K', 'J', 'S', 'M'].map((dName, idx) => (
                      <Text key={idx} style={[styles.dayNameCell, { color: theme.textMuted }]}>{dName}</Text>
                    ))}
                  </View>

                  <View style={styles.dateCellsWrapper}>
                    {currentMonthCells.map((cell, idx) => {
                      if (cell.empty) return <View key={idx} style={styles.dateCell} />;
                      const hasAct = cell.activity !== null;
                      const isToday = cell.date === nowForCal.getDate();
                      return (
                        <View key={idx} style={styles.dateCell}>
                          {hasAct ? (
                            <View style={styles.activityBadgeIcon}>
                              <Ionicons
                                name={cell.activity === 'bike' ? 'bicycle' : cell.activity === 'walk' ? 'footsteps' : 'walk'}
                                size={14}
                                color="#ffffff"
                              />
                            </View>
                          ) : (
                            <View style={[styles.regularDateCircle, isToday && styles.currentDateOutline]}>
                              <Text style={[styles.regularDateText, { color: theme.textMain }]}>{cell.date}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.streakColumnPill}>
                  {Array.from({ length: totalCalendarRows }).map((_, rIdx) => {
                    const isFlameRow = rIdx === todayWeekRowIndex;
                    return (
                      <View key={rIdx} style={styles.streakSlotRow}>
                        {isFlameRow ? (
                          <SolidFlameWithNumber count={calculatedWeeklyStreak} size={28} />
                        ) : (
                          <View style={styles.streakEmptySlotDot} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.btnCloseCalendar} onPress={() => setStreakModalVisible(false)}>
              <Text style={styles.btnCloseCalendarText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL UNDUH & BAGIKAN GAMBAR ==================== */}
      <Modal visible={selectedDownloadItem !== null} transparent animationType="fade">
        <View style={styles.downloadModalBackdrop}>
          <View style={styles.downloadCardWrapper}>
            <View style={styles.downloadActionsTop}>
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '800' }}>Hasil Aktivitas</Text>
              <TouchableOpacity onPress={() => setSelectedDownloadItem(null)}>
                <Ionicons name="close-circle" size={26} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {selectedDownloadItem && (
              <View style={styles.transparentCanvasContainer} collapsable={false}>
                <ViewShot
                  ref={downloadCardRef}
                  options={{ format: 'png', quality: 1.0 }}
                  style={styles.transparentCaptureCanvas}
                >
                  <View style={styles.canvasTextGroup}>
                    <Text style={styles.canvasHeaderLabel}>Jarak</Text>
                    <Text style={styles.canvasBigValue}>{selectedDownloadItem.distanceDisplay || '0 m'}</Text>
                  </View>

                  <View style={styles.canvasTextGroup}>
                    <Text style={styles.canvasHeaderLabel}>
                      {selectedDownloadItem.type === 'walk'
                        ? 'Langkah'
                        : selectedDownloadItem.type === 'bike'
                        ? 'Kecepatan'
                        : 'Pace'}
                    </Text>
                    <Text style={styles.canvasBigValue}>
                      {selectedDownloadItem.type === 'walk'
                        ? `${selectedDownloadItem.steps || 0}`
                        : selectedDownloadItem.type === 'bike'
                        ? `${selectedDownloadItem.avgSpeedKmh || 0} km/j`
                        : `${selectedDownloadItem.paceFormatted || "--'--\""} /km`}
                    </Text>
                  </View>

                  <View style={styles.canvasTextGroup}>
                    <Text style={styles.canvasHeaderLabel}>Waktu</Text>
                    <Text style={styles.canvasBigValue}>{selectedDownloadItem.durationFormatted || '00:00'}</Text>
                  </View>

                  <View style={styles.canvasRouteWrap}>
                    {selectedDownloadItem.route && selectedDownloadItem.route.length > 1 ? (
                      <Svg width={220} height={220}>
                        <Polyline
                          points={convertRouteToSvgPoints(selectedDownloadItem.route, 220, 220)}
                          fill="none"
                          stroke="#ea580c"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    ) : (
                      <Ionicons
                        name={selectedDownloadItem.type === 'bike' ? 'bicycle' : selectedDownloadItem.type === 'walk' ? 'footsteps' : 'walk'}
                        size={54}
                        color="#ea580c"
                      />
                    )}
                  </View>

                  <View style={styles.canvasWatermarkRow}>
                    <Image
                      source={require('../../assets/images/icon.png')}
                      style={styles.canvasWatermarkIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.canvasWatermarkText}>XOFIT</Text>
                  </View>
                </ViewShot>
              </View>
            )}

            <View style={styles.twoButtonModalRow}>
              <TouchableOpacity style={styles.btnDualDownload} onPress={handleExecuteSaveImage}>
                <Ionicons name="download" size={18} color="#ffffff" />
                <Text style={styles.btnDualText}>Unduh Gambar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnDualShare} onPress={handleExecuteShareImage}>
                <Ionicons name="share-social" size={18} color="#ffffff" />
                <Text style={styles.btnDualText}>Bagikan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL PILIHAN AKSI GPX ==================== */}
      <Modal visible={selectedGpxItem !== null} transparent animationType="fade">
        <View style={styles.downloadModalBackdrop}>
          <View style={[styles.gpxDialogCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.gpxDialogHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={20} color="#0284c7" />
                <Text style={[styles.sectionTitle, { color: theme.textMain }]}>Ekspor Berkas GPX</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedGpxItem(null)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.gpxDialogDesc, { color: theme.textMuted }]}>
              Pilih tindakan untuk berkas koordinat rute GPS "{selectedGpxItem?.title || 'Aktivitas'}":
            </Text>

            <View style={styles.twoButtonModalRow}>
              <TouchableOpacity style={styles.btnGpxDownload} onPress={handleExecuteDownloadGpx}>
                <Ionicons name="cloud-download-outline" size={18} color="#ffffff" />
                <Text style={styles.btnDualText}>Unduh GPX</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnGpxShare} onPress={handleExecuteShareGpx}>
                <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                <Text style={styles.btnDualText}>Bagikan GPX</Text>
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
        onCancel={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentArea: { flex: 1 },
  scrollPadding: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 14 },
  brandTitle: { color: '#ea580c', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  greetingTitle: { fontSize: 24, fontWeight: '800' },
  cardClean: { borderRadius: 18, padding: 16, borderWidth: 1, marginBottom: 14 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  titleWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  subNote: { fontSize: 12, fontWeight: '600' },
  metaText: { fontSize: 12 },

  bgSyncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#052e16', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#22c55e' },
  bgSyncText: { color: '#22c55e', fontSize: 10, fontWeight: '800' },
  ringsContainerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  ringsSvgWrapper: { width: 150, height: 150, justifyContent: 'center', alignItems: 'center' },
  ringsLegendCol: { flex: 1, paddingLeft: 16, gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendIndicatorDot: { width: 10, height: 10, borderRadius: 5 },
  legendTitle: { fontSize: 11, fontWeight: '600' },
  legendValue: { fontSize: 14, fontWeight: '900', marginTop: 1 },
  legendGoal: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },

  latestActTitle: { fontSize: 16, fontWeight: '900', marginBottom: 8 },

  streakWidgetCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
  streakWidgetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  streakWidgetTitle: { fontSize: 16, fontWeight: '800' },
  streakWidgetSub: { fontSize: 12, fontWeight: '600' },
  streakWidgetContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flameContainer: { alignItems: 'center' },

  solidFlameNumberBadge: {
    position: 'absolute',
    bottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solidFlameNumberText: {
    fontWeight: '900',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  flameWeekText: { fontSize: 13, fontWeight: '800', color: '#ea580c', marginTop: 2 },
  dotMatrix: { gap: 6 },
  dotMatrixRow: { flexDirection: 'row', gap: 6 },
  matrixDot: { width: 10, height: 10, borderRadius: 5 },
  matrixDotRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#0f172a', backgroundColor: 'transparent' },

  fullscreenMapContainer: { flex: 1, position: 'relative' },
  fullscreenWebView: { flex: 1, width: '100%', height: '100%' },
  routeSheetContainer: { position: 'absolute', bottom: 12, left: 12, right: 12, borderRadius: 20, padding: 14, borderWidth: 1 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  routeFilterRow: { flexDirection: 'row', gap: 4, borderRadius: 10, padding: 3 },
  smallFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  smallFilterActive: { backgroundColor: '#ea580c' },
  smallFilterText: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  smallFilterTextActive: { color: '#ffffff' },
  routeCardItem: { width: 220, borderRadius: 14, padding: 12, borderWidth: 1.5 },
  routeCardTitle: { fontSize: 13, fontWeight: '800', marginBottom: 2 },
  routeCardDesc: { fontSize: 11, lineHeight: 15, marginBottom: 8 },
  routeMetricsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1 },
  routeMetricVal: { fontSize: 14, fontWeight: '900' },
  badgeLoopWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(234, 88, 12, 0.12)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeLoopText: { fontSize: 11, fontWeight: '800', color: '#ea580c' },

  profileContainer: { flex: 1 },
  profileHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  segmentedRow: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  segBtnActive: { backgroundColor: '#ea580c' },
  segText: { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  segTextActive: { color: '#ffffff' },

  filterSportPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5 },
  filterSportPillActive: { borderColor: '#ea580c' },
  filterSportText: { fontSize: 13, fontWeight: '700' },

  weekDateHeader: { fontSize: 16, fontWeight: '900' },
  metricsTripleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  metricTripleLabel: { fontSize: 12, fontWeight: '600' },
  metricTripleVal: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  chartWrapper: { position: 'relative', marginTop: 6 },
  yAxisLabels: { position: 'absolute', right: 0, top: 4, bottom: 20, justifyContent: 'space-between' },
  axisText: { fontSize: 10, fontWeight: '700' },
  xAxisRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 6, paddingHorizontal: 20 },
  btnMoreProgress: { borderWidth: 1, borderRadius: 24, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  btnMoreProgressText: { fontSize: 13, fontWeight: '800' },

  activityBadge: { color: '#ea580c', fontSize: 11, fontWeight: '800' },
  activityTitle: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  miniMapWrap: { height: 130, borderRadius: 12, overflow: 'hidden', borderWidth: 1, marginVertical: 8 },
  miniMap: { width: '100%', height: '100%' },
  historyStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  statSubLabel: { fontSize: 9, fontWeight: '800' },
  statSubVal: { fontSize: 13, fontWeight: '800', marginTop: 1 },

  cardActionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  outlineBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.2 },
  outlineBtnText: { fontSize: 12, fontWeight: '800' },
  emptyBox: { padding: 40, alignItems: 'center' },

  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  tabItem: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  tabLabel: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  startBtnAnchor: { alignItems: 'center', justifyContent: 'center', marginTop: -24, flex: 1 },
  floatingStartBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ea580c', alignItems: 'center', justifyContent: 'center', elevation: 6 },

  streakModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end', margin: 0 },
  streakBackdropDismiss: { flex: 1 },
  dragHandleArea: { width: '100%', paddingVertical: 10, alignItems: 'center' },
  streakCalendarSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 24,
  },
  streakSheetHandle: { width: 48, height: 5, borderRadius: 3, backgroundColor: '#94a3b8', alignSelf: 'center' },
  streakCalendarTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  calendarMonthHeading: { fontSize: 20, fontWeight: '900' },
  btnSharePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  btnSharePillText: { fontSize: 12, fontWeight: '800' },
  streakMetricsHeader: { flexDirection: 'row', gap: 36, marginBottom: 16 },
  streakSubLabel: { fontSize: 11, fontWeight: '600' },
  streakBigVal: { fontSize: 20, fontWeight: '900', marginTop: 2 },
  calendarBodyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  calendarDaysGrid: { flex: 1, marginRight: 8 },
  dayNamesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  dayNameCell: { width: (width - 104) / 7, textAlign: 'center', fontSize: 12, fontWeight: '800' },
  dateCellsWrapper: { flexDirection: 'row', flexWrap: 'wrap' },
  dateCell: { width: (width - 104) / 7, height: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  activityBadgeIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  regularDateCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  regularDateText: { fontSize: 13, fontWeight: '700' },
  currentDateOutline: { borderWidth: 1.5, borderColor: '#0f172a' },

  streakColumnPill: {
    width: 40,
    backgroundColor: '#ffedd5',
    borderRadius: 20,
    alignItems: 'center',
    paddingVertical: 4,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  streakSlotRow: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakEmptySlotDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#fed7aa',
  },

  btnCloseCalendar: { backgroundColor: '#ea580c', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  btnCloseCalendarText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },

  downloadModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  downloadCardWrapper: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  downloadActionsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  transparentCanvasContainer: {
    width: '100%',
    alignItems: 'center',
  },
  transparentCaptureCanvas: {
    width: '100%',
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  canvasTextGroup: {
    alignItems: 'center',
    marginBottom: 16,
  },
  canvasHeaderLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  canvasBigValue: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  canvasRouteWrap: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  canvasWatermarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  canvasWatermarkIcon: {
    width: 24,
    height: 24,
  },
  canvasWatermarkText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },

  twoButtonModalRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 16,
  },
  btnDualDownload: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ea580c',
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnDualShare: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnDualText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  gpxDialogCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  gpxDialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  gpxDialogDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  btnGpxDownload: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnGpxShare: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ea580c',
    paddingVertical: 14,
    borderRadius: 14,
  },
});