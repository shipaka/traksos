package ru.traksos.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import ru.rustore.sdk.pushclient.RuStorePushClient
import java.lang.ref.WeakReference

/** Оболочка: сайт ТракSOS в WebView + мост для пушей и вызовов */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    /** Страница не отозвалась как сайт ТракSOS — через 20 секунд покажем экран ошибки вместо белого */
    private var failed = false
    private val watchdog = Runnable { showOffline(getString(R.string.server_timeout)) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString TrakSOSApp/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(WebBridge(this), "TrakSOSNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url
                // Свой сайт — внутри; карты, телефоны и прочее — во внешних приложениях
                if (url.host == Uri.parse(Session.server(this@MainActivity)).host) return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (_: Exception) { true }
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                web.removeCallbacks(watchdog)
                if (url.startsWith("http")) { failed = false; web.postDelayed(watchdog, 20_000) }
            }
            override fun onPageFinished(view: WebView, url: String) {
                web.removeCallbacks(watchdog)
                if (!url.startsWith("http") || failed) return
                // По адресу может отвечать что угодно (пустой домен, заглушка) — проверяем, что это наш сайт
                view.evaluateJavascript("!!document.querySelector('meta[name=traksos-app]')") { ok ->
                    if (ok != "true") showOffline(getString(R.string.server_not_traksos))
                }
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) showOffline(getString(R.string.no_connection) + " (" + err.description + ")")
            }
            override fun onReceivedHttpError(view: WebView, req: WebResourceRequest, res: WebResourceResponse) {
                if (req.isForMainFrame) showOffline(getString(R.string.server_error, res.statusCode))
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasLocation()) callback.invoke(origin, true, false)
                else {
                    geoCallback = callback
                    geoOrigin = origin
                    ActivityCompat.requestPermissions(this@MainActivity,
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_LOCATION)
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        web.loadUrl(urlFor(intent.getStringExtra(EXTRA_PATH)))
        askNotifications()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_PATH)?.let { path ->
            web.evaluateJavascript("location.hash = ${JSONObject.quote("#/$path")}", null)
        }
    }

    override fun onResume() {
        super.onResume()
        foreground = true
    }

    override fun onPause() {
        foreground = false
        super.onPause()
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    /** Открыть сайт заново — после «Повторить» или смены адреса сервера */
    fun reload() = web.post { web.loadUrl(urlFor(null)) }

    private fun urlFor(path: String?) = Session.server(this).trimEnd('/') + "/" + (path?.let { "#/$it" } ?: "")

    private fun hasLocation() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    /** Android 14+: показ на весь экран нужно разрешить в настройках (спрашиваем только у исполнителей) */
    fun askFullScreenIfNeeded() {
        if (Build.VERSION.SDK_INT < 34) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.canUseFullScreenIntent()) return
        AlertDialog.Builder(this)
            .setTitle(R.string.fullscreen_title)
            .setMessage(R.string.fullscreen_text)
            .setPositiveButton(R.string.open_settings) { _, _ ->
                startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
            }
            .setNegativeButton(R.string.later, null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) {
            geoCallback?.invoke(geoOrigin, grantResults.any { it == PackageManager.PERMISSION_GRANTED }, false)
            geoCallback = null
        }
    }

    /** Экран ошибки: что случилось, «Повторить» и поле адреса сервера (для тестового стенда) */
    private fun showOffline(reason: String) {
        failed = true
        web.removeCallbacks(watchdog)
        val q = { t: String -> JSONObject.quote(t) }
        val html = """
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="background:#15171A;color:#F2F2F0;font-family:sans-serif;margin:0;padding:32px 24px;text-align:center">
        <h2 style="color:#FF6A13;margin-top:15vh">ТракSOS</h2>
        <p id="r" style="line-height:1.5"></p>
        <button onclick="TrakSOSNative.retry()" style="margin:16px 0 40px;padding:14px 28px;border:0;border-radius:14px;
          background:#FF6A13;color:#15171A;font-weight:bold;font-size:16px">${getString(R.string.retry)}</button>
        <p style="color:#9A9C9F;font-size:14px">${getString(R.string.server_address)}</p>
        <input id="u" inputmode="url" autocapitalize="off" autocorrect="off" style="width:100%;box-sizing:border-box;padding:14px;
          border-radius:12px;border:1px solid #33363B;background:#1F2226;color:#F2F2F0;font-size:15px">
        <button onclick="TrakSOSNative.setServer(document.getElementById('u').value)" style="margin-top:12px;width:100%;padding:14px;
          border:1px solid #FF6A13;border-radius:14px;background:none;color:#FF6A13;font-weight:bold;font-size:15px">${getString(R.string.server_save)}</button>
        <p style="color:#6B6E72;font-size:12px;margin-top:12px">${getString(R.string.server_hint)}</p>
        <script>document.getElementById('r').textContent=${q(reason)};document.getElementById('u').value=${q(Session.server(this))};
        window.addEventListener('online',()=>TrakSOSNative.retry())</script></body></html>
        """.trimIndent()
        web.post { web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null) }
    }

    fun evalEvent(name: String, data: Map<String, String>) {
        val detail = JSONObject(data as Map<*, *>).toString()
        web.post {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('traksos-native',{detail:{name:${JSONObject.quote(name)},data:$detail}}))", null)
        }
    }

    companion object {
        const val EXTRA_PATH = "path"
        private const val REQ_LOCATION = 10
        private const val REQ_NOTIFY = 11
        private var current: WeakReference<MainActivity>? = null

        /** Приложение на экране: вызов показывает сама страница (со звуком), нативный экран не нужен */
        @Volatile var foreground = false

        /** Событие для веб-страницы, если она открыта */
        fun emit(name: String, data: Map<String, String>) {
            current?.get()?.evalEvent(name, data)
        }
    }
}

/** То, что доступно странице как window.TrakSOSNative */
class WebBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun isApp(): Boolean = true

    /** Экран ошибки: «Повторить» */
    @JavascriptInterface
    fun retry() = activity.reload()

    /** Экран ошибки: другой адрес сервера (тестовый стенд). Пусто — адрес по умолчанию. */
    @JavascriptInterface
    fun setServer(url: String) {
        Session.setServer(activity, url)
        activity.reload()
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    /** Страница передаёт токен входа: нужен для «Беру» с экрана блокировки и отправки токена пушей */
    @JavascriptInterface
    fun setSession(apiUrl: String, token: String?) {
        Session.save(activity, apiUrl, token?.takeIf { it.isNotEmpty() })
    }

    /** Токен RuStore Push (может быть пустым, пока не пришёл) */
    @JavascriptInterface
    fun pushToken(): String {
        Session.pushToken(activity)?.let { return it }
        if (BuildConfig.RUSTORE_PROJECT_ID.isNotEmpty()) {
            try {
                RuStorePushClient.getToken()
                    .addOnSuccessListener { t ->
                        Session.savePushToken(activity, t)
                        Session.sendPushToken(activity, t)
                        MainActivity.emit("pushToken", mapOf("token" to t))
                    }
            } catch (_: Throwable) { }
        }
        return ""
    }

    /** Исполнитель вышел на линию — проверим, разрешён ли показ вызова на весь экран */
    @JavascriptInterface
    fun performerOnline() {
        activity.runOnUiThread { activity.askFullScreenIfNeeded() }
    }
}
