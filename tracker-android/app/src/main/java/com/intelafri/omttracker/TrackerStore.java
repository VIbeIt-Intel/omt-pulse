package com.intelafri.omttracker;

import android.content.Context;
import android.content.SharedPreferences;

public final class TrackerStore {
    private static final String PREFS = "omt_tracker";
    private static final String TOKEN = "token";
    private static final String NAME = "name";
    static final String LAST_SENT_AT = "last_sent_at";
    static final String LAST_ERROR = "last_error";

    private TrackerStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveEnrolment(Context context, String token, String name) {
        prefs(context).edit()
                .putString(TOKEN, token)
                .putString(NAME, name)
                .remove(LAST_ERROR)
                .apply();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    static String token(Context context) {
        return prefs(context).getString(TOKEN, null);
    }

    static String name(Context context) {
        return prefs(context).getString(NAME, null);
    }

    static void markSent(Context context, long atMillis) {
        prefs(context).edit()
                .putLong(LAST_SENT_AT, atMillis)
                .remove(LAST_ERROR)
                .apply();
    }

    static void markError(Context context, String message) {
        prefs(context).edit().putString(LAST_ERROR, message).apply();
    }

    static long lastSentAt(Context context) {
        return prefs(context).getLong(LAST_SENT_AT, 0L);
    }

    static String lastError(Context context) {
        return prefs(context).getString(LAST_ERROR, null);
    }
}
