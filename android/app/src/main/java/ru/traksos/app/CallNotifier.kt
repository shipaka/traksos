package ru.traksos.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/** Входящая заявка: уведомление-звонок с экраном поверх блокировки и кнопками «Беру» / «Отклонить» */
object CallNotifier {
    const val EXTRA_ORDER = "orderId"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_RING_UNTIL = "ringUntil"
    const val EXTRA_AUCTION = "auction"

    fun notificationId(orderId: String) = ("call:$orderId").hashCode()

    fun show(ctx: Context, data: Map<String, String>) {
        val orderId = data["orderId"] ?: return
        val ringUntil = data["ringUntil"]?.let { parseIso(it) } ?: (System.currentTimeMillis() + 30_000)
        val left = ringUntil - System.currentTimeMillis()
        if (left <= 1_000) return // вызов уже истёк, пока пуш шёл

        val callIntent = Intent(ctx, CallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(EXTRA_ORDER, orderId)
            putExtra(EXTRA_TITLE, data["title"] ?: ctx.getString(R.string.incoming))
            putExtra(EXTRA_BODY, data["body"] ?: "")
            putExtra(EXTRA_RING_UNTIL, ringUntil)
            putExtra(EXTRA_AUCTION, data["auction"] == "true")
        }
        val auction = data["auction"] == "true"
        val full = PendingIntent.getActivity(ctx, orderId.hashCode(), callIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val n = NotificationCompat.Builder(ctx, TrakSosApp.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(ctx.getColor(R.color.accent))
            .setContentTitle(data["title"] ?: ctx.getString(R.string.incoming))
            .setContentText(data["body"] ?: "")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(left)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(0, ctx.getString(R.string.decline), CallActionReceiver.pending(ctx, orderId, CallActionReceiver.DECLINE, auction))
            .addAction(0, ctx.getString(R.string.accept), CallActionReceiver.pending(ctx, orderId, CallActionReceiver.ACCEPT, auction))
            .build()
        n.flags = n.flags or android.app.Notification.FLAG_INSISTENT // звук повторяется, пока не ответят
        ctx.getSystemService(NotificationManager::class.java).notify(notificationId(orderId), n)
    }

    fun cancel(ctx: Context, orderId: String) {
        ctx.getSystemService(NotificationManager::class.java).cancel(notificationId(orderId))
    }

    private fun parseIso(s: String): Long? = try {
        java.time.Instant.parse(s).toEpochMilli()
    } catch (e: Exception) {
        null
    }
}
