package ru.traksos.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.ImageView
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.GeolocationPermissions
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebSettings
import androidx.activity.result.contract.ActivityResultContracts
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import android.os.SystemClock
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import ru.rustore.sdk.pushclient.RuStorePushClient
import java.lang.ref.WeakReference

/** Оболочка: сайт TrakSOS в WebView + мост для пушей и вызовов */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var appRoot: FrameLayout
    private var lockCover: View? = null
    private var unlockInProgress = false
    private var pausedAt = 0L
    private val appLockPrefs by lazy { getSharedPreferences("traksos_app_security", MODE_PRIVATE) }
    private val allowedAuthenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL

    /** Fast unlock only protects foreground UI. It does not log out a worker or change line status. */
    fun appLockEnabled(): Boolean = appLockPrefs.getBoolean("enabled", false)

    fun setAppLockEnabled(value: Boolean): Boolean {
        if (value && BiometricManager.from(this).canAuthenticate(allowedAuthenticators) != BiometricManager.BIOMETRIC_SUCCESS)
            return false
        appLockPrefs.edit().putBoolean("enabled", value).apply()
        return true
    }

    private fun requireAppUnlock() {
        if (lockCover != null || unlockInProgress || !appLockEnabled() || Session.token(this) == null) return
        val cover = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(5, 23, 41))
            isClickable = true
            isFocusable = true
            contentDescription = "TrakSOS заблокирован. Разблокируйте устройство."
        }
        val label = TextView(this).apply {
            text = "TrakSOS\\nРазблокируйте приложение"
            textSize = 21f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        cover.addView(label, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        appRoot.addView(cover, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        lockCover = cover
        // Treat the covered WebView as background for incoming-call notifications.
        // A ringing job must not get stuck invisibly behind the unlock screen.
        foreground = false
        requestAppUnlock()
    }

    private fun requestAppUnlock() {
        if (unlockInProgress || lockCover == null) return
        unlockInProgress = true
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    unlockInProgress = false
                    lockCover?.let { appRoot.removeView(it) }
                    lockCover = null
                    foreground = true
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    unlockInProgress = false
                    // No access to the WebView when cancelled: tap the cover to retry.
                }
            })
        lockCover?.setOnClickListener { requestAppUnlock() }
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
            .setTitle("Разблокировать TrakSOS")
            .setSubtitle("Отпечаток пальца или код блокировки телефона")
            .setAllowedAuthenticators(allowedAuthenticators)
            .build())
    }
    private lateinit var bundledAssets: WebViewAssetLoader
    private var startupOverlay: View? = null
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val files = if (result.resultCode == RESULT_OK) {
            when {
                data?.clipData != null -> {
                    val clips = data.clipData!!
                    (0 until clips.itemCount).map { clips.getItemAt(it).uri }.toTypedArray()
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else null
        fileUploadCallback?.onReceiveValue(files)
        fileUploadCallback = null
    }
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    /** Страница не отозвалась как сайт TrakSOS — через 20 секунд покажем экран ошибки вместо белого */
    private var failed = false
    private val watchdog = Runnable { showOffline(getString(R.string.server_timeout)) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        // Same official HTTPS origin: UI resources live in the APK, API calls stay on the network.
        bundledAssets = WebViewAssetLoader.Builder()
            .setDomain(Uri.parse(Session.server(this)).host ?: "traksos.ru")
            .addPathHandler("/", BundledWeb(this))
            .build()
        web = WebView(this)
        val root = FrameLayout(this)
        appRoot = root
        // Android 15 enforces edge-to-edge. The web header must not sit behind
        // clock, network/battery icons or the bottom gesture navigation bar.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.rgb(5, 23, 41)
        window.navigationBarColor = Color.rgb(5, 23, 41)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        startupOverlay = createStartupOverlay()
        root.addView(startupOverlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            // Picked documents use content:// URIs granted by Android's system file picker.
            // File:// access remains disabled; no untrusted external iframe is loaded.
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString TrakSOSApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        // Only the packaged official HTTPS origin receives the native bridge in release.
        web.addJavascriptInterface(WebBridge(this), "TrakSOSNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.scheme != "https") return null
                // Never embed untrusted third-party frames into a WebView with a JS bridge.
                // External user-initiated links open separately through Android.
                if (!url.host.equals(Uri.parse(Session.server(this@MainActivity)).host, ignoreCase = true)) {
                    return WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(byteArrayOf()))
                }
                return bundledAssets.shouldInterceptRequest(url)
            }
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val url = req.url
                // Свой сайт — внутри; карты, телефоны и прочее — во внешних приложениях
                if (url.scheme == "https" &&
                    url.host.equals(Uri.parse(Session.server(this@MainActivity)).host, ignoreCase = true)) return false
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
                    if (ok == "true") hideStartupOverlay()
                    else showOffline(getString(R.string.server_not_traksos))
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
            override fun onShowFileChooser(
                view: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
                this@MainActivity.fileUploadCallback?.onReceiveValue(null)
                this@MainActivity.fileUploadCallback = filePathCallback
                return try {
                    val choose = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    filePicker.launch(Intent.createChooser(choose, "Выберите фото или документ"))
                    true
                } catch (_: Exception) {
                    this@MainActivity.fileUploadCallback?.onReceiveValue(null)
                    this@MainActivity.fileUploadCallback = null
                    false
                }
            }

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

        // Отладочный APK сразу показывает автономное демо, пока тестовый стенд не задан.
        // Release-сборка по умолчанию открывает официальный сервер.
        web.loadUrl(urlFor(intent.getStringExtra(EXTRA_PATH)))
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
        val elapsed = SystemClock.elapsedRealtime()
        if (appLockEnabled() && Session.token(this) != null &&
            (pausedAt == 0L || elapsed - pausedAt > 20_000L)) requireAppUnlock()
        if (lockCover != null) foreground = false
    }

    override fun onPause() {
        foreground = false
        pausedAt = SystemClock.elapsedRealtime()
        super.onPause()
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        fileUploadCallback?.onReceiveValue(null)
        fileUploadCallback = null
        super.onDestroy()
    }

    /** Открыть сайт заново — после «Повторить» или смены адреса сервера */
    fun reload() = web.post {
        web.loadUrl(urlFor(null))
    }

    private fun urlFor(path: String?) = Session.server(this).trimEnd('/') + "/" + (path?.let { "#/$it" } ?: "")

    private fun hasLocation() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    /** Android 14+: показ на весь экран нужно разрешить в настройках (спрашиваем только у исполнителей) */
    fun askFullScreenIfNeeded() {
        askNotifications()
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


    /** Лёгкая заставка: показывается ТОЛЬКО пока WebView загружает и проверяет сайт.
     * Дизайн ориентирован на согласованный первый splash-концепт:
     * navy + magenta, логотип и индикатор, без лишних запросов к серверу.
     * Локальный ресурс splash_truck.webp — адаптация грузовика из утверждённого референса,
     * доступна без интернета. Логотип и индикатор рисуются нативно поверх фотографии.
     */
    private fun createStartupOverlay(): View {
        val screen = FrameLayout(this)
        screen.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.rgb(4, 19, 36), Color.rgb(9, 33, 60), Color.rgb(30, 17, 43))
        )
        val density = resources.displayMetrics.density
        val art = ImageView(this)
        art.setImageResource(R.drawable.splash_truck)
        art.scaleType = ImageView.ScaleType.CENTER_CROP
        art.contentDescription = "Брендированный грузовик TrakSOS в Санкт-Петербурге"
        val artParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            (resources.displayMetrics.heightPixels * 0.56f).toInt(),
            Gravity.BOTTOM
        )
        artParams.bottomMargin = (63 * density).toInt()
        screen.addView(art, artParams)

        val stack = LinearLayout(this)
        stack.orientation = LinearLayout.VERTICAL
        stack.gravity = Gravity.CENTER_HORIZONTAL
        val container = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        )
        container.gravity = Gravity.TOP
        container.topMargin = (resources.displayMetrics.heightPixels * 0.12f).toInt()
        container.leftMargin = (28 * density).toInt()
        container.rightMargin = container.leftMargin

        val title = TextView(this)
        val brand = SpannableString("TrakSOS")
        brand.setSpan(ForegroundColorSpan(Color.rgb(254, 28, 122)), 5, 8, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        title.text = brand
        title.textSize = 37f
        title.typeface = Typeface.create("sans-serif-black", Typeface.BOLD_ITALIC)
        title.setTextColor(Color.WHITE)
        title.gravity = Gravity.CENTER
        stack.addView(title)

        val subtitle = TextView(this)
        subtitle.text = "Помощь грузовику в дороге"
        subtitle.textSize = 16f
        subtitle.setTextColor(Color.rgb(208, 224, 240))
        subtitle.gravity = Gravity.CENTER
        val subLayout = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        subLayout.topMargin = (14 * resources.displayMetrics.density).toInt()
        stack.addView(subtitle, subLayout)

        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        progress.isIndeterminate = true
        progress.progressTintList = ColorStateList.valueOf(Color.rgb(255, 27, 121))
        progress.indeterminateTintList = ColorStateList.valueOf(Color.rgb(255, 27, 121))
        val progressLayout = LinearLayout.LayoutParams((185 * resources.displayMetrics.density).toInt(), (5 * resources.displayMetrics.density).toInt())
        progressLayout.gravity = Gravity.CENTER
        screen.addView(stack, container)
        val progressAtBottom = FrameLayout.LayoutParams(
            (190 * density).toInt(), (5 * density).toInt(), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        )
        progressAtBottom.bottomMargin = (38 * density).toInt()
        screen.addView(progress, progressAtBottom)
        return screen
    }

    private fun hideStartupOverlay() {
        startupOverlay?.visibility = View.GONE
        startupOverlay = null
    }

    /** Экран ошибки: что случилось, «Повторить» и поле адреса сервера (для тестового стенда) */
    private fun showOffline(reason: String) {
        hideStartupOverlay()
        failed = true
        web.removeCallbacks(watchdog)
        if (!BuildConfig.DEBUG) {
            val safeReason = android.text.TextUtils.htmlEncode(reason)
            val html = """
            <html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>*{box-sizing:border-box}body{background:linear-gradient(155deg,#041326,#112c49 65%,#28102e);margin:0;
            display:flex;align-items:center;justify-content:center;min-height:100vh;color:white;font-family:Arial,sans-serif}
            main{padding:28px;max-width:430px;text-align:center}
            h1{font-size:36px;font-weight:900}em{font-style:normal;color:#fc1978}
            p{line-height:1.55;color:#c9d9eb}button{background:#ef146a;color:white;width:100%;border:1px solid #ff74b0;
            border-radius:14px;padding:16px;font-size:17px;font-weight:700;margin-top:22px}
            small{color:#acbfd4;display:block;margin-top:15px;line-height:1.4}
            </style></head><body><main><h1>Track<em>SOS</em></h1>
            <p>Нет связи с сервером TrakSOS. Проверьте интернет и попробуйте снова.</p>
            <button onclick="TrakSOSNative.retry()">Повторить подключение</button>
            <small>$safeReason</small></main></body></html>
            """.trimIndent()
            web.post { web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null) }
            return
        }
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
        </style></head><body><header><strong class="logo">TrakSOS</strong><span class="badge">АВТОНОМНОЕ ДЕМО</span></header>
        <main><div class="alert">Сервер TrakSOS ещё не запущен. Это демонстрация интерфейса: реальные вызовы, заявки, вход и загрузка документов отключены.</div>
        <section class="page active" id="home"><h2>Помощь грузовику</h2>
        <div class="card"><b>🚨 Срочная помощь</b><p>Вызов специалиста при поломке на дороге.</p><button class="action" onclick="show('sos')">Открыть SOS</button></div>
        <div class="card"><b>🔧 Выездной мастер</b><p>Электрик, диагностика и ремонт на месте.</p><button class="secondary" onclick="show('orders')">Заявки</button></div>
        <div class="card"><b>🚛 Эвакуатор</b><p>Помощь с транспортировкой грузового автомобиля.</p></div></section>
        <section class="page" id="sos"><h2>Вызов SOS</h2><div class="card"><b>Экстренная заявка</b><p>После подключения сервера здесь будут адрес, тип поломки, стоимость и поиск исполнителя.</p><button class="action" onclick="alert('Это демонстрация. SOS-вызов не отправлен.')">Проверить кнопку SOS</button></div></section>
        <section class="page" id="orders"><h2>Мои заявки</h2><div class="card"><b>Заявок нет</b><p>История, чат, исполнители и документы появятся после запуска системы.</p></div></section>
        <section class="page" id="profile"><h2>Личный кабинет</h2><div class="card"><b>Профиль · демо</b><p>Автомобили, страховки, документы и личные данные будут доступны после подключения сервера.</p></div>
        <button class="secondary" onclick="document.getElementById('setup').style.display='block'">Настроить тестовый сервер</button>
        <div id="setup" style="display:none"><p>Введите HTTPS-адрес работающего тестового стенда.</p><input id="u" placeholder="https://тестовый-сервер"><button class="action" onclick="TrakSOSNative.setServer(document.getElementById('u').value)">Сохранить и открыть</button>
        <button class="secondary" style="margin-top:10px" onclick="TrakSOSNative.setServer('')">Вернуться в автономное демо</button><p id="r"></p></div></section></main>
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
        if (!BuildConfig.DEBUG) return
        if (Session.setServer(activity, url)) {
            activity.reload()
        } else {
            activity.runOnUiThread {
                android.widget.Toast.makeText(activity, "Укажите корректный HTTPS-адрес сервера", android.widget.Toast.LENGTH_LONG).show()
            }
        }
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    /** Страница передаёт токен входа: нужен для «Беру» с экрана блокировки и отправки токена пушей */
    @JavascriptInterface
    fun setSession(apiUrl: String, token: String?) {
        Session.save(activity, apiUrl, token?.takeIf { it.isNotEmpty() })
        if (!token.isNullOrEmpty()) activity.runOnUiThread { activity.askNotifications() }
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

    /** Opt-in app lock. Android system credentials are used, never a home-made PIN database. */
    @JavascriptInterface
    fun appLockEnabled(): Boolean = activity.appLockEnabled()

    @JavascriptInterface
    fun setAppLockEnabled(value: Boolean): Boolean = activity.setAppLockEnabled(value)

    /** Исполнитель вышел на линию — проверим, разрешён ли показ вызова на весь экран */
    @JavascriptInterface
    fun performerOnline() {
        activity.runOnUiThread { activity.askFullScreenIfNeeded() }
    }
}
