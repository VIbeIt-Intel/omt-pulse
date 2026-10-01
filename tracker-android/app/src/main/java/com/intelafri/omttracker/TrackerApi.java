package com.intelafri.omttracker;

import android.location.Location;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class TrackerApi {
    static final String BASE = "https://omtpulse.com";

    private TrackerApi() {}

    static final class EnrolResult {
        final String deviceToken;
        final String name;

        EnrolResult(String deviceToken, String name) {
            this.deviceToken = deviceToken;
            this.name = name;
        }
    }

    static EnrolResult enrol(String code) throws Exception {
        JSONObject body = new JSONObject();
        body.put("code", code.trim().toUpperCase());
        HttpResult result = post(BASE + "/api/assets/enrol", body.toString(), null);
        if (result.code < 200 || result.code >= 300) {
            throw new IllegalStateException(message(result, "That code was not accepted"));
        }
        JSONObject json = new JSONObject(result.body);
        String token = json.optString("deviceToken", "");
        if (token.isEmpty()) {
            throw new IllegalStateException("OMT did not return a tracker token");
        }
        return new EnrolResult(token, json.optString("name", "Asset"));
    }

    /** @return false when OMT rejected the token and this tablet should stop. */
    static boolean heartbeat(String token, Location location, Integer batteryPercent) throws Exception {
        JSONObject body = new JSONObject();
        body.put("latitude", location.getLatitude());
        body.put("longitude", location.getLongitude());
        if (location.hasAccuracy()) body.put("accuracy", location.getAccuracy());
        if (batteryPercent != null) body.put("batteryPercent", batteryPercent);
        long time = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        body.put("time", time);
        String url = BASE + "/api/assets/heartbeat?token=" + URLEncoder.encode(token, "UTF-8");
        HttpResult result = post(url, body.toString(), token);
        if (result.code == 401) return false;
        if (result.code < 200 || result.code >= 300) {
            throw new IllegalStateException(message(result, "Location was not accepted"));
        }
        return true;
    }

    private static String message(HttpResult result, String fallback) {
        try {
            String parsed = new JSONObject(result.body).optString("message", "");
            if (!parsed.isEmpty()) return parsed;
        } catch (Exception ignored) {
            // Response was not JSON.
        }
        return fallback;
    }

    private static HttpResult post(String url, String json, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "OMTTracker/1.0");
        if (token != null) {
            connection.setRequestProperty("x-omt-asset-token", token);
        }
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(bytes);
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return new HttpResult(code, read(stream));
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }

    private static final class HttpResult {
        final int code;
        final String body;

        HttpResult(int code, String body) {
            this.code = code;
            this.body = body == null ? "" : body;
        }
    }
}
