package com.futsi.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(EnrollmentPrintPlugin.class);
        if (getPackageName().equals("mx.bpoweracademy.inscripciones")) {
            registerPlugin(RoleReminderPlugin.class);
        }
        super.onCreate(state);
        if (getPackageName().equals("mx.bpoweracademy.inscripciones")) {
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    if (getBridge().getWebView().canGoBack()) getBridge().getWebView().goBack();
                    else moveTaskToBack(true);
                }
            });
        }
    }
}
