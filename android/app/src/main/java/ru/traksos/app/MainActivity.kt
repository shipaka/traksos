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
                // Предупреждение Codespaces «Вы собираетесь получить доступ к порту…» — пропускаем, там кнопка «Продолжить»
                view.evaluateJavascript("!!document.querySelector('meta[name=traksos-app]') || document.title.indexOf('Codespaces') === 0") { ok ->
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
        <html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
        <style>*{box-sizing:border-box}body{margin:0;background:#15171a;color:#f4f4f2;font-family:Arial,sans-serif}
        header{padding:20px;background:#202327;display:flex;justify-content:space-between;align-items:center}
        strong.logo{font-size:24px;color:#ff761c}.badge{font-size:11px;color:#a8adb2}
        main{padding:18px 18px 85px}.alert,.card{border-radius:14px;padding:16px;margin-bottom:14px}
        .alert{background:#35291d;border:1px solid #86603a;font-size:13px;line-height:1.5}
        .card{background:#25292e;border:1px solid #363b41}h2{margin:22px 0 12px}
        p{font-size:14px;color:#b5bac0;line-height:1.5}
        button.action{padding:13px;border:0;border-radius:12px;background:#ff771c;color:#171717;font-weight:bold;width:100%;font-size:15px}
        button.secondary{padding:13px;border:1px solid #ff771c;border-radius:12px;background:none;color:#ff8f43;width:100%}
        .page{display:none}.page.active{display:block}
        nav{position:fixed;bottom:0;display:flex;width:100%;background:#202327;border-top:1px solid #41454a}
        nav button{flex:1;padding:17px 0;background:none;border:0;color:#b5bac0;font-size:12px}
        nav button.active{color:#ff8f43;font-weight:bold}
        input{width:100%;padding:14px;border:1px solid #454b51;border-radius:10px;background:#15171a;color:white;margin-bottom:12px}
        </style></head><body><header><strong class="logo">ТракSOS</strong><span class="badge">АВТОНОМНОЕ ДЕМО</span></header>
        <main><div class="alert">Сервер TrackSOS ещё не запущен. Это демонстрация интерфейса: реальные вызовы, заявки, вход и загрузка документов отключены.</div>
        <section class="page active" id="home"><h2>Помощь грузовику</h2>
        <div class="card"><b>🚨 Срочная помощь</b><p>Вызов специалиста при поломке на дороге.</p><button class="action" onclick="show('sos')">Открыть SOS</button></div>
        <div class="card"><b>🔧 Выездной мастер</b><p>Электрик, диагностика и ремонт на месте.</p><button class="secondary" onclick="show('orders')">Заявки</button></div>
        <div class="card"><b>🚛 Эвакуатор</b><p>Помощь с транспортировкой грузового автомобиля.</p></div></section>
        <section class="page" id="sos"><h2>Вызов SOS</h2><div class="card"><b>Экстренная заявка</b><p>После подключения сервера здесь будут адрес, тип поломки, стоимость и поиск исполнителя.</p><button class="action" onclick="alert('Это демонстрация. SOS-вызов не отправлен.')">Проверить кнопку SOS</button></div></section>
        <section class="page" id="orders"><h2>Мои заявки</h2><div class="card"><b>Заявок нет</b><p>История, чат, исполнители и документы появятся после запуска системы.</p></div></section>
        <section class="page" id="profile"><h2>Личный кабинет</h2><div class="card"><b>Профиль · демо</b><p>Автомобили, страховки, документы и личные данные будут доступны после подключения сервера.</p></div>
        <button class="secondary" onclick="document.getElementById('setup').style.display='block'">Настроить тестовый сервер</button>
        <div id="setup" style="display:none"><p>Введите HTTPS-адрес работающего тестового стенда.</p><input id="u" placeholder="https://тестовый-сервер"><button class="action" onclick="TrakSOSNative.setServer(document.getElementById('u').value)">Сохранить и открыть</button><p id="r"></p></div></section></main>
        <nav><button id="tab-home" class="active" onclick="show('home')">Главная</button><button id="tab-sos" onclick="show('sos')">SOS</button><button id="tab-orders" onclick="show('orders')">Заявки</button><button id="tab-profile" onclick="show('profile')">Кабинет</button></nav>
        <script>function show(id){document.querySelectorAll('.page').forEach(function(e){e.classList.toggle('active',e.id===id)});document.querySelectorAll('nav button').forEach(function(e){e.classList.toggle('active',e.id==='tab-'+id)});scrollTo(0,0)}
        document.getElementById('u').value=SERVER_VALUE;document.getElementById('r').textContent=REASON_VALUE;</script></body></html>
        """.trimIndent().replace("SERVER_VALUE", q(Session.server(this))).replace("REASON_VALUE", q(reason))
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
