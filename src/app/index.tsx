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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import Svg, { Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Polyline } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getHistory,
  getDailyStats,
  updateDailyStats,
  ActivityHistory,
  DailyGoal,
} from '../utils/storage';
import { exportActivityToGpx } from '../utils/gpxHelper';
import { requestBackgroundStepPermissions } from '../utils/backgroundStepTask';
import NotificationModal from '../components/NotificationModal';

const { width } = Dimensions.get('window');

interface RoutineStep {
  name: string;
  durationSec: number;
  imageUrl: string;
  instruction: string;
}

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

const WARMUP_ROUTINE: RoutineStep[] = [
  {
    name: 'Dynamic Arm Circles',
    durationSec: 30,
    imageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&auto=format&fit=crop&q=80',
    instruction: 'Berdiri tegak, putar kedua lengan membentuk lingkaran penuh secara terkontrol.',
  },
  {
    name: 'High Knees',
    durationSec: 40,
    imageUrl: 'https://images.unsplash.com/photo-1434682881908-b43d0467b798?w=800&auto=format&fit=crop&q=80',
    instruction: 'Angkat paha bergantian setinggi pusar untuk memicu detak jantung awal.',
  },
  {
    name: 'Leg Swings Lateral',
    durationSec: 35,
    imageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&auto=format&fit=crop&q=80',
    instruction: 'Ayunkan kaki lurus ke samping untuk melonggarkan persendian panggul.',
  },
  {
    name: 'Calf & Ankle Bounce',
    durationSec: 35,
    imageUrl: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&auto=format&fit=crop&q=80',
    instruction: 'Lompat kecil bertumpu pada bantalan kaki depan untuk menyiapkan otot betis.',
  },
];

const COOLDOWN_ROUTINE: RoutineStep[] = [
  {
    name: 'Standing Quad Stretch',
    durationSec: 45,
    imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&auto=format&fit=crop&q=80',
    instruction: 'Tarik pergelangan kaki ke belakang hingga merapat ke bokong, jaga postur tubuh tetap tegak.',
  },
  {
    name: 'Hamstring Fold Stretch',
    durationSec: 45,
    imageUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&auto=format&fit=crop&q=80',
    instruction: 'Luruskan satu kaki ke depan, tekuk pinggang secara rileks ke arah ujung jari kaki.',
  },
  {
    name: 'Wall Calf Stretch',
    durationSec: 45,
    imageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&auto=format&fit=crop&q=80',
    instruction: 'Tekan kedua tangan ke dinding dengan satu kaki di belakang sampai otot betis terasa tertarik relaks.',
  },
  {
    name: 'Torso Twist Relaxation',
    durationSec: 45,
    imageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&auto=format&fit=crop&q=80',
    instruction: 'Putar pinggang perlahan ke kiri dan kanan diiringi hembusan napas panjang.',
  },
];

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

  const [selectedShareItem, setSelectedShareItem] = useState<ActivityHistory | null>(null);
  const [selectedDownloadItem, setSelectedDownloadItem] = useState<ActivityHistory | null>(null);

  const shareCardRef = useRef<ViewShot>(null);
  const downloadCardRef = useRef<ViewShot>(null);
  const streakShareRef = useRef<ViewShot>(null);

  const [streakModalVisible, setStreakModalVisible] = useState(false);

  // Guided Routine
  const [routineModalVisible, setRoutineModalVisible] = useState(false);
  const [routineType, setRoutineType] = useState<'warmup' | 'cooldown'>('warmup');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepSecondsLeft, setStepSecondsLeft] = useState(30);
  const [isRoutineRunning, setIsRoutineRunning] = useState(false);
  const routineIntervalRef = useRef<any>(null);

  // Radar Maps
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

  const syncBackgroundSteps = async () => {
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (isAvailable) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        const pedo = await Pedometer.getStepCountAsync(start, end);
        if (pedo && pedo.steps >= 0) {
          const updated = await updateDailyStats({ steps: pedo.steps });
          setDaily(updated);
        }
      }
    } catch (e) {
      console.log('Background Pedometer check error:', e);
    }
  };

  const loadData = async () => {
    const [h, d] = await Promise.all([getHistory(), getDailyStats()]);
    setHistory(h);
    setDaily(d);
    await syncBackgroundSteps();
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
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
        setGpsData(prev => ({
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
    const hasActivityThisWeek = history.some(h => (h.timestamp || 0) >= startOfCurrentWeek.getTime());
    if (hasActivityThisWeek) streakWeeks++;

    for (let i = 1; i <= 52; i++) {
      const prevWeekStart = new Date(startOfCurrentWeek);
      prevWeekStart.setDate(startOfCurrentWeek.getDate() - (i * 7));
      const prevWeekEnd = new Date(prevWeekStart);
      prevWeekEnd.setDate(prevWeekStart.getDate() + 7);

      const hasAct = history.some(h => {
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
      const coordString = points.map(p => `${p[1]},${p[0]}`).join(';');
      const routingEngine = type === 'run' ? 'foot' : 'bike';
      const url = `https://routing.openstreetmap.de/routed-${routingEngine}/route/v1/driving/${coordString}?overview=full&geometries=geojson&continue_straight=true`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.routes && json.routes.length > 0) {
        const roadCoords = json.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        const roadDist = (json.routes[0].distance / 1000).toFixed(2);
        return { coords: roadCoords, dist: parseFloat(roadDist) };
      }
    } catch (e) {
      try {
        const coordString = points.map(p => `${p[1]},${p[0]}`).join(';');
        const urlFallback = `https://router.project-osrm.org/route/v1/${type === 'run' ? 'foot' : 'bike'}/${coordString}?overview=full&geometries=geojson&continue_straight=true`;
        const resFb = await fetch(urlFallback);
        const jsonFb = await resFb.json();
        if (jsonFb.routes && jsonFb.routes.length > 0) {
          const roadCoords = jsonFb.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          const roadDist = (jsonFb.routes[0].distance / 1000).toFixed(2);
          return { coords: roadCoords, dist: parseFloat(roadDist) };
        }
      } catch (err) {}
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
            title: 'Loop Trotoar Blok Timur',
            type: 'run',
            difficulty: 'Mudah',
            desc: 'Jalur memutar satu arah melintasi trotoar pemukiman tanpa rute bertumpuk.',
            elevationM: 5,
            pts: [
              [lat, lng],
              [lat + 0.003, lng + 0.004],
              [lat + 0.0055, lng + 0.001],
              [lat + 0.0025, lng - 0.003],
              [lat, lng],
            ],
          },
          {
            id: 'run-safe-2',
            title: 'Sirkuit Lingkar Taman',
            type: 'run',
            difficulty: 'Sedang',
            desc: 'Jalur pedestrian lebar mengitari ruang terbuka hijau tanpa gang buntu.',
            elevationM: 9,
            pts: [
              [lat, lng],
              [lat - 0.0035, lng + 0.004],
              [lat - 0.0065, lng - 0.001],
              [lat - 0.0025, lng - 0.004],
              [lat, lng],
            ],
          },
        ];
      } else {
        blueprints = [
          {
            id: 'bike-safe-1',
            title: 'Arteri Sekunder Loop Cepat',
            type: 'bike',
            difficulty: 'Sedang',
            desc: 'Gowes melingkar searah jarum jam di lajur kiri jalan aspal mulus.',
            elevationM: 32,
            pts: [
              [lat, lng],
              [lat + 0.015, lng + 0.02],
              [lat + 0.028, lng + 0.005],
              [lat + 0.012, lng - 0.018],
              [lat, lng],
            ],
          },
          {
            id: 'bike-safe-2',
            title: 'Grand Loop Jalur Luar',
            type: 'bike',
            difficulty: 'Tantangan',
            desc: 'Sirkuit endurance jarak jauh melingkari kawasan perimeter jalan raya utama.',
            elevationM: 85,
            pts: [
              [lat, lng],
              [lat - 0.022, lng + 0.025],
              [lat - 0.042, lng + 0.01],
              [lat - 0.02, lng - 0.022],
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
        const nextList = history.filter(h => h.id !== id);
        await AsyncStorage.setItem('@run_history', JSON.stringify(nextList));
        setHistory(nextList);
        setModalConfig(prev => ({ ...prev, visible: false }));
      },
    });
  };

  const handleExecuteShare = async () => {
    try {
      if (!shareCardRef.current) return;
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1.0 });
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.log('Share error:', e);
    }
  };

  const handleExecuteDownload = async () => {
    try {
      if (!downloadCardRef.current) return;
      const uri = await captureRef(downloadCardRef, { format: 'png', quality: 1.0 });

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert('Berhasil Disimpan', 'Gambar hasil aktivitas berlatar transparan telah disimpan ke galeri ponsel kamu.');
        setSelectedDownloadItem(null);
      } else {
        await Sharing.shareAsync(uri);
        setSelectedDownloadItem(null);
      }
    } catch (e) {
      console.log('Download error:', e);
      Alert.alert('Gagal Mengunduh', 'Tidak dapat memproses berkas gambar hasil aktivitas.');
    }
  };

  const handleShareStreak = async () => {
    try {
      if (!streakShareRef.current) return;
      const uri = await captureRef(streakShareRef, { format: 'png', quality: 1.0 });
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.log('Streak Share error:', e);
    }
  };

  const handleExportGpxFile = async (item: ActivityHistory) => {
    const success = await exportActivityToGpx(item);
    if (!success) {
      setModalConfig({
        visible: true,
        type: 'warning',
        title: 'Ekspor GPX',
        message: 'Tidak ada koordinat rute GPS untuk diekspor.',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, visible: false })),
      });
    }
  };

  const activeRoutine = routineType === 'warmup' ? WARMUP_ROUTINE : COOLDOWN_ROUTINE;
  const currentStep = activeRoutine[currentStepIndex] || activeRoutine[0];

  const startRoutine = (type: 'warmup' | 'cooldown') => {
    setRoutineType(type);
    setCurrentStepIndex(0);
    const routine = type === 'warmup' ? WARMUP_ROUTINE : COOLDOWN_ROUTINE;
    setStepSecondsLeft(routine[0].durationSec);
    setIsRoutineRunning(true);
    setRoutineModalVisible(true);
  };

  useEffect(() => {
    if (isRoutineRunning && routineModalVisible) {
      routineIntervalRef.current = setInterval(() => {
        setStepSecondsLeft(prev => {
          if (prev <= 1) {
            if (currentStepIndex + 1 < activeRoutine.length) {
              const nextIndex = currentStepIndex + 1;
              setCurrentStepIndex(nextIndex);
              return activeRoutine[nextIndex].durationSec;
            } else {
              clearInterval(routineIntervalRef.current);
              setIsRoutineRunning(false);
              return 0;
            }
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (routineIntervalRef.current) clearInterval(routineIntervalRef.current);
    }
    return () => {
      if (routineIntervalRef.current) clearInterval(routineIntervalRef.current);
    };
  }, [isRoutineRunning, routineModalVisible, currentStepIndex, activeRoutine]);

  const theme = {
    bg: isDark ? '#0b0f19' : '#f8fafc',
    card: isDark ? '#111827' : '#ffffff',
    border: isDark ? '#1f2937' : '#e2e8f0',
    textMain: isDark ? '#f9fafb' : '#0f172a',
    textMuted: isDark ? '#9ca3af' : '#64748b',
    subCard: isDark ? '#1f2937' : '#f1f5f9',
    bottomBar: isDark ? '#0b0f19' : '#ffffff',
  };

  const todaySteps = daily?.steps || 0;
  const targetSteps = daily?.targetSteps || 10000;
  const stepPercent = Math.min(100, Math.round((todaySteps / targetSteps) * 100));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayActivities = history.filter(h => (h.timestamp || 0) >= todayStart.getTime());
  const todayCalories =
    todayActivities.reduce((acc, h) => acc + (h.calories || 0), 0) + Math.round(todaySteps * 0.04);
  const targetCalories = 500;
  const calPercent = Math.min(100, Math.round((todayCalories / targetCalories) * 100));

  const todayActiveMinutes =
    Math.round(todayActivities.reduce((acc, h) => acc + (h.durationSec || 0), 0) / 60) +
    Math.round(todaySteps / 115);
  const targetActiveMinutes = 45;
  const minPercent = Math.min(100, Math.round((todayActiveMinutes / targetActiveMinutes) * 100));

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
    const found = history.find(h => {
      const dt = new Date(h.timestamp || 0);
      return dt.getFullYear() === currentYear && dt.getMonth() === currentMonth && dt.getDate() === d;
    });
    const cellIdx = firstDayOfMonth + d - 1;
    currentMonthCells.push({
      empty: false,
      date: d,
      activity: found ? (found.type || 'run') : null,
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

    const filteredHistory = history.filter(h => {
      if (progressFilter === 'all') return true;
      return h.type === progressFilter;
    });

    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() - (i * 7));

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const itemsInWeek = filteredHistory.filter(h => {
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

  const maxWeeklyKmReal = Math.max(...weeklyProgress.map(w => w.distKm), 0);
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
      onPanResponderGrant: (evt) => {
        handleChartTouch(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        handleChartTouch(evt.nativeEvent.locationX);
      },
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
    const coordsJson = JSON.stringify((route || []).map(r => [r.latitude, r.longitude]));
    const fallbackLat = route && route.length > 0 ? route[0].latitude : -6.175392;
    const fallbackLng = route && route.length > 0 ? route[0].longitude : 106.827153;

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

  // Helper Pengubah Koordinat Route ke SVG Polyline Terpusat untuk Kartu Download Transparan
  const convertRouteToSvgPoints = (route: { latitude: number; longitude: number }[], svgW: number, svgH: number) => {
    if (!route || route.length < 2) return '';
    const lats = route.map(r => r.latitude);
    const lngs = route.map(r => r.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const deltaLat = maxLat - minLat || 0.001;
    const deltaLng = maxLng - minLng || 0.001;

    const pad = 20;
    const drawW = svgW - pad * 2;
    const drawH = svgH - pad * 2;

    return route
      .map(pt => {
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

            {/* Target 3 Cincin Harian */}
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
                      setModalConfig({
                        visible: true,
                        type: 'success',
                        title: 'Izin Latar Belakang Aktif',
                        message: 'Sensor langkah tetap berjalan saat aplikasi diminimalkan atau ditutup.',
                        confirmText: 'OK',
                        onConfirm: () => setModalConfig(prev => ({ ...prev, visible: false })),
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

            {/* Aktivitas Terakhir */}
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
                  <View>
                    <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>DURASI</Text>
                    <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.durationFormatted}</Text>
                  </View>
                  <View>
                    <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>PACE</Text>
                    <Text style={[styles.statSubVal, { color: theme.textMain }]}>{latestActivity.paceFormatted}</Text>
                  </View>
                  <View>
                    <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>KALORI</Text>
                    <Text style={[styles.statSubVal, { color: '#ea580c' }]}>{latestActivity.calories} kcal</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Widget Streak Beruntun - Ikon Api Tengah Ada Angka */}
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
                  <View style={styles.flameCircleIconOnly}>
                    <Ionicons name="flame" size={54} color="#ea580c" />
                    <Text style={styles.flameCountTextCenter}>{calculatedWeeklyStreak}</Text>
                  </View>
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

            {/* Pemanasan & Pendinginan */}
            <View style={[styles.cardClean, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.titleWithIcon}>
                  <Ionicons name="fitness" size={18} color="#ea580c" />
                  <Text style={[styles.sectionTitle, { color: theme.textMain }]}>Pemanasan & Pendinginan</Text>
                </View>
                <Text style={[styles.subNote, { color: theme.textMuted }]}>Terpandu Timer</Text>
              </View>

              <View style={styles.workoutBtnRow}>
                <TouchableOpacity
                  style={[styles.workoutBtn, { backgroundColor: theme.subCard, borderColor: theme.border }]}
                  onPress={() => startRoutine('warmup')}
                >
                  <Ionicons name="body" size={20} color="#ea580c" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.workoutBtnTitle, { color: theme.textMain }]}>Pemanasan</Text>
                    <Text style={[styles.metaText, { color: theme.textMuted }]}>4 Gerakan • Peregangan</Text>
                  </View>
                  <Ionicons name="play-circle" size={24} color="#ea580c" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.workoutBtn, { backgroundColor: theme.subCard, borderColor: theme.border }]}
                  onPress={() => startRoutine('cooldown')}
                >
                  <Ionicons name="heart-circle" size={20} color="#38bdf8" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.workoutBtnTitle, { color: theme.textMain }]}>Pendinginan</Text>
                    <Text style={[styles.metaText, { color: theme.textMuted }]}>4 Gerakan • Relaksasi</Text>
                  </View>
                  <Ionicons name="play-circle" size={24} color="#38bdf8" />
                </TouchableOpacity>
              </View>
            </View>
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
                  var endPin = null;

                  window.showRecommendedRoute = function(pts) {
                    if (activePoly) map.removeLayer(activePoly);
                    if (startPin) map.removeLayer(startPin);
                    if (endPin) map.removeLayer(endPin);

                    if (pts && pts.length > 0) {
                      activePoly = L.polyline(pts, { color: '#ea580c', weight: 5, opacity: 0.9 }).addTo(map);
                      startPin = L.circleMarker(pts[0], { radius: 6, fillColor: '#22c55e', color: '#fff', fillOpacity: 1 }).addTo(map);
                      endPin = L.circleMarker(pts[pts.length - 1], { radius: 6, fillColor: '#ef4444', color: '#fff', fillOpacity: 1 }).addTo(map);
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
                    Rute {routeFilter === 'run' ? 'Lari (Trotoar/Aman)' : 'Gowes Sepeda'}
                  </Text>
                </View>

                <View style={[styles.routeFilterRow, { backgroundColor: theme.subCard }]}>
                  <TouchableOpacity
                    style={[styles.smallFilterBtn, routeFilter === 'run' && styles.smallFilterActive]}
                    onPress={() => setRouteFilter('run')}
                  >
                    <Ionicons name="walk" size={13} color={routeFilter === 'run' ? '#fff' : theme.textMuted} />
                    <Text style={[styles.smallFilterText, routeFilter === 'run' && styles.smallFilterTextActive]}>Lari</Text>
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
                    Menghitung jalur tertutup tanpa gang buntu...
                  </Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {recommendedRoutes.map(item => {
                    const isSelected = selectedRouteId === item.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
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
                          <TouchableOpacity style={styles.btnTryRoute} onPress={() => router.push('/tracker')}>
                            <Ionicons name="play" size={10} color="#ffffff" />
                            <Text style={styles.btnTryRouteText}>Gunakan</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        )}

        {/* ==================== TAB 3: ANDA (KEMAJUAN & RIWAYAT) ==================== */}
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

            {/* TAB KEMAJUAN DENGAN FITUR GESER GARIS */}
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
                        onConfirm: () => setModalConfig(prev => ({ ...prev, visible: false })),
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
                keyExtractor={item => item.id}
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
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>DURASI</Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>{item.durationFormatted || '00:00'}</Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>
                          {item.type === 'walk' ? 'LANGKAH' : item.type === 'bike' ? 'KECEPATAN' : 'PACE'}
                        </Text>
                        <Text style={[styles.statSubVal, { color: theme.textMain }]}>
                          {item.type === 'walk' ? item.steps || 0 : item.paceFormatted || '--:--'}
                        </Text>
                      </View>
                      <View>
                        <Text style={[styles.statSubLabel, { color: theme.textMuted }]}>KALORI</Text>
                        <Text style={[styles.statSubVal, { color: '#ea580c' }]}>{item.calories || 0} kcal</Text>
                      </View>
                    </View>

                    {/* Tombol Bagikan Hasil & Unduh Transparan */}
                    <View style={styles.cardActionRow}>
                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.border }]} onPress={() => setSelectedShareItem(item)}>
                        <Ionicons name="share-social-outline" size={14} color={theme.textMain} />
                        <Text style={[styles.outlineBtnText, { color: theme.textMain }]}>Bagikan</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: '#ea580c' }]} onPress={() => setSelectedDownloadItem(item)}>
                        <Ionicons name="download-outline" size={14} color="#ea580c" />
                        <Text style={[styles.outlineBtnText, { color: '#ea580c' }]}>Unduh</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: theme.border }]} onPress={() => handleExportGpxFile(item)}>
                        <Ionicons name="document-text-outline" size={14} color="#0284c7" />
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

            <ViewShot ref={streakShareRef} options={{ format: 'png', quality: 1.0 }} style={{ backgroundColor: theme.card, paddingBottom: 10 }}>
              <View style={styles.streakCalendarTopBar}>
                <Text style={[styles.calendarMonthHeading, { color: theme.textMain }]}>{monthName}</Text>
                <TouchableOpacity style={styles.btnSharePill} onPress={handleShareStreak}>
                  <Ionicons name="share-social-outline" size={16} color={theme.textMain} />
                  <Text style={[styles.btnSharePillText, { color: theme.textMain }]}>Bagikan</Text>
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

                {/* Kolom Indikator Api Vertikal Sejajar Minggu Berjalan - Ikon Api Tengah Ada Angka */}
                <View style={styles.streakColumnPill}>
                  {Array.from({ length: totalCalendarRows }).map((_, rIdx) => {
                    const isFlameRow = rIdx === todayWeekRowIndex;
                    return (
                      <View key={rIdx} style={styles.streakSlotRow}>
                        {isFlameRow ? (
                          <View style={styles.stravaFlameBadgeIconOnly}>
                            <Ionicons name="flame" size={32} color="#ea580c" />
                            <Text style={styles.stravaFlameNumberInside}>{calculatedWeeklyStreak}</Text>
                          </View>
                        ) : (
                          <View style={styles.streakEmptySlotDot} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            </ViewShot>

            <TouchableOpacity style={styles.btnCloseCalendar} onPress={() => setStreakModalVisible(false)}>
              <Text style={styles.btnCloseCalendarText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL UNDUH GAMBAR TRANSPARAN ==================== */}
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
              <ViewShot
                ref={downloadCardRef}
                options={{ format: 'png', quality: 1.0 }}
                style={styles.transparentCaptureCanvas}
              >
                {/* 1. Baris Jarak */}
                <View style={styles.canvasTextGroup}>
                  <Text style={styles.canvasHeaderLabel}>Jarak</Text>
                  <Text style={styles.canvasBigValue}>{selectedDownloadItem.distanceDisplay}</Text>
                </View>

                {/* 2. Baris Pace / Parameter Kategori */}
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
                      : `${selectedDownloadItem.paceFormatted} /km`}
                  </Text>
                </View>

                {/* 3. Baris Waktu */}
                <View style={styles.canvasTextGroup}>
                  <Text style={styles.canvasHeaderLabel}>Waktu</Text>
                  <Text style={styles.canvasBigValue}>{selectedDownloadItem.durationFormatted}</Text>
                </View>

                {/* 4. Visual Rute Murni (SVG Line Tanpa Map) */}
                <View style={styles.canvasRouteWrap}>
                  {selectedDownloadItem.route && selectedDownloadItem.route.length > 1 ? (
                    <Svg width={200} height={200}>
                      <Polyline
                        points={convertRouteToSvgPoints(selectedDownloadItem.route, 200, 200)}
                        fill="none"
                        stroke="#ea580c"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  ) : (
                    <Ionicons name="walk" size={48} color="#ea580c" />
                  )}
                </View>

                {/* 5. Watermark Logo & Brand XOFIT */}
                <View style={styles.canvasWatermarkRow}>
                  <Image
                    source={require('../../assets/images/icon.png')}
                    style={styles.canvasWatermarkIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.canvasWatermarkText}>XOFIT</Text>
                </View>
              </ViewShot>
            )}

            <TouchableOpacity style={styles.btnExecuteDownload} onPress={handleExecuteDownload}>
              <Ionicons name="cloud-download-outline" size={20} color="#ffffff" />
              <Text style={styles.btnExecuteDownloadText}>Simpan PNG Transparan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL BAGIKAN HASIL LATIHAN */}
      <Modal visible={selectedShareItem !== null} transparent animationType="fade">
        <View style={styles.streakModalBackdrop}>
          <TouchableOpacity
            style={styles.streakBackdropDismiss}
            activeOpacity={1}
            onPress={() => setSelectedShareItem(null)}
          />
          <View style={[styles.shareWrap, { backgroundColor: theme.card, borderColor: theme.border, marginBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.textMain }]}>Bagikan Hasil Latihan</Text>
              <TouchableOpacity onPress={() => setSelectedShareItem(null)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedShareItem && (
              <ViewShot ref={shareCardRef} options={{ format: 'png', quality: 1.0 }} style={styles.shareSnapshotCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.snapshotLogo}>XOFIT PRO</Text>
                  <Text style={styles.snapshotDate}>{selectedShareItem.dateStr}</Text>
                </View>
                <Text style={styles.snapshotTitle}>{selectedShareItem.title}</Text>

                <View style={styles.snapshotGrid}>
                  <View style={styles.snapshotStat}>
                    <Text style={styles.snapLabel}>JARAK</Text>
                    <Text style={styles.snapVal}>{selectedShareItem.distanceDisplay}</Text>
                  </View>
                  <View style={styles.snapshotStat}>
                    <Text style={styles.snapLabel}>PACE</Text>
                    <Text style={styles.snapVal}>{selectedShareItem.paceFormatted}</Text>
                  </View>
                  <View style={styles.snapshotStat}>
                    <Text style={styles.snapLabel}>DURASI</Text>
                    <Text style={styles.snapVal}>{selectedShareItem.durationFormatted}</Text>
                  </View>
                </View>
              </ViewShot>
            )}

            <TouchableOpacity style={styles.btnShareExecute} onPress={handleExecuteShare}>
              <Ionicons name="share-outline" size={18} color="#ffffff" />
              <Text style={styles.btnShareExecuteText}>Simpan & Bagikan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL RUTINITAS */}
      <Modal visible={routineModalVisible} transparent animationType="slide">
        <View style={[styles.streakModalBackdrop, { justifyContent: 'center', padding: 20 }]}>
          <View style={[styles.routineCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.textMain }]}>
                {routineType === 'warmup' ? 'Pemanasan' : 'Pendinginan'}
              </Text>
              <TouchableOpacity onPress={() => setRoutineModalVisible(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={[styles.exerciseImageBox, { borderColor: theme.border }]}>
              <Image source={{ uri: currentStep.imageUrl }} style={styles.exerciseImage} resizeMode="cover" />
            </View>

            <Text style={[styles.exerciseName, { color: theme.textMain }]}>{currentStep.name}</Text>
            <Text style={[styles.exerciseInstruction, { color: theme.textMuted }]}>{currentStep.instruction}</Text>

            <Text style={[styles.timerClockText, { color: theme.textMain }]}>
              {stepSecondsLeft} <Text style={{ fontSize: 16, color: theme.textMuted }}>detik</Text>
            </Text>

            <View style={styles.routineActionRow}>
              <TouchableOpacity
                style={[styles.routineSecondaryBtn, { borderColor: theme.border }]}
                onPress={() => {
                  if (currentStepIndex + 1 < activeRoutine.length) {
                    setCurrentStepIndex(prev => prev + 1);
                    setStepSecondsLeft(activeRoutine[currentStepIndex + 1].durationSec);
                  } else {
                    setRoutineModalVisible(false);
                  }
                }}
              >
                <Text style={[styles.routineSecondaryText, { color: theme.textMain }]}>Lewati</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.routinePrimaryBtn} onPress={() => setIsRoutineRunning(prev => !prev)}>
                <Ionicons name={isRoutineRunning ? 'pause' : 'play'} size={18} color="#ffffff" />
                <Text style={styles.routinePrimaryText}>{isRoutineRunning ? 'Jeda' : 'Mulai'}</Text>
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

  // Ikon Api Murni dengan Angka di Tengahnya
  flameCircleIconOnly: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  flameCountTextCenter: {
    position: 'absolute',
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
    bottom: 12,
  },
  flameWeekText: { fontSize: 14, fontWeight: '800', color: '#ea580c', marginTop: 2 },
  dotMatrix: { gap: 6 },
  dotMatrixRow: { flexDirection: 'row', gap: 6 },
  matrixDot: { width: 10, height: 10, borderRadius: 5 },
  matrixDotRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#0f172a', backgroundColor: 'transparent' },

  workoutBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  workoutBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  workoutBtnTitle: { fontSize: 13, fontWeight: '700' },

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
  btnTryRoute: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ea580c', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTryRouteText: { fontSize: 10, fontWeight: '800', color: '#ffffff' },

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
  cardActionRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  outlineBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  outlineBtnText: { fontSize: 11, fontWeight: '700' },
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
  btnSharePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
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
  stravaFlameBadgeIconOnly: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  stravaFlameNumberInside: {
    position: 'absolute',
    bottom: 8,
    fontSize: 10,
    fontWeight: '900',
    color: '#ffffff',
  },

  btnCloseCalendar: { backgroundColor: '#ea580c', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  btnCloseCalendarText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },

  routineCard: { width: '100%', borderRadius: 24, padding: 20, borderWidth: 1, alignItems: 'center' },
  exerciseImageBox: { width: '100%', height: 160, borderRadius: 16, overflow: 'hidden', borderWidth: 1, marginVertical: 8 },
  exerciseImage: { width: '100%', height: '100%' },
  exerciseName: { fontSize: 16, fontWeight: '900', textAlign: 'center', marginTop: 6 },
  exerciseInstruction: { fontSize: 12, textAlign: 'center', marginTop: 4, paddingHorizontal: 10, lineHeight: 17 },
  timerClockText: { fontSize: 36, fontWeight: '900', textAlign: 'center', marginVertical: 8 },
  routineActionRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 },
  routineSecondaryBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  routineSecondaryText: { fontSize: 13, fontWeight: '700' },
  routinePrimaryBtn: { flex: 1.4, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#ea580c', paddingVertical: 12, borderRadius: 12 },
  routinePrimaryText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  shareWrap: { width: '100%', borderRadius: 20, padding: 18, borderWidth: 1 },
  shareSnapshotCard: { backgroundColor: '#090d16', padding: 18, borderRadius: 16, marginBottom: 14, borderWidth: 1, borderColor: '#ea580c' },
  snapshotLogo: { color: '#ea580c', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  snapshotTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800', marginTop: 6 },
  snapshotDate: { color: '#94a3b8', fontSize: 11 },
  snapshotGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  snapshotStat: { flex: 1, backgroundColor: '#131c2e', padding: 8, borderRadius: 8, alignItems: 'center', marginHorizontal: 2 },
  snapLabel: { color: '#94a3b8', fontSize: 8, fontWeight: '800' },
  snapVal: { color: '#ffffff', fontSize: 12, fontWeight: '800', marginTop: 2 },
  btnShareExecute: { backgroundColor: '#ea580c', paddingVertical: 12, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  btnShareExecuteText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

  // STYLES MODAL UNDUH TRANSPARAN
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
  transparentCaptureCanvas: {
    width: '100%',
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  canvasTextGroup: {
    alignItems: 'center',
    marginBottom: 18,
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
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
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
  btnExecuteDownload: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ea580c',
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 16,
    elevation: 4,
  },
  btnExecuteDownloadText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});