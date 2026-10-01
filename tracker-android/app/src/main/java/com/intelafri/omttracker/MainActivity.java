package com.intelafri.omttracker;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final int REQ_RUNTIME = 41;

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private TextView statusView;
    private EditText codeView;
    private Button enrolButton;
    private Button stopButton;
    private boolean enrolling;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        statusView = findViewById(R.id.status);
        codeView = findViewById(R.id.code);
        enrolButton = findViewById(R.id.enrol);
        stopButton = findViewById(R.id.stop);
        enrolButton.setOnClickListener(v -> enrol());
        stopButton.setOnClickListener(v -> stopReporting());
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
        if (TrackerStore.token(this) != null && hasForegroundLocation()) {
            TrackerService.start(this);
        }
    }

    @Override
    protected void onDestroy() {
        network.shutdownNow();
        super.onDestroy();
    }

    private void render() {
        String token = TrackerStore.token(this);
        boolean linked = token != null;
        codeView.setVisibility(linked ? View.GONE : View.VISIBLE);
        enrolButton.setVisibility(linked ? View.GONE : View.VISIBLE);
        stopButton.setVisibility(linked ? View.VISIBLE : View.GONE);
        if (!linked) {
            statusView.setText("Enter the tracker code from the asset in OMT.");
            return;
        }
        String name = TrackerStore.name(this);
        StringBuilder text = new StringBuilder();
        text.append("Reporting as ").append(TextUtils.isEmpty(name) ? "this asset" : name).append(".\n\n");
        text.append("You can leave this screen. Tracking continues while the location notification is showing. After a restart, open OMT Tracker once.");
        long sent = TrackerStore.lastSentAt(this);
        if (sent > 0) {
            text.append("\n\nLast sent ")
                    .append(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(sent)))
                    .append(".");
        }
        String error = TrackerStore.lastError(this);
        if (!TextUtils.isEmpty(error)) {
            text.append("\n\nLast report did not reach OMT: ").append(error);
        }
        if (!hasForegroundLocation()) {
            text.append("\n\nLocation permission is required before this tablet can report.");
        }
        statusView.setText(text.toString());
    }

    private void enrol() {
        if (enrolling) return;
        String code = codeView.getText().toString().trim().toUpperCase();
        if (!code.matches("[A-F0-9]{8}")) {
            statusView.setText("Enter the 8-character tracker code from OMT.");
            return;
        }
        if (!ensureRuntimePermissions()) return;
        enrolling = true;
        enrolButton.setEnabled(false);
        statusView.setText("Linking this tablet…");
        network.execute(() -> {
            try {
                TrackerApi.EnrolResult result = TrackerApi.enrol(code);
                runOnUiThread(() -> {
                    enrolling = false;
                    enrolButton.setEnabled(true);
                    TrackerStore.saveEnrolment(this, result.deviceToken, result.name);
                    TrackerService.start(this);
                    render();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    enrolling = false;
                    enrolButton.setEnabled(true);
                    String message = error.getMessage() == null ? "Could not reach OMT" : error.getMessage();
                    statusView.setText(message);
                });
            }
        });
    }

    private void stopReporting() {
        TrackerStore.clear(this);
        stopService(new Intent(this, TrackerService.class));
        render();
    }

    private boolean ensureRuntimePermissions() {
        List<String> missing = new ArrayList<>();
        if (!hasForegroundLocation()) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (missing.isEmpty()) return true;
        ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQ_RUNTIME);
        return false;
    }

    private boolean hasForegroundLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RUNTIME && hasForegroundLocation()) {
            enrol();
        }
        render();
    }
}
