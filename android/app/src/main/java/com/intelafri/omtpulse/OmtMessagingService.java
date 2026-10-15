package com.intelafri.omtpulse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Receives FCM. A vuur is drawn by the app so the lock screen shows the card and the siren plays. */
public class OmtMessagingService extends MessagingService {
    public static final String EXTRA_URL = "omt_push_url";
    public static final String EXTRA_TITLE = "omt_fire_title";
    public static final String EXTRA_BODY = "omt_fire_body";
    static final String CHANNEL_ID = "omt_vuur";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if ("fire".equals(data.get("type"))) {
            showFire(data);
        }
        super.onMessageReceived(remoteMessage);
    }

    private void showFire(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "VUUR";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Daar is 'n vuur in die gebied.";
        String url = data.get("url");
        if (url == null) url = "/live-incident";

        ensureChannel();

        Intent open = new Intent(this, FireAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = url.hashCode();
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_fire_flame)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true)
                .build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            int id = data.get("incidentId") != null ? Math.abs(data.get("incidentId").hashCode()) : 71001;
            manager.notify(id, notification);
        }

        try {
            startActivity(open);
        } catch (Exception ignored) {
            /* Full-screen intent is the fallback when the system blocks a direct start. */
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Vuur",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Vuurwaarskuwing met sirene");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.panic_alert),
                attrs
        );
        manager.createNotificationChannel(channel);
    }
}
