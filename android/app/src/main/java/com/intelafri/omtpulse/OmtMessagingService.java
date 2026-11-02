package com.intelafri.omtpulse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Receives FCM. Vuur and misdaad are drawn by the app so the lock screen shows a card and a tone. */
public class OmtMessagingService extends MessagingService {
    public static final String EXTRA_URL = "omt_push_url";
    public static final String EXTRA_TITLE = "omt_fire_title";
    public static final String EXTRA_BODY = "omt_fire_body";
    public static final String EXTRA_CLIP_URL = "omt_radio_clip";
    public static final String EXTRA_SILENT = "omt_silent";
    static final String CHANNEL_ID = "omt_vuur_bell";
    static final String CRIME_CHANNEL_ID = "omt_misdaad_tone";
    static final String PANIC_CHANNEL_ID = "omt_panic_loud";
    static final String RADIO_CHANNEL_ID = "omt_radio_static";
    static final String CHAT_CHANNEL_ID = "omt_chat";
    static final String QUIET_PREFS = "omt_quiet";
    static final String QUIET_CARD_CHANNEL_ID = "omt_quiet_card";
    public static final String IGNORE_PREFS = "omt_fire_ignore";
    public static final String EXTRA_INCIDENT_ID = "omt_incident_id";
    public static final String EXTRA_NOTIFY_ID = "omt_notify_id";
    /** Older installs created this channel with no sound. Android will not update it, so the tone lives on a new id. */
    private static final String RADIO_LEGACY_CHANNEL_ID = "omt_radio_voice";

    /** This phone only. The fire stays open for the rest of the group. */
    public static void rememberIgnoredFire(Context context, int id) {
        if (id <= 0) return;
        SharedPreferences prefs = context.getSharedPreferences(IGNORE_PREFS, Context.MODE_PRIVATE);
        java.util.Set<String> ids = new java.util.HashSet<>(
                prefs.getStringSet("ids", java.util.Collections.emptySet())
        );
        ids.add(Integer.toString(id));
        prefs.edit().putStringSet("ids", ids).apply();
        dismissFireNotification(context, id);
    }

    public static boolean isFireIgnored(Context context, int id) {
        if (id <= 0) return false;
        return context.getSharedPreferences(IGNORE_PREFS, Context.MODE_PRIVATE)
                .getStringSet("ids", java.util.Collections.emptySet())
                .contains(Integer.toString(id));
    }

    public static java.util.Set<String> ignoredFireIds(Context context) {
        return new java.util.HashSet<>(
                context.getSharedPreferences(IGNORE_PREFS, Context.MODE_PRIVATE)
                        .getStringSet("ids", java.util.Collections.emptySet())
        );
    }

    public static void dismissFireNotification(Context context, int id) {
        if (id <= 0) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(Math.abs(Integer.toString(id).hashCode()));
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        ensureAlarmChannels(this);
        Map<String, String> data = remoteMessage.getData();
        if ("fire".equals(data.get("type"))) {
            showFire(data);
        } else if ("crime".equals(data.get("type"))) {
            showCrime(data);
        } else if ("panic".equals(data.get("type"))) {
            showPanic(data);
        } else if ("radio".equals(data.get("type"))) {
            showRadio(data);
        } else if ("chat_message".equals(data.get("type"))) {
            showChat(data);
        }
        super.onMessageReceived(remoteMessage);
    }

    /** Stil on the home screen. -1 stays quiet until they turn sound back on. Panic is never included. */
    static boolean isQuiet(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(QUIET_PREFS, Context.MODE_PRIVATE);
        long until = prefs.getLong("until", 0L);
        if (until == 0L) return false;
        if (until < 0L) return true;
        if (until > System.currentTimeMillis()) return true;
        prefs.edit().remove("until").apply();
        return false;
    }

    /** High enough for the lock-screen card, with no tone and no vibration. */
    private void ensureQuietCardChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(QUIET_CARD_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(QUIET_CARD_CHANNEL_ID, "Stil", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Kaart sonder klank");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private String channelFor(boolean quiet, String loudChannel) {
        if (!quiet) return loudChannel;
        ensureQuietCardChannel();
        return QUIET_CARD_CHANNEL_ID;
    }

    private void showChat(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "Klets";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Nuwe boodskap.";
        String url = data.get("url");
        if (url == null) url = "/chat";

        boolean quiet = isQuiet(this);
        if (!quiet) ensureChatChannel();

        Intent open = new Intent(this, ChatAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        if (quiet) open.putExtra(EXTRA_SILENT, true);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = (data.get("messageId") != null ? data.get("messageId").hashCode() : url.hashCode()) ^ 0x43a7;
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder note = new NotificationCompat.Builder(this, channelFor(quiet, CHAT_CHANNEL_ID))
                .setSmallIcon(R.drawable.ic_chat_bubble)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true);
        if (quiet) note.setSilent(true);
        Notification notification = note.build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            int id = data.get("messageId") != null ? Math.abs(data.get("messageId").hashCode()) : 75001;
            manager.notify(id, notification);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            try {
                startActivity(open);
            } catch (Exception ignored) {
                /* The full-screen notification still opens the card when they tap it. */
            }
        }
    }

    private void showFire(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "VUUR";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Daar is 'n vuur in die gebied.";
        String url = data.get("url");
        if (url == null) url = "/live-incident";
        int incidentId = 0;
        String rawId = data.get("incidentId");
        if (rawId != null) {
            try {
                incidentId = Integer.parseInt(rawId.trim());
            } catch (NumberFormatException ignored) {
                incidentId = 0;
            }
        }
        if (incidentId > 0 && isFireIgnored(this, incidentId)) return;

        boolean quiet = isQuiet(this);

        Intent open = new Intent(this, FireAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        open.putExtra(EXTRA_INCIDENT_ID, incidentId);
        int notifyId = rawId != null ? Math.abs(rawId.hashCode()) : 71001;
        open.putExtra(EXTRA_NOTIFY_ID, notifyId);
        if (quiet) open.putExtra(EXTRA_SILENT, true);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = url.hashCode();
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder note = new NotificationCompat.Builder(this, channelFor(quiet, CHANNEL_ID))
                .setSmallIcon(R.drawable.ic_fire_flame)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true);
        if (quiet) note.setSilent(true);
        Notification notification = note.build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notifyId, notification);
            String tag = data.get("tag");
            if (tag != null && !tag.isEmpty()) manager.cancel(tag, 0);
        }

        // Appear-on-top lets the card cover the screen while the phone is unlocked.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            try {
                startActivity(open);
            } catch (Exception ignored) {
                /* The full-screen notification still opens the card when they tap it. */
            }
        }
    }

    private void showCrime(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "MISDAAD";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Daar is 'n misdaad aangemeld.";
        String url = data.get("url");
        if (url == null) url = "/misdaad";

        boolean quiet = isQuiet(this);

        Intent open = new Intent(this, CrimeAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        if (quiet) open.putExtra(EXTRA_SILENT, true);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = url.hashCode() ^ 0x4d15;
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder note = new NotificationCompat.Builder(this, channelFor(quiet, CRIME_CHANNEL_ID))
                .setSmallIcon(R.drawable.ic_crime_gate)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true);
        if (quiet) note.setSilent(true);
        Notification notification = note.build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            int id = data.get("incidentId") != null ? Math.abs(data.get("incidentId").hashCode()) : 72001;
            manager.notify(id, notification);
            String tag = data.get("tag");
            if (tag != null && !tag.isEmpty()) manager.cancel(tag, 0);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            try {
                startActivity(open);
            } catch (Exception ignored) {
                /* The full-screen notification still opens the card when they tap it. */
            }
        }
    }

    private void showPanic(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "PANIEK";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Iemand het paniek gestuur.";
        String url = data.get("url");
        if (url == null) url = "/live-incident";

        ensureAlarmChannels(this);

        Intent open = new Intent(this, PanicAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = url.hashCode() ^ 0x7a11;
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, PANIC_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_panic_alert)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true)
                .build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            int id = data.get("incidentId") != null ? Math.abs(data.get("incidentId").hashCode()) : 73001;
            manager.notify(id, notification);
            String tag = data.get("tag");
            if (tag != null && !tag.isEmpty()) manager.cancel(tag, 0);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            try {
                startActivity(open);
            } catch (Exception ignored) {
                /* The full-screen notification still opens the card when they tap it. */
            }
        }
    }

    private void showRadio(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) title = "RADIO";
        String body = data.get("body");
        if (body == null || body.trim().isEmpty()) body = "Stemboodskap op die groep.";
        String url = data.get("url");
        if (url == null) url = "/dashboard";
        String clipUrl = data.get("clipUrl");

        boolean quiet = isQuiet(this);

        Intent open = new Intent(this, RadioAlertActivity.class);
        open.putExtra(EXTRA_TITLE, title);
        open.putExtra(EXTRA_BODY, body);
        open.putExtra(EXTRA_URL, url);
        if (clipUrl != null) open.putExtra(EXTRA_CLIP_URL, clipUrl);
        if (quiet) open.putExtra(EXTRA_SILENT, true);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int request = (clipUrl != null ? clipUrl.hashCode() : url.hashCode()) ^ 0x5a01;
        PendingIntent fullScreen = PendingIntent.getActivity(
                this,
                request,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder note = new NotificationCompat.Builder(this, channelFor(quiet, RADIO_CHANNEL_ID))
                .setSmallIcon(R.drawable.ic_panic_alert)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(fullScreen)
                .setFullScreenIntent(fullScreen, true)
                .addAction(0, "Speel weer", fullScreen);
        if (quiet) note.setSilent(true);
        Notification notification = note.build();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            int id = clipUrl != null ? Math.abs(clipUrl.hashCode()) : 74001;
            manager.notify(id, notification);
            String tag = data.get("tag");
            if (tag != null && !tag.isEmpty()) manager.cancel(tag, 0);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            try {
                startActivity(open);
            } catch (Exception ignored) {
                /* The full-screen notification still opens the card when they tap it. */
            }
        }
    }

    /** Loud alarm channels. A new id is required because Android will not change the sound on a channel that already exists. */
    public static void ensureAlarmChannels(android.content.Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        for (String oldId : new String[] { "omt_vuur_loud", "omt_misdaad_loud", "omt_misdaad_alarm" }) {
            if (manager.getNotificationChannel(oldId) != null) manager.deleteNotificationChannel(oldId);
        }
        createAlarmChannel(context, manager, CHANNEL_ID, "Vuur", "Vuurwaarskuwing", R.raw.alarm_vuur, false);
        createAlarmChannel(context, manager, CRIME_CHANNEL_ID, "Misdaad", "Misdaadwaarskuwing", R.raw.alarm_misdaad, false);
        createAlarmChannel(context, manager, PANIC_CHANNEL_ID, "Paniek", "Paniekwaarskuwing met sirene", R.raw.alarm_siren, true);
        createRadioChannel(context, manager);
    }

    /**
     * Radio static on its own channel, so a phone that is out of the app hears
     * the distortion before the voice. The old channel stays silent because the
     * server still posts the fallback there, and that one is cancelled once the card is up.
     */
    private static void createRadioChannel(android.content.Context context, NotificationManager manager) {
        if (manager.getNotificationChannel(RADIO_LEGACY_CHANNEL_ID) == null) {
            NotificationChannel legacy = new NotificationChannel(RADIO_LEGACY_CHANNEL_ID, "Radio", NotificationManager.IMPORTANCE_HIGH);
            legacy.setDescription("Stemboodskap op die groep");
            legacy.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            legacy.enableVibration(true);
            legacy.setVibrationPattern(new long[] { 0, 180, 120, 180 });
            legacy.setBypassDnd(true);
            legacy.setSound(null, null);
            manager.createNotificationChannel(legacy);
        }
        if (manager.getNotificationChannel(RADIO_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(RADIO_CHANNEL_ID, "Radio", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Radiogeruis vir 'n stemboodskap");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 280, 80, 280, 80, 280 });
        channel.setBypassDnd(true);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.alarm_radio), attrs);
        manager.createNotificationChannel(channel);
    }

    private static void createAlarmChannel(
            android.content.Context context,
            NotificationManager manager,
            String id,
            String name,
            String description,
            int soundRes,
            boolean panic
    ) {
        if (manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setVibrationPattern(panic
                ? new long[] { 0, 700, 200, 700, 200, 700 }
                : new long[] { 0, 180, 120, 180 });
        channel.setBypassDnd(panic);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(panic ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(Uri.parse("android.resource://" + context.getPackageName() + "/" + soundRes), attrs);
        manager.createNotificationChannel(channel);
    }

    private void ensureChatChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHAT_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHAT_CHANNEL_ID, "Chat messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Direct and group chat messages");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 180, 120, 180 });
        manager.createNotificationChannel(channel);
    }

    private void ensureChannel() {
        ensureAlarmChannels(this);
    }

    private void ensureCrimeChannel() {
        ensureAlarmChannels(this);
    }
}
