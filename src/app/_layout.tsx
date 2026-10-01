import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

const { width, height } = Dimensions.get('screen');

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [animationComplete, setAnimationComplete] = useState(false);

  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const splashContainerOpacity = useRef(new Animated.Value(1)).current;

  // Latar belakang dan teks menyesuaikan tema HP
  const splashBg = isDark ? '#090d16' : '#ffffff';
  const titleColor = isDark ? '#ffffff' : '#0f172a';

  useEffect(() => {
    // Segera tutup splash bawaan OS
    SplashScreen.hideAsync().catch(() => {});

    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 50,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(600),
      Animated.timing(splashContainerOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
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
            },
          ]}
          pointerEvents="none"
        >
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

          <Animated.View
            style={[
              styles.textContainer,
              {
                opacity: textOpacity,
                transform: [{ translateY: textTranslateY }],
              },
            ]}
          >
            <Text style={[styles.appTitle, { color: titleColor }]}>XoFit</Text>
            <Text style={styles.appTagline}>TRACK • RUN • RIDE</Text>
          </Animated.View>
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
    width: 120,
    height: 120,
  },
  textContainer: {
    alignItems: 'center',
    marginTop: 18,
  },
  appTitle: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2.5,
  },
  appTagline: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ea580c',
    letterSpacing: 3,
    marginTop: 6,
  },
});