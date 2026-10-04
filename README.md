# 🏃 XoFit (Track • Run • Ride)

**XoFit** adalah aplikasi pelacak kebugaran dan aktivitas fisik berbasis **React Native** dan **Expo**. Dirancang untuk merekam aktivitas jalan kaki (*walk*), lari (*run*), hingga bersepeda (*bike*) dengan visualisasi rute interaktif, pelacakan sensor di latar belakang, kalkulator IMT/BMI, dan ekspor berkas GPX.

---

## ✨ Fitur Utama

- **Aktivitas & Rute Terpadu**: Melacak koordinat GPS, jarak tempuh, durasi, *instant pace*, estimasi kalori terbakar, dan kenaikan elevasi.
- **Peta Rute Interaktif (Leaflet)**: Peta berbasis Leaflet di dalam WebView dengan render polyline rute dan *radar rekomendasi rute*.
- **Background Step & Task Manager**: Pencatatan langkah dan lokasi tetap berjalan di latar belakang menggunakan `expo-task-manager` & `expo-sensors`.
- **Kalkulator IMT / BMI**: Penghitungan indeks massa tubuh lengkap dengan busur *radial gauge*, kategori berat badan, dan kalkulasi berat ideal formula Broca.
- **Ekspor & Berbagi**:
  - Simpan dan bagikan *infografis rute* via `react-native-view-shot` dan `expo-sharing`.
  - Ekspor log riwayat aktivitas ke dalam format standar **GPX (`.gpx`)**.
- **Dark Mode Dinamis**: Tampilan adaptif otomatis mengikuti setelan tema sistem operasi perangkat.

---

## 🛠 Prasyarat

Sebelum menjalankan proyek, pastikan sudah menginstal:
- [Node.js](https://nodejs.org/) (versi LTS 18.x atau yang lebih baru)
- [Git](https://git-scm.com/)
- Perangkat Android/iOS fisik (dengan aplikasi **Expo Go** terinstal) atau Android Studio / Xcode Emulator

---

## 🚀 Panduan Instalasi & Menjalankan Proyek

Ikuti langkah-langkah berikut secara berurutan di terminal:

### 1. Kloning Repositori
Clone repositori proyek ini ke komputer lokal kamu dan masuk ke foldernya:
```bash
git clone https://github.com/username-kamu/xofit.git
cd xofit
```

### 2. Instal Dependensi Dasar Proyek
Instal modul dasar yang terdaftar di berkas `package.json`:
```bash
npm install
```

### 3. Instal Paket Dependensi Expo
Jalankan perintah berikut untuk memastikan semua modul Expo, sensor, grafis SVG, WebView, dan native runtime terpasang dengan versi yang sesuai (*compatible*) dengan Expo SDK yang digunakan:

```bash
npx expo install expo-router expo-status-bar expo-splash-screen expo-location expo-sensors expo-media-library expo-image expo-web-browser expo-sharing expo-symbols expo-task-manager expo-file-system react-native-safe-area-context react-native-screens react-native-svg react-native-webview react-native-view-shot @react-native-async-storage/async-storage @expo/vector-icons
```

#### Catatan Dependensi:
- `expo-location` & `expo-task-manager`: Pelacakan koordinat GPS di *foreground* dan *background*.
- `expo-sensors`: Sensor akselerometer dan penghitung langkah (*pedometer*).
- `react-native-webview`: Menjalankan Leaflet map interaktif.
- `react-native-svg`: Render grafis lingkaran cincin progres (*rings*) dan busur gauge IMT.
- `react-native-view-shot` & `expo-sharing`: Mengambil tangkapan layar hasil latihan dan membagikannya ke media sosial/penyimpanan.
- `@react-native-async-storage/async-storage`: Penyimpanan data profil dan riwayat latihan secara offline.

### 4. Jalankan Aplikasi
Mulai server Metro bundler:
```bash
npx expo start
```

Atau jika ingin membersihkan cache terlebih dahulu:
```bash
npx expo start -c
```

### 5. Membuka di Perangkat
Setelah server berjalan, pilih cara membuka aplikasi:
- **Perangkat Fisik**: Buka aplikasi **Expo Go** di HP kamu, lalu pindai QR code yang tampil di terminal.
- **Android Emulator**: Tekan tombol `a` pada keyboard di terminal.
- **iOS Simulator**: Tekan tombol `i` pada keyboard di terminal.
- **Web Browser**: Tekan tombol `w` pada keyboard di terminal.

---

## 🔒 Catatan Izin Perangkat (Permissions)

Aplikasi ini memerlukan beberapa izin hardware di perangkat:
- `ACCESS_FINE_LOCATION` & `ACCESS_BACKGROUND_LOCATION` (Pelacakan koordinat lokasi saat layar menyala maupun mati)
- `ACTIVITY_RECOGNITION` (Akses data sensor gerak dan langkah)
- `FOREGROUND_SERVICE` & `FOREGROUND_SERVICE_LOCATION` (Menjaga background task tetap aktif tanpa dihentikan paksa oleh sistem operasi)
- `READ_MEDIA_IMAGES` / `WRITE_EXTERNAL_STORAGE` (Menyimpan hasil infografis dan file `.gpx` ke folder memori)

> **Tips:** Fitur pelacakan latar belakang (*Background Task*) berjalan optimal pada file APK / Development Build yang dibangun menggunakan EAS Build (`npx eas build --profile development`).

---

## 📁 Struktur Folder Proyek

```text
├── assets/                  # Aset gambar, splash screen, dan ikon
├── src/
│   ├── app/                 # Struktur halaman Expo Router (_layout, bmi, tracker, dll)
│   ├── components/          # Komponen UI reusable (NotificationModal, dll)
│   ├── constants/           # Definisi warna tema dan tata letak
│   └── utils/
│       ├── backgroundStepTask.ts     # Definisi TaskManager background pedometer
│       ├── backgroundTrackerTask.ts  # Definisi TaskManager background rute & GPS
│       ├── gpxHelper.ts              # Generator format XML GPX dan modul share
│       └── storage.ts                # Manajemen state & data lokal AsyncStorage
├── app.json                 # Pengaturan izin aplikasi & konfigurasi Expo
└── package.json
```
