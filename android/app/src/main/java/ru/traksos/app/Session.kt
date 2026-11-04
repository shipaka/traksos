package ru.traksos.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Токен входа и адрес сервера — чтобы «Беру» с экрана блокировки работало без открытия веб-страницы */
object Session {
    private const val PREFS = "traksos"

    fun save(ctx: Context, apiUrl: String, token: String?) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("apiUrl", apiUrl)
            .putString("token", token)
            .apply()
        // токен пушей мог прийти раньше входа — отправим теперь
        pushToken(ctx)?.let { sendPushToken(ctx, it) }
    }

    fun apiUrl(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("apiUrl", null) ?: BuildConfig.APP_URL

    fun token(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", null)

    fun savePushToken(ctx: Context, t: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("pushToken", t).apply()
    }

    fun pushToken(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("pushToken", null)

    fun sendPushToken(ctx: Context, pushToken: String) {
        if (token(ctx) == null) return
        post(ctx, "/api/me/push-token", JSONObject().put("provider", "rustore").put("token", pushToken)) { _, _ -> }
    }

    fun delete(ctx: Context, path: String, done: (ok: Boolean, code: Int) -> Unit) = request(ctx, "DELETE", path, null, done)

    /** POST к API в фоне; колбэк — в фоновом потоке */
    fun post(ctx: Context, path: String, body: JSONObject = JSONObject(), done: (ok: Boolean, code: Int) -> Unit) =
        request(ctx, "POST", path, body, done)

    private fun request(ctx: Context, method: String, path: String, body: JSONObject?, done: (ok: Boolean, code: Int) -> Unit) {
        val base = apiUrl(ctx)
        val auth = token(ctx)
        thread {
            var code = 0
            try {
                val c = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
                c.requestMethod = method
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                if (auth != null) c.setRequestProperty("authorization", "Bearer $auth")
                if (body != null) {
                    c.doOutput = true
                    c.setRequestProperty("content-type", "application/json")
                    c.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                code = c.responseCode
                c.disconnect()
            } catch (e: Exception) {
                Log.w(TrakSosApp.TAG, "$method $path не прошёл", e)
            }
            done(code in 200..299, code)
        }
    }
}
