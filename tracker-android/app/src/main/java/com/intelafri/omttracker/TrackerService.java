package com.intelafri.omttracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TrackerService extends Service {
    private static final int NOTIFICATION_ID = 7041;
    private static final String CHANNEL_ID = "omt_asset_location";
    private static final long HEARTBEAT_MS = 3 * 60 * 1000L;
    private static final float MOVE_METERS = 40f;

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private Location lastSent;
    private long lastSentAt;
    private boolean sending;

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(@NonNull Location location) {
            TrackerService.this.onLocation(location);
        }
    };

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            Location latest = newestKnown();
            if (latest != null) onLocation(latest);
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    static void start(Context context) {
        Intent intent = new Intent(context, TrackerService.class);
        ContextCompat.startForegroundService(context, intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (TrackerStore.token(this) == null || !hasLocationPermission()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startInForeground();
        } catch (SecurityException error) {
            stopSelf();
            return START_NOT_STICKY;
        }
        requestUpdates();
        handler.removeCallbacks(heartbeat);
        handler.postDelayed(heartbeat, HEARTBEAT_MS);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(heartbeat);
        if (locationManager != null) locationManager.removeUpdates(listener);
        network.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startInForeground() {
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(getString(R.string.notification_text))
                .setContentIntent(pending)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.notification_text));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void requestUpdates() {
        if (!hasLocationPermission() || locationManager == null) return;
        long minTime = 60 * 1000L;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, minTime, 0f, listener, Looper.getMainLooper());
            }
        } catch (SecurityException ignored) {
            stopSelf();
            return;
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, minTime, 0f, listener, Looper.getMainLooper());
            }
        } catch (Exception ignored) {
            // Network location is optional. GPS can still report.
        }
        Location known = newestKnown();
        if (known != null) onLocation(known);
    }

    private Location newestKnown() {
        if (!hasLocationPermission() || locationManager == null) return null;
        Location gps = null;
        Location network = null;
        try {
            gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            network = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
        } catch (SecurityException ignored) {
            return null;
        }
        if (gps == null) return network;
        if (network == null) return gps;
        return gps.getTime() >= network.getTime() ? gps : network;
    }

    private void onLocation(Location location) {
        if (location == null || sending) return;
        long age = System.currentTimeMillis() - location.getTime();
        if (location.getTime() > 0 && age > 2 * 60 * 1000L) return;
        long now = System.currentTimeMillis();
        boolean moved = lastSent == null || lastSent.distanceTo(location) >= MOVE_METERS;
        boolean due = lastSentAt == 0 || now - lastSentAt >= HEARTBEAT_MS;
        if (!moved && !due) return;
        String token = TrackerStore.token(this);
        if (token == null) {
            stopSelf();
            return;
        }
        sending = true;
        Integer battery = batteryPercent();
        network.execute(() -> {
            try {
                boolean accepted = TrackerApi.heartbeat(token, location, battery);
                handler.post(() -> {
                    sending = false;
                    if (!accepted) {
                        TrackerStore.clear(TrackerService.this);
                        stopSelf();
                        return;
                    }
                    lastSent = new Location(location);
                    lastSentAt = System.currentTimeMillis();
                    TrackerStore.markSent(TrackerService.this, lastSentAt);
                });
            } catch (Exception error) {
                handler.post(() -> {
                    sending = false;
                    String message = error.getMessage() == null ? "Could not reach OMT" : error.getMessage();
                    TrackerStore.markError(TrackerService.this, message);
                });
            }
        });
    }

    private Integer batteryPercent() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) return null;
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) return null;
        return Math.round(level * 100f / scale);
    }
}
