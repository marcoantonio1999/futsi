package com.futsi.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

@CapacitorPlugin(name = "RoleReminders", permissions = {
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public class RoleReminderPlugin extends Plugin {
    private static final String CHANNEL = "role_reminders";
    private static final String ALARM = "com.futsi.app.ROLE_REMINDER";
    private static final long DAY = 24 * 60 * 60 * 1000L;

    private static SharedPreferences storage(Context context) {
        return context.getSharedPreferences(CHANNEL, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarm(Context context) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ALARM);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    }

    private static boolean allowed(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    @PluginMethod public void status(PluginCall call) {
        call.resolve(new JSObject().put("enabled", allowed(getContext())));
    }

    @PluginMethod public void enable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionResult");
        } else {
            status(call);
        }
    }

    @PermissionCallback private void permissionResult(PluginCall call) {
        status(call);
    }

    @PluginMethod public void sync(PluginCall call) {
        String tournament = call.getString("tournament");
        String name = call.getString("name");
        JSONArray rounds = call.getArray("rounds");
        if (tournament == null || name == null || rounds == null) {
            call.reject("Faltan datos de la jornada.");
            return;
        }
        Context context = getContext();
        JSONArray entries = new JSONArray();
        try {
            for (int index = 0; index < rounds.length(); index++) {
                JSONObject round = rounds.getJSONObject(index);
                String key = tournament + "/" + round.getInt("id");
                Calendar end = Calendar.getInstance(TimeZone.getTimeZone("America/Mexico_City"));
                SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT);
                dateFormat.setLenient(false);
                dateFormat.setTimeZone(end.getTimeZone());
                end.setTime(dateFormat.parse(round.getString("ends")));
                long first = end.getTimeInMillis();
                end.add(Calendar.DATE, 1);
                end.set(Calendar.HOUR_OF_DAY, 9);
                end.set(Calendar.MINUTE, 0);
                long second = end.getTimeInMillis();
                if (second + DAY <= System.currentTimeMillis()) continue;
                String title = name + " · Jornada " + round.getInt("number");
                entries.put(new JSONObject().put("key", key).put("title", title)
                    .put("first", first).put("second", second));
            }
        } catch (JSONException | ParseException error) {
            call.reject("No se pudieron leer los horarios de las jornadas.", error);
            return;
        }
        storage(context).edit().putString("tournament:" + tournament, entries.toString()).apply();
        schedule(context);
        call.resolve();
    }

    @PluginMethod public void shared(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("Falta la jornada.");
            return;
        }
        Context context = getContext();
        storage(context).edit().putLong("shared:" + key, System.currentTimeMillis()).apply();
        NotificationManagerCompat.from(context).cancel(key + ":first", 0);
        schedule(context);
        call.resolve();
    }

    @PluginMethod public void clear(PluginCall call) {
        Context context = getContext();
        storage(context).edit().clear().apply();
        context.getSystemService(AlarmManager.class).cancel(alarm(context));
        NotificationManagerCompat.from(context).cancelAll();
        call.resolve();
    }

    private static synchronized void schedule(Context context) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (!allowed(context)) {
            manager.cancel(alarm(context));
            return;
        }
        SharedPreferences preferences = storage(context);
        SharedPreferences.Editor updates = preferences.edit();
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        for (String entry : preferences.getAll().keySet()) {
            if (!entry.startsWith("tournament:")) {
                if (preferences.getLong(entry, 0) < now - 45 * DAY) updates.remove(entry);
                continue;
            }
            try {
                JSONArray entries = new JSONArray(preferences.getString(entry, "[]"));
                JSONArray upcoming = new JSONArray();
                for (int index = 0; index < entries.length(); index++) {
                    JSONObject round = entries.getJSONObject(index);
                    long second = round.getLong("second");
                    if (second + DAY <= now) continue;
                    upcoming.put(round);
                    String key = round.getString("key");
                    if (now < second && !preferences.contains("shared:" + key)) {
                        next = Math.min(next, deliver(context, preferences, updates, round, "first", now));
                    }
                    next = Math.min(next, deliver(context, preferences, updates, round, "second", now));
                }
                updates.putString(entry, upcoming.toString());
            } catch (JSONException error) {
                updates.remove(entry);
            }
        }
        updates.apply();
        if (next == Long.MAX_VALUE) manager.cancel(alarm(context));
        else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm(context));
    }

    private static long deliver(Context context, SharedPreferences preferences, SharedPreferences.Editor updates,
                                JSONObject round, String phase, long now) throws JSONException {
        String tag = round.getString("key") + ":" + phase;
        if (preferences.contains("delivered:" + tag)) return Long.MAX_VALUE;
        long due = round.getLong(phase);
        if (due > now) return due;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Recordatorios de roles de juego", NotificationManager.IMPORTANCE_DEFAULT));
        }
        PendingIntent openApp = PendingIntent.getActivity(context, 0,
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE);
        manager.notify(tag, 0, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(round.getString("title"))
            .setContentText(phase.equals("first") ? "Terminó la jornada. Comparte el rol de juego actualizado."
                : "Recordatorio del día siguiente: revisa el rol de juego actualizado.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(openApp)
            .build());
        updates.putLong("delivered:" + tag, now);
        return Long.MAX_VALUE;
    }

    public static class ReminderReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            schedule(context);
        }
    }
}
