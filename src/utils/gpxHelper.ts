import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ActivityHistory } from './storage';

export const exportActivityToGpx = async (activity: ActivityHistory): Promise<boolean> => {
  try {
    if (!activity.route || activity.route.length === 0) {
      return false;
    }

    const trkpts = activity.route
      .map(
        (point) => `      <trkpt lat="${point.latitude}" lon="${point.longitude}">
        ${point.altitude != null ? `<ele>${point.altitude}</ele>` : ''}
        <time>${new Date(activity.timestamp).toISOString()}</time>
      </trkpt>`
      )
      .join('\n');

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="XoFit Pro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${activity.title || 'Aktivitas XoFit'}</name>
    <time>${new Date(activity.timestamp).toISOString()}</time>
  </metadata>
  <trk>
    <name>${activity.title || 'Latihan'}</name>
    <type>${activity.type === 'bike' ? 'Cycling' : 'Running'}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

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
    console.error('GPX Export Error:', error);
    return false;
  }
};