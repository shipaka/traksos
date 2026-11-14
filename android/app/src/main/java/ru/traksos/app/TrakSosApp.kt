package ru.traksos.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import ru.rustore.sdk.pushclient.RuStorePushClient

class TrakSosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createChannels()
        if (BuildConfig.RUSTORE_PROJECT_ID.isNotEmpty()) {
            try {
                RuStorePushClient.init(this, BuildConfig.RUSTORE_PROJECT_ID)
            } catch (e: Throwable) {
                Log.w(TAG, "RuStore Push не запустился", e)
            }
        } else {
            Log.w(TAG, "RUSTORE_PROJECT_ID не задан — пуши выключены")
        }
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        val calls = NotificationChannel(CHANNEL_CALLS, getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH).apply {
            description = getString(R.string.channel_calls_desc)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            // DND bypass is permitted only after the user grants policy access.
            if (nm.isNotificationPolicyAccessGranted) setBypassDnd(true)
        }
        val general = NotificationChannel(CHANNEL_GENERAL, getString(R.string.channel_general), NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = getString(R.string.channel_general_desc)
        }
        nm.createNotificationChannel(calls)
        nm.createNotificationChannel(general)
    }

    companion object {
        const val TAG = "TrakSOS"
        const val CHANNEL_CALLS = "calls_v1"
        const val CHANNEL_GENERAL = "general_v1"
    }
}
