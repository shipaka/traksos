package ru.traksos.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.URI
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Токен входа и адрес сервера — чтобы «Беру» с экрана блокировки работало без открытия веб-страницы */
object Session {
    private const val PREFS = "traksos"

    private fun trustedOrigin(ctx: Context, url: String): Boolean = try {
        val target = URI(server(ctx))
        val candidate = URI(url)
        candidate.scheme.equals("https", ignoreCase = true) &&
            candidate.host.equals(target.host, ignoreCase = true) &&
            (candidate.port == -1 || candidate.port == target.port) &&
            candidate.rawUserInfo == null
    } catch (_: Exception) { false }

    fun save(ctx: Context, apiUrl: String, token: String?) {
        if (!trustedOrigin(ctx, apiUrl)) {
            Log.w(TrakSosApp.TAG, "Blocked session update from an unexpected API origin")
            return
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("apiUrl", server(ctx))
            .putString("token", token)
            .apply()
        // токен пушей мог прийти раньше входа — отправим теперь
        pushToken(ctx)?.let { sendPushToken(ctx, it) }
    }

    fun apiUrl(ctx: Context): String {
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("apiUrl", null)
        return if (saved != null && trustedOrigin(ctx, saved)) saved else server(ctx)
    }

    /** Адрес сайта: заданный в приложении (тестовый стенд) или вшитый при сборке */
    fun server(ctx: Context): String =
        if (BuildConfig.DEBUG) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("server", null) ?: BuildConfig.APP_URL
        } else {
            // A public RuStore release cannot silently switch to a third-party server.
            BuildConfig.APP_URL
        }

    /** В тестовой сборке открываем демо, пока пользователь не указал реальный HTTPS-стенд. */
    fun hasCustomServer(ctx: Context): Boolean =
        !ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("server", null).isNullOrBlank()

    /** Возвращает false для небезопасного или некорректного адреса. */
    fun setServer(ctx: Context, raw: String): Boolean {
        if (!BuildConfig.DEBUG) return false
        var u = raw.trim().trimEnd('/')
        if (u.isNotEmpty() && !u.contains("://")) u = "https://$u"
        if (u.isNotEmpty()) {
            val valid = try {
                val parsed = URI(u)
                parsed.scheme.equals("https", ignoreCase = true) &&
                    !parsed.host.isNullOrBlank() &&
                    parsed.rawUserInfo == null &&
                    parsed.rawQuery == null &&
                    parsed.rawFragment == null &&
                    (parsed.port == -1 || parsed.port in 1..65535)
            } catch (_: Exception) { false }
            if (!valid) return false
        }
        // Сервер сменился — старый вход и адрес API к нему не относятся
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .apply { if (u.isEmpty()) remove("server") else putString("server", u) }
            .remove("apiUrl").remove("token")
            .apply()
        return true
    }

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
