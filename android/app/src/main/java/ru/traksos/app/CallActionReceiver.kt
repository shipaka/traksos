package ru.traksos.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import android.os.Handler
import android.os.Looper

/** Кнопки «Беру» / «Отклонить» прямо в уведомлении */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val orderId = intent.getStringExtra(CallNotifier.EXTRA_ORDER) ?: return
        val action = intent.action ?: return
        CallNotifier.cancel(ctx, orderId)
        respond(ctx.applicationContext, orderId, action == ACCEPT)
    }

    companion object {
        const val ACCEPT = "ru.traksos.app.ACCEPT"
        const val DECLINE = "ru.traksos.app.DECLINE"

        fun pending(ctx: Context, orderId: String, action: String): PendingIntent {
            val i = Intent(ctx, CallActionReceiver::class.java).setAction(action).putExtra(CallNotifier.EXTRA_ORDER, orderId)
            return PendingIntent.getBroadcast(ctx, (action + orderId).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        /** Ответ на вызов: при «Беру» открываем заявку в приложении */
        fun respond(ctx: Context, orderId: String, accept: Boolean, onDone: ((Boolean) -> Unit)? = null) {
            val path = if (accept) "/api/orders/$orderId/accept" else "/api/orders/$orderId/decline"
            Session.post(ctx, path) { ok, code ->
                Handler(Looper.getMainLooper()).post {
                    if (accept && ok) {
                        ctx.startActivity(Intent(ctx, MainActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                            putExtra(MainActivity.EXTRA_PATH, "order/$orderId")
                        })
                    } else if (accept) {
                        val text = if (code == 409) "Заявку уже забрали или время вышло" else "Не получилось — проверьте интернет"
                        Toast.makeText(ctx, text, Toast.LENGTH_LONG).show()
                    }
                    MainActivity.emit("callAction", mapOf("orderId" to orderId, "action" to if (accept) "accept" else "decline", "handled" to "true"))
                    onDone?.invoke(ok)
                }
            }
        }
    }
}
