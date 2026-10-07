import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ActivityHistory } from './storage';

const SAVED_DOWNLOAD_DIR_KEY = '@xofit_saved_download_dir_uri';

const buildGpxString = (activity: ActivityHistory): string => {
  let route = activity.route;
  if (typeof route === 'string') {
    try {
      route = JSON.parse(route);
    } catch {
      route = [];
    }
  }

  const trkpts = (route || [])
    .map(
      (point: any) => `      <trkpt lat="${point.latitude}" lon="${point.longitude}">
        ${point.altitude != null ? `<ele>${point.altitude}</ele>` : ''}
        <time>${new Date(activity.timestamp || Date.now()).toISOString()}</time>
      </trkpt>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="XoFit Pro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${activity.title || 'Aktivitas XoFit'}</name>
    <time>${new Date(activity.timestamp || Date.now()).toISOString()}</time>
  </metadata>
  <trk>
    <name>${activity.title || 'Latihan'}</name>
    <type>${activity.type === 'bike' ? 'Cycling' : 'Running'}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
};

export const shareActivityGpx = async (activity: ActivityHistory): Promise<boolean> => {
  try {
    if (!activity.route || activity.route.length === 0) return false;

    const gpxContent = buildGpxString(activity);
    const fileName = `xofit_${activity.id || Date.now()}.gpx`;
    const filePath = `${FileSystem.cacheDirectory}${fileName}`;

    await FileSystem.writeAsStringAsync(filePath, gpxContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(filePath, {
        mimeType: 'application/gpx+xml',
        dialogTitle: 'Bagikan Berkas GPX',
        UTI: 'com.topografix.gpx',
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error('GPX Share Error:', error);
    return false;
  }
};

export const downloadActivityGpx = async (activity: ActivityHistory): Promise<boolean> => {
  try {
    if (!activity.route || activity.route.length === 0) return false;

    const gpxContent = buildGpxString(activity);
    const fileName = `xofit_${activity.id || Date.now()}.gpx`;

    if (Platform.OS === 'android') {
      let dirUri = await AsyncStorage.getItem(SAVED_DOWNLOAD_DIR_KEY);

      if (dirUri) {
        try {
          const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
            dirUri,
            fileName,
            'application/gpx+xml'
          );
          await FileSystem.writeAsStringAsync(createdUri, gpxContent, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          return true;
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
          'application/gpx+xml'
        );
        await FileSystem.writeAsStringAsync(createdUri, gpxContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        return true;
      }
    }

    return await shareActivityGpx(activity);
  } catch (error) {
    console.error('GPX Download Error:', error);
    return false;
  }
};