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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Lock-screen misdaad card. A short tone, not the paniek siren. */
public class CrimeAlertActivity extends AppCompatActivity {
    private MediaPlayer player;

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
        setContentView(R.layout.activity_crime_alert);
        ImageView logo = findViewById(R.id.crime_logo);
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
        if (title == null || title.trim().isEmpty()) title = "MISDAAD";
        if (body == null) body = "";

        TextView time = findViewById(R.id.crime_time);
        TextView date = findViewById(R.id.crime_date);
        TextView titleView = findViewById(R.id.crime_title);
        TextView bodyView = findViewById(R.id.crime_body);
        Date now = new Date();
        time.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(now));
        String written = new SimpleDateFormat("EEEE d MMM", new Locale("af")).format(now);
        date.setText(written.substring(0, 1).toUpperCase(new Locale("af")) + written.substring(1));
        titleView.setText(title);
        bodyView.setText(body);

        findViewById(R.id.crime_card).setOnClickListener(v -> openReport());
        findViewById(R.id.crime_open).setOnClickListener(v -> openReport());
        findViewById(R.id.crime_go).setOnClickListener(v -> openGo());
        if (!intent.getBooleanExtra(OmtMessagingService.EXTRA_SILENT, false)) playGate();
    }

    private void playGate() {
        stopGate();
        try {
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            android.content.res.AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.alarm_misdaad);
            next.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            next.setLooping(false);
            next.setVolume(0.7f, 0.7f);
            next.prepare();
            next.start();
            player = next;
        } catch (Exception ignored) {
            /* The notification channel still has the same tone. */
        }
    }

    private void openReport() {
        openPath(getIntent().getStringExtra(OmtMessagingService.EXTRA_URL));
    }

    private void openGo() {
        String url = getIntent().getStringExtra(OmtMessagingService.EXTRA_URL);
        if (url != null && url.startsWith("/misdaad") && !url.contains("go=1")) {
            url = url + (url.contains("?") ? "&" : "?") + "go=1";
        }
        openPath(url);
    }

    private void openPath(String url) {
        Intent open = new Intent(this, MainActivity.class);
        if (url != null && url.startsWith("/")) {
            open.putExtra(OmtMessagingService.EXTRA_URL, url);
        }
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(open);
        finish();
    }

    private void stopGate() {
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
        stopGate();
        super.onDestroy();
    }
}
