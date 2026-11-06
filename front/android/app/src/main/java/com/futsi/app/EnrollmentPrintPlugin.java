package com.futsi.app;

import android.content.Context;
import android.content.ContentValues;
import android.content.Intent;
import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "EnrollmentPrint")
public class EnrollmentPrintPlugin extends Plugin {
    @PluginMethod
    public void saveRolePng(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (filename == null || !filename.matches("[\\p{L}\\p{N}-]+\\.png") || data == null) {
            call.reject("La imagen no es válida.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/png");
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(call, intent, "finishRolePng");
            return;
        }
        Uri uri = null;
        var resolver = getContext().getContentResolver();
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, "image/png");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            writeRolePng(uri, data);
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            call.resolve();
        } catch (Exception error) {
            if (uri != null) resolver.delete(uri, null, null);
            call.reject("No se pudo guardar la imagen.");
        }
    }

    @ActivityCallback
    private void finishRolePng(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Descarga cancelada.");
            return;
        }
        try {
            writeRolePng(result.getData().getData(), call.getString("data"));
            call.resolve();
        } catch (Exception error) {
            call.reject("No se pudo guardar la imagen.");
        }
    }

    private void writeRolePng(Uri uri, String data) throws IOException {
        if (uri == null) throw new IOException();
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) throw new IOException();
            output.write(Base64.decode(data, Base64.DEFAULT));
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                manager.print("Inscripciones BPower", getBridge().getWebView().createPrintDocumentAdapter("Inscripciones BPower"),
                    new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                call.resolve();
            } catch (Exception error) { call.reject("No se pudo abrir la impresión."); }
        });
    }
}
