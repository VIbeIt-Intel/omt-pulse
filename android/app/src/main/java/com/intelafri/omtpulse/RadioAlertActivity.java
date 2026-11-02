package com.intelafri.omtpulse;

import android.content.Intent;
import android.graphics.Outline;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Lock-screen radio card. A radio-static burst gets attention, then the voice note plays. Speel weer repeats it without opening the app. */
public class RadioAlertActivity extends AppCompatActivity {
    private MediaPlayer player;
    private TextView bodyView;
    private TextView titleView;
    private File voiceFile;
    private String clipUrl;
    private String spokenBody = "Stemboodskap op die groep.";
    private boolean attentionFinished;
    private boolean voiceStarted;
    private boolean downloading;
    private boolean replayWhenReady;
    private boolean silent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        );
        setContentView(R.layout.activity_radio_alert);
        ImageView logo = findViewById(R.id.radio_logo);
        logo.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        logo.setClipToOutline(true);

        Intent intent = getIntent();
        String title = intent.getStringExtra(OmtMessagingService.EXTRA_TITLE);
        String body = intent.getStringExtra(OmtMessagingService.EXTRA_BODY);
        if (title == null || title.trim().isEmpty()) title = "RADIO";
        if (body == null || body.trim().isEmpty()) body = "Stemboodskap op die groep.";

        TextView time = findViewById(R.id.radio_time);
        TextView date = findViewById(R.id.radio_date);
        titleView = findViewById(R.id.radio_title);
        bodyView = findViewById(R.id.radio_body);
        Date now = new Date();
        time.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(now));
        String written = new SimpleDateFormat("EEEE d MMM", new Locale("af")).format(now);
        date.setText(written.substring(0, 1).toUpperCase(new Locale("af")) + written.substring(1));
        titleView.setText(title);
        bodyView.setText("Laai stem…");

        findViewById(R.id.radio_card).setOnClickListener(v -> openApp());
        findViewById(R.id.radio_open).setOnClickListener(v -> openApp());
        findViewById(R.id.radio_replay).setOnClickListener(v -> replayVoice());

        applyClip(intent);
        silent = intent.getBooleanExtra(OmtMessagingService.EXTRA_SILENT, false);
        if (!silent) playAttention();
        else attentionFinished = true;
        beginDownload();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String title = intent.getStringExtra(OmtMessagingService.EXTRA_TITLE);
        if (title == null || title.trim().isEmpty()) title = "RADIO";
        titleView.setText(title);
        applyClip(intent);
        if (!intent.getBooleanExtra(OmtMessagingService.EXTRA_SILENT, false)) replayVoice();
    }

    private void applyClip(Intent intent) {
        String nextUrl = intent.getStringExtra(OmtMessagingService.EXTRA_CLIP_URL);
        String body = intent.getStringExtra(OmtMessagingService.EXTRA_BODY);
        if (body == null || body.trim().isEmpty()) body = "Stemboodskap op die groep.";
        spokenBody = body;
        if (nextUrl != null && !nextUrl.equals(clipUrl)) {
            voiceFile = null;
            voiceStarted = false;
        }
        clipUrl = nextUrl;
    }

    /** Hear the same voice note again. Stays on this card. */
    private void replayVoice() {
        attentionFinished = true;
        voiceStarted = true;
        if (voiceFile != null && voiceFile.exists()) {
            play(voiceFile);
            return;
        }
        replayWhenReady = true;
        if (!downloading) beginDownload();
    }

    private void beginDownload() {
        if (clipUrl == null || !clipUrl.startsWith("https://")) {
            bodyView.setText(spokenBody);
            return;
        }
        if (voiceFile != null && voiceFile.exists()) {
            if (replayWhenReady) {
                replayWhenReady = false;
                play(voiceFile);
            } else {
                maybePlayVoice();
            }
            return;
        }
        if (downloading) return;
        downloading = true;
        bodyView.setText("Laai stem…");
        final String url = clipUrl;
        new Thread(() -> {
            File file = download(url);
            runOnUiThread(() -> {
                downloading = false;
                if (isFinishing()) return;
                if (!url.equals(clipUrl)) return;
                if (file == null) {
                    bodyView.setText("Kon nie die stem laai nie.");
                    return;
                }
                voiceFile = file;
                bodyView.setText(spokenBody);
                if (replayWhenReady) {
                    replayWhenReady = false;
                    attentionFinished = true;
                    voiceStarted = true;
                    play(voiceFile);
                } else if (!silent) {
                    maybePlayVoice();
                }
            });
        }, "radio-clip").start();
    }

    /** Short radio distortion so the phone is heard before the voice starts. */
    private void playAttention() {
        stopVoice();
        try {
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            android.content.res.AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.alarm_radio);
            next.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            next.setLooping(false);
            next.setVolume(1f, 1f);
            next.setOnCompletionListener(done -> {
                if (player == done) player = null;
                try {
                    done.release();
                } catch (Exception ignored) {
                    /* already released */
                }
                attentionFinished = true;
                maybePlayVoice();
            });
            next.prepare();
            next.start();
            player = next;
        } catch (Exception ignored) {
            attentionFinished = true;
            maybePlayVoice();
        }
    }

    private void maybePlayVoice() {
        if (!attentionFinished || voiceFile == null || voiceStarted || isFinishing()) return;
        voiceStarted = true;
        play(voiceFile);
    }

    private File download(String clipUrl) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(clipUrl).openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
            conn.setInstanceFollowRedirects(true);
            if (conn.getResponseCode() != 200) return null;
            File out = new File(getCacheDir(), "radio-clip.wav");
            try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                int total = 0;
                while ((n = in.read(buf)) >= 0) {
                    total += n;
                    if (total > 4 * 1024 * 1024) return null;
                    fos.write(buf, 0, n);
                }
            }
            return out.length() > 0 ? out : null;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void play(File file) {
        stopVoice();
        try {
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            next.setDataSource(file.getAbsolutePath());
            next.setLooping(false);
            next.setVolume(1f, 1f);
            next.prepare();
            next.start();
            player = next;
        } catch (Exception ignored) {
            bodyView.setText("Kon nie die stem speel nie.");
        }
    }

    private void openApp() {
        String url = getIntent().getStringExtra(OmtMessagingService.EXTRA_URL);
        Intent open = new Intent(this, MainActivity.class);
        if (url != null && url.startsWith("/")) {
            open.putExtra(OmtMessagingService.EXTRA_URL, url);
        }
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(open);
        finish();
    }

    private void stopVoice() {
        if (player == null) return;
        try {
            player.stop();
        } catch (Exception ignored) {
            /* already stopped */
        }
        player.release();
        player = null;
    }

    @Override
    protected void onDestroy() {
        stopVoice();
        super.onDestroy();
    }
}
