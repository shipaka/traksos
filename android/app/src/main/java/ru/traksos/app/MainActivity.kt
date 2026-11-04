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
                if (url.host == Uri.parse(BuildConfig.APP_URL).host) return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (_: Exception) { true }
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) view.loadData(offlinePage(), "text/html; charset=utf-8", "utf-8")
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

    private fun urlFor(path: String?) = BuildConfig.APP_URL.trimEnd('/') + "/" + (path?.let { "#/$it" } ?: "")

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

    private fun offlinePage() = """
        <html><body style="background:#15171A;color:#F2F2F0;font-family:sans-serif;display:flex;flex-direction:column;
        justify-content:center;align-items:center;height:100vh;margin:0;padding:24px;text-align:center">
        <h2 style="color:#FF6A13">ТракSOS</h2><p>${getString(R.string.no_connection)}</p>
        <button onclick="location.href='${BuildConfig.APP_URL}'" style="margin-top:16px;padding:14px 24px;border:0;border-radius:14px;
        background:#FF6A13;color:#15171A;font-weight:bold;font-size:16px">${getString(R.string.retry)}</button>
        <script>window.addEventListener('online',()=>location.href='${BuildConfig.APP_URL}')</script></body></html>
    """.trimIndent()

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
