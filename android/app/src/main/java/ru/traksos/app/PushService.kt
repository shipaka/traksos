package ru.traksos.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService

/**
 * Пуши RuStore. Сервер шлёт только data-сообщения:
 *   kind=call   — входящая заявка → экран вызова на 30 секунд;
 *   kind=normal — статус заявки, сообщение в чате → обычное уведомление.
 */
class PushService : RuStoreMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Session.savePushToken(this, token)
        Session.sendPushToken(this, token)
        MainActivity.emit("pushToken", mapOf("token" to token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["kind"]) {
            "call" -> if (!MainActivity.foreground) CallNotifier.show(this, data)
            else -> showNormal(data)
        }
    }

    private fun showNormal(data: Map<String, String>) {
        val orderId = data["orderId"]
        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (orderId != null) putExtra(MainActivity.EXTRA_PATH, "order/$orderId")
        }
        val pi = PendingIntent.getActivity(this, (orderId ?: "main").hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, TrakSosApp.CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(getColor(R.color.accent))
            .setContentTitle(data["title"] ?: getString(R.string.app_name))
            .setContentText(data["body"] ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(data["body"] ?: ""))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        getSystemService(NotificationManager::class.java).notify((orderId ?: "x").hashCode(), n)
    }
}
