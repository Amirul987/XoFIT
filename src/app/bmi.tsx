import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import NotificationModal from '../components/NotificationModal';
import { saveProfile } from '../utils/storage';

export default function BMIScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [gender, setGender] = useState<'pria' | 'wanita'>('pria');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');

  // Awal mula kosong tanpa nilai default
  const [bmiResult, setBmiResult] = useState<number | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string>('-');
  const [categoryColor, setCategoryColor] = useState<string>('#94a3b8');
  const [weightDiff, setWeightDiff] = useState<string>('-');
  const [idealWeight, setIdealWeight] = useState<number | null>(null);

  const [modalConfig, setModalConfig] = useState({
    visible: false,
    title: '',
    message: '',
  });

  const theme = {
    bg: isDark ? '#0b0f19' : '#ffffff',
    card: isDark ? '#111827' : '#f8fafc',
    cardBorder: isDark ? '#1f2937' : '#e2e8f0',
    textMain: isDark ? '#f8fafc' : '#0f172a',
    textMuted: isDark ? '#94a3b8' : '#64748b',
    inputBg: isDark ? '#111827' : '#ffffff',
    inputBorder: isDark ? '#374151' : '#e2e8f0',
    inactiveGenderBg: isDark ? '#111827' : '#f1f5f9',
    inactiveGenderText: isDark ? '#94a3b8' : '#475569',
    tableBg: isDark ? '#111827' : '#f8fafc',
  };

  const handleCalculate = async () => {
    const h = parseFloat(height);
    const w = parseFloat(weight);

    if (!h || !w || h <= 0 || w <= 0) {
      setModalConfig({
        visible: true,
        title: 'Input Belum Lengkap',
        message: 'Silakan isi tinggi badan dan berat badan terlebih dahulu.',
      });
      return;
    }

    const hM = h / 100;
    const bmiVal = parseFloat((w / (hM * hM)).toFixed(1));
    setBmiResult(bmiVal);

    let cat = 'Normal';
    let color = '#22c55e';

    if (bmiVal < 18.5) {
      cat = 'Kurang';
      color = '#38bdf8';
    } else if (bmiVal >= 18.5 && bmiVal <= 24.9) {
      cat = 'Normal';
      color = '#22c55e';
    } else if (bmiVal >= 25.0 && bmiVal <= 29.9) {
      cat = 'Gemuk';
      color = '#f59e0b';
    } else {
      cat = 'Obesitas';
      color = '#ef4444';
    }

    setCategoryLabel(cat);
    setCategoryColor(color);

    const ideal = gender === 'pria' ? (h - 100) - (h - 100) * 0.1 : (h - 100) - (h - 100) * 0.15;
    const idealFormatted = parseFloat(ideal.toFixed(1));
    setIdealWeight(idealFormatted);

    const diff = (w - idealFormatted).toFixed(1);
    const diffText = parseFloat(diff) > 0 ? `+${diff} kg` : `${diff} kg`;
    setWeightDiff(diffText);

    await saveProfile({
      weight: w,
      height: h,
      gender,
      idealWeight: idealFormatted,
      bmi: bmiVal,
    });
  };

  const CX = 120;
  const CY = 115;
  const R = 90;

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY - radius * Math.sin(angleInRadians),
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, startAngle);
    const end = polarToCartesian(x, y, radius, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
  };

  const arcBlue = describeArc(CX, CY, R, 180, 148.5);
  const arcGreen = describeArc(CX, CY, R, 148.5, 90);
  const arcYellow = describeArc(CX, CY, R, 90, 45);
  const arcRed = describeArc(CX, CY, R, 45, 0);

  const getPointerCoord = () => {
    if (bmiResult === null) return { x: 0, y: 0 };
    const clamped = Math.min(Math.max(bmiResult, 15.0), 35.0);
    let angle = 180;

    if (clamped < 18.5) {
      angle = 180 - ((clamped - 15.0) / (18.5 - 15.0)) * (180 - 148.5);
    } else if (clamped <= 25.0) {
      angle = 148.5 - ((clamped - 18.5) / (25.0 - 18.5)) * (148.5 - 90);
    } else if (clamped <= 30.0) {
      angle = 90 - ((clamped - 25.0) / (30.0 - 25.0)) * (90 - 45);
    } else {
      angle = 45 - ((clamped - 30.0) / (35.0 - 30.0)) * 45;
    }

    return polarToCartesian(CX, CY, R, angle);
  };

  const pointerPos = getPointerCoord();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.textMain} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textMain }]}>Kalkulator BMI & Indikator IMT</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollArea} showsVerticalScrollIndicator={false}>
        <View style={styles.genderRow}>
          <TouchableOpacity
            style={[
              styles.genderBtn,
              gender === 'pria' ? styles.genderBtnActive : { backgroundColor: theme.inactiveGenderBg },
            ]}
            onPress={() => setGender('pria')}
          >
            <Ionicons name="male" size={18} color={gender === 'pria' ? '#ffffff' : theme.inactiveGenderText} />
            <Text style={[styles.genderText, gender === 'pria' ? styles.textWhite : { color: theme.inactiveGenderText }]}>
              Laki-laki
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.genderBtn,
              gender === 'wanita' ? styles.genderBtnActive : { backgroundColor: theme.inactiveGenderBg },
            ]}
            onPress={() => setGender('wanita')}
          >
            <Ionicons name="female" size={18} color={gender === 'wanita' ? '#ffffff' : theme.inactiveGenderText} />
            <Text style={[styles.genderText, gender === 'wanita' ? styles.textWhite : { color: theme.inactiveGenderText }]}>
              Perempuan
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputTwoColumn}>
          <View style={styles.inputCol}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Tinggi Badan (cm)</Text>
            <TextInput
              style={[styles.inputField, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.textMain }]}
              value={height}
              onChangeText={setHeight}
              keyboardType="numeric"
              placeholder="Contoh: 165"
              placeholderTextColor={theme.textMuted}
            />
          </View>

          <View style={styles.inputCol}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Berat Badan (kg)</Text>
            <TextInput
              style={[styles.inputField, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.textMain }]}
              value={weight}
              onChangeText={setWeight}
              keyboardType="numeric"
              placeholder="Contoh: 51"
              placeholderTextColor={theme.textMuted}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.btnHitung} onPress={handleCalculate}>
          <Ionicons name="calculator" size={20} color="#ffffff" style={{ marginRight: 6 }} />
          <Text style={styles.btnHitungText}>Hitung IMT</Text>
        </TouchableOpacity>

        {/* Busur Gauge */}
        <View style={styles.gaugeContainer}>
          <Svg width={240} height={130} viewBox="0 0 240 130">
            <Path d={arcBlue} fill="none" stroke="#38bdf8" strokeWidth="14" strokeLinecap="round" />
            <Path d={arcGreen} fill="none" stroke="#22c55e" strokeWidth="14" />
            <Path d={arcYellow} fill="none" stroke="#f59e0b" strokeWidth="14" />
            <Path d={arcRed} fill="none" stroke="#ef4444" strokeWidth="14" strokeLinecap="round" />

            {/* Lingkaran penanda hanya dirender saat sudah dihitung */}
            {bmiResult !== null && (
              <Circle
                cx={pointerPos.x}
                cy={pointerPos.y}
                r="8.5"
                fill="#ffffff"
                stroke={categoryColor}
                strokeWidth="4"
              />
            )}
          </Svg>

          <Text style={[styles.gaugeCenterLabel, { color: theme.textMuted }]}>IMT</Text>
          <Text style={[styles.gaugeCenterValue, { color: bmiResult !== null ? categoryColor : theme.textMain }]}>
            {bmiResult !== null ? bmiResult.toFixed(1) : '--'}
          </Text>
        </View>

        <View style={[styles.resultBottomRow, { borderTopColor: theme.cardBorder }]}>
          <View style={styles.resultCol}>
            <Text style={[styles.resultHeaderTitle, { color: theme.textMuted }]}>Kategori</Text>
            <Text style={[styles.resultValText, { color: bmiResult !== null ? categoryColor : theme.textMain }]}>
              {categoryLabel}
            </Text>
          </View>

          <View style={styles.resultCol}>
            <Text style={[styles.resultHeaderTitle, { color: theme.textMuted }]}>Selisih</Text>
            <Text style={[styles.resultValText, { color: theme.textMain }]}>
              {weightDiff}
            </Text>
          </View>
        </View>

        <View style={[styles.scoreInfoCard, { backgroundColor: theme.tableBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.scoreInfoHeading, { color: theme.textMuted }]}>KETERANGAN SKOR IMT</Text>

          <View style={styles.scoreRow}>
            <View style={styles.scoreItem}>
              <View style={[styles.colorDot, { backgroundColor: '#38bdf8' }]} />
              <Text style={[styles.scoreLabel, { color: theme.textMain }]}>Kurang</Text>
            </View>
            <Text style={[styles.scoreVal, { color: theme.textMain }]}>&lt; 18.5</Text>

            <View style={[styles.scoreItem, { marginLeft: 16 }]}>
              <View style={[styles.colorDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[styles.scoreLabel, { color: theme.textMain }]}>Normal</Text>
            </View>
            <Text style={[styles.scoreVal, { color: theme.textMain }]}>18.5 - 24.9</Text>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreItem}>
              <View style={[styles.colorDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={[styles.scoreLabel, { color: theme.textMain }]}>Gemuk</Text>
            </View>
            <Text style={[styles.scoreVal, { color: theme.textMain }]}>25.0 - 29.9</Text>

            <View style={[styles.scoreItem, { marginLeft: 16 }]}>
              <View style={[styles.colorDot, { backgroundColor: '#ef4444' }]} />
              <Text style={[styles.scoreLabel, { color: theme.textMain }]}>Obesitas</Text>
            </View>
            <Text style={[styles.scoreVal, { color: theme.textMain }]}>≥ 30.0</Text>
          </View>

          <Text style={[styles.idealBrocaText, { color: theme.textMuted }]}>
            Rekomendasi Berat Ideal Broca:{' '}
            <Text style={{ color: '#38bdf8', fontWeight: '800' }}>
              {idealWeight ? `${idealWeight} kg` : '-'}
            </Text>
          </Text>
        </View>
      </ScrollView>

      <NotificationModal
        visible={modalConfig.visible}
        type="warning"
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText="OK"
        onConfirm={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  scrollArea: { paddingHorizontal: 16, paddingBottom: 40 },
  genderRow: { flexDirection: 'row', gap: 12, marginTop: 10, marginBottom: 16 },
  genderBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  genderBtnActive: { backgroundColor: '#f97316' },
  genderText: { fontSize: 15, fontWeight: '700' },
  textWhite: { color: '#ffffff' },
  inputTwoColumn: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  inputCol: { flex: 1 },
  inputLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  inputField: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  btnHitung: {
    backgroundColor: '#f97316',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  btnHitungText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  gaugeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  gaugeCenterLabel: { fontSize: 12, fontWeight: '700', marginTop: 4, letterSpacing: 1 },
  gaugeCenterValue: { fontSize: 32, fontWeight: '900', marginTop: 2 },
  resultBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingTop: 16,
    marginBottom: 20,
  },
  resultCol: { alignItems: 'center' },
  resultHeaderTitle: { fontSize: 13, fontWeight: '600' },
  resultValText: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  scoreInfoCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  scoreInfoHeading: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: 14 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  scoreItem: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  scoreLabel: { fontSize: 13, fontWeight: '600' },
  scoreVal: { fontSize: 13, fontWeight: '800', minWidth: 70 },
  idealBrocaText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.15)',
  },
});