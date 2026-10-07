import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, useColorScheme, Easing } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

const { width, height } = Dimensions.get('screen');

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [animationComplete, setAnimationComplete] = useState(false);

  // Nilai Animasi
  const logoScale = useRef(new Animated.Value(0.35)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  const titleTranslateY = useRef(new Animated.Value(20)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;

  const taglineScale = useRef(new Animated.Value(0.9)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  const splashContainerScale = useRef(new Animated.Value(1)).current;
  const splashContainerOpacity = useRef(new Animated.Value(1)).current;

  const splashBg = isDark ? '#090d16' : '#ffffff';
  const titleColor = isDark ? '#ffffff' : '#0f172a';

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    Animated.sequence([
      // Fase 1: Logo memantul elastis dan memudar masuk
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 5,
          tension: 45,
          useNativeDriver: true,
        }),
      ]),

      // Fase 2: Judul meluncur naik dan tagline muncul
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslateY, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(100),
          Animated.parallel([
            Animated.timing(taglineOpacity, {
              toValue: 1,
              duration: 280,
              useNativeDriver: true,
            }),
            Animated.spring(taglineScale, {
              toValue: 1,
              friction: 6,
              tension: 60,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),

      // Tahan sejenak untuk visibilitas brand
      Animated.delay(500),

      // Fase 3: Transisi keluar halus masuk ke halaman utama
      Animated.parallel([
        Animated.timing(splashContainerOpacity, {
          toValue: 0,
          duration: 350,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(splashContainerScale, {
          toValue: 1.08,
          duration: 350,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setAnimationComplete(true);
    });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: splashBg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={splashBg} translucent />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: splashBg },
          animation: 'none',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="bmi" options={{ headerShown: false }} />
        <Stack.Screen name="tracker" options={{ headerShown: false }} />
      </Stack>

      {!animationComplete && (
        <Animated.View
          style={[
            styles.splashOverlay,
            {
              backgroundColor: splashBg,
              opacity: splashContainerOpacity,
              transform: [{ scale: splashContainerScale }],
            },
          ]}
          pointerEvents="none"
        >
          {/* Logo aplikasi */}
          <Animated.Image
            source={require('../../assets/images/icon.png')}
            style={[
              styles.logoImage,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
            resizeMode="contain"
          />

          {/* Nama dan Tagline */}
          <View style={styles.textContainer}>
            <Animated.Text
              style={[
                styles.appTitle,
                {
                  color: titleColor,
                  opacity: titleOpacity,
                  transform: [{ translateY: titleTranslateY }],
                },
              ]}
            >
              XoFit
            </Animated.Text>

            <Animated.View
              style={[
                styles.taglineBadge,
                {
                  opacity: taglineOpacity,
                  transform: [{ scale: taglineScale }],
                },
              ]}
            >
              <Text style={styles.appTagline}>TRACK • RUN • RIDE</Text>
            </Animated.View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width,
    height: height,
    zIndex: 999999,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 50,
  },
  logoImage: {
    width: 124,
    height: 124,
  },
  textContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  appTitle: {
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  taglineBadge: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(234, 88, 12, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234, 88, 12, 0.28)',
  },
  appTagline: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ea580c',
    letterSpacing: 2.5,
  },
});