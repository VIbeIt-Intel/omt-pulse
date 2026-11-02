package com.intelafri.omtpulse;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Lock-screen paniek card. The siren repeats until the card is opened. */
public class PanicAlertActivity extends AppCompatActivity {
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
        setContentView(R.layout.activity_panic_alert);

        Intent intent = getIntent();
        String title = intent.getStringExtra(OmtMessagingService.EXTRA_TITLE);
        String body = intent.getStringExtra(OmtMessagingService.EXTRA_BODY);
        if (title == null || title.trim().isEmpty()) title = "PANIEK";
        if (body == null) body = "";

        TextView time = findViewById(R.id.panic_time);
        TextView date = findViewById(R.id.panic_date);
        TextView titleView = findViewById(R.id.panic_title);
        TextView bodyView = findViewById(R.id.panic_body);
        Date now = new Date();
        time.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(now));
        String written = new SimpleDateFormat("EEEE d MMM", new Locale("af")).format(now);
        date.setText(written.substring(0, 1).toUpperCase(new Locale("af")) + written.substring(1));
        titleView.setText(title);
        bodyView.setText(body);

        findViewById(R.id.panic_card).setOnClickListener(v -> openReport());
        findViewById(R.id.panic_open).setOnClickListener(v -> openPanic());
        findViewById(R.id.panic_details).setOnClickListener(v -> openReport());
        playSiren();
    }

    private void playSiren() {
        stopSiren();
        try {
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                audio.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
            }
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            android.content.res.AssetFileDescriptor afd = getResources().openRawResourceFd(R.raw.alarm_siren);
            next.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            next.setLooping(true);
            next.setVolume(1f, 1f);
            next.prepare();
            next.start();
            player = next;
        } catch (Exception ignored) {
            /* The notification channel still has the siren. */
        }
    }

    private void openPanic() {
        openPath(getIntent().getStringExtra(OmtMessagingService.EXTRA_URL));
    }

    private void openReport() {
        String url = getIntent().getStringExtra(OmtMessagingService.EXTRA_URL);
        String report = "/paniek";
        if (url != null) {
            int q = url.indexOf("join=");
            if (q >= 0) {
                String id = url.substring(q + 5);
                int amp = id.indexOf('&');
                if (amp >= 0) id = id.substring(0, amp);
                report = "/paniek?report=" + id;
            }
        }
        openPath(report);
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

    private void stopSiren() {
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
        stopSiren();
        super.onDestroy();
    }
}
