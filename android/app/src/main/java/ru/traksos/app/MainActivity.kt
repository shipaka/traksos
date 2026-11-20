package ru.traksos.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.KeyguardManager
import android.content.Intent
import android.content.ClipData
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
import android.provider.MediaStore
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
import androidx.core.content.FileProvider
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
import java.io.File
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
        if (value) {
            // Combined strong biometrics + system PIN is unsupported on Android 10 and older.
            val available = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                BiometricManager.from(this).canAuthenticate(allowedAuthenticators) == BiometricManager.BIOMETRIC_SUCCESS
            } else {
                (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
            }
            if (!available) return false
        }
        appLockPrefs.edit().putBoolean("enabled", value).apply()
        return true
    }

    private val credentialLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        unlockInProgress = false
        if (result.resultCode == RESULT_OK) completeAppUnlock()
    }

    private fun completeAppUnlock() {
        unlockInProgress = false
        lockCover?.let { appRoot.removeView(it) }
        lockCover = null
        foreground = true
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
        lockCover?.setOnClickListener { requestAppUnlock() }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            // Use the OS-protected lock-screen credential on Android 7–10.
            // AndroidX rejects BIOMETRIC_STRONG | DEVICE_CREDENTIAL on Android 9–10.
            val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
            val intent = keyguard.createConfirmDeviceCredentialIntent(
                "Разблокировать TrakSOS", "Подтвердите код или пароль телефона")
            if (intent == null) { unlockInProgress = false; return }
            try { credentialLauncher.launch(intent) } catch (_: Exception) { unlockInProgress = false }
            return
        }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    completeAppUnlock()
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    unlockInProgress = false
                    // No access to the WebView when cancelled: tap the cover to retry.
                }
            })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
            .setTitle("Разблокировать TrakSOS")
            .setSubtitle("Отпечаток пальца или код блокировки телефона")
            .setAllowedAuthenticators(allowedAuthenticators)
            .build())
    }
    private lateinit var bundledAssets: WebViewAssetLoader
    private var startupOverlay: View? = null
    // Only the owner's actual 19 Nov clean loading art is shown; obsolete seasonal backgrounds were retired.
    private var startupShownAt = 0L
    private var debugUiReadyLogged = false
    private val startupMinimumVisibleMs = 3_500L
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private var pendingCameraFile: File? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val captured = result.resultCode == RESULT_OK &&
            (pendingCameraFile?.length() ?: 0L) > 0L &&
            data?.clipData == null && data?.data == null
        val files = if (result.resultCode == RESULT_OK) {
            when {
                data?.clipData != null -> {
                    val clips = data.clipData!!
                    (0 until clips.itemCount).map { clips.getItemAt(it).uri }.toTypedArray()
                }
                data?.data != null -> arrayOf(data.data!!)
                captured -> pendingCameraUri?.let { arrayOf(it) }
                else -> null
            }
        } else null
        // Cache only the chosen full-resolution capture, not cancelled attempts.
        if (!captured) pendingCameraFile?.delete()
        pendingCameraUri = null
        pendingCameraFile = null
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
        // Legacy Android 10 Google-API system images can carry Chromium WebView 74.
        // On a headless/software GPU its hardware-backed surface may stay blank,
        // even while JS and the React guest screen run normally. Use the CPU
        // compositor only for that outdated engine; current WebViews stay GPU-backed.
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.O..Build.VERSION_CODES.Q) {
            val major = WebView.getCurrentWebViewPackage()?.versionName
                ?.substringBefore('.')?.toIntOrNull()
            if (major != null && major in 1..79) {
                web.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
                if (BuildConfig.DEBUG) android.util.Log.i("TrakSOSRuntime", "LEGACY_WEBVIEW_SOFTWARE_LAYER=$major")
            }
        }
        if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val pkg = WebView.getCurrentWebViewPackage()
            android.util.Log.i("TrakSOSRuntime", "WEBVIEW_VERSION=" + (pkg?.versionName ?: "unknown"))
        }
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
        startupOverlay = SeasonalStartupOverlay.build(this)
        startupShownAt = SystemClock.elapsedRealtime()
        root.addView(startupOverlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        SeasonalStartupOverlay.refreshFromYandex(this, startupOverlay)

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
                    if (ok == "true") {
                        // Page is ready, but avoid flashing the approved weather artwork.
                        // Errors still dismiss it immediately in showOffline().
                        val shown = SystemClock.elapsedRealtime() - startupShownAt
                        val remaining = (startupMinimumVisibleMs - shown).coerceAtLeast(0L)
                        startupOverlay?.postDelayed({
                            if (!failed) {
                                val wasVisible = startupOverlay?.visibility == View.VISIBLE
                                hideStartupOverlay()
                                if (BuildConfig.DEBUG && wasVisible) {
                                    android.util.Log.i("TrakSOSRuntime",
                                        "SPLASH_VISIBLE_MS=" + (SystemClock.elapsedRealtime() - startupShownAt))
                                }
                            }
                        }, remaining)
                        checkDebugRenderedUi()
                    } else showOffline(getString(R.string.server_not_traksos))
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
            override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                if (BuildConfig.DEBUG &&
                    consoleMessage?.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.w("TrakSOSRuntime",
                        "JS_ERROR=" + (consoleMessage?.message()?.take(280) ?: "unknown"))
                }
                return super.onConsoleMessage(consoleMessage)
            }
            override fun onShowFileChooser(
                view: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
                this@MainActivity.fileUploadCallback?.onReceiveValue(null)
                this@MainActivity.fileUploadCallback = filePathCallback
                return try {
                    val accepts = fileChooserParams?.acceptTypes?.filter { it.isNotBlank() } ?: emptyList()
                    val imagesOnly = accepts.isNotEmpty() && accepts.all {
                        it.trim().startsWith("image/", ignoreCase = true)
                    }
                    val choose = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = if (imagesOnly) "image/*" else "*/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                        if (!imagesOnly) putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                            fileChooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    val camera = if (imagesOnly) {
                        val dir = File(cacheDir, "order-photos").apply { mkdirs() }
                        val output = File.createTempFile("traksos-", ".jpg", dir)
                        val uri = FileProvider.getUriForFile(this@MainActivity,
                            "${packageName}.fileprovider", output)
                        pendingCameraFile = output
                        pendingCameraUri = uri
                        Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            putExtra(MediaStore.EXTRA_OUTPUT, uri)
                            clipData = ClipData.newUri(contentResolver, "TrakSOS repair photo", uri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                        }
                    } else null
                    val launch = if (fileChooserParams?.isCaptureEnabled == true && camera != null) {
                        camera
                    } else {
                        Intent.createChooser(choose, if(imagesOnly) "Фото для заявки" else "Выберите фото или документ")
                            .apply {
                                if (camera != null)
                                    putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
                            }
                    }
                    filePicker.launch(launch)
                    true
                } catch (_: Exception) {
                    pendingCameraFile?.delete()
                    pendingCameraFile = null
                    pendingCameraUri = null
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
            if (BuildConfig.DEBUG && path.startsWith("android-review/")) {
                // The error screen uses loadDataWithBaseURL(null). Changing its
                // hash keeps the fake error HTML instead of loading APK React.
                // A fresh URL also works when the emulator has no network.
                failed = false
                web.loadUrl(urlFor(path))
            } else {
                web.evaluateJavascript("location.hash = ${JSONObject.quote("#/$path")}", null)
            }
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


    /** CI-only proof that React rendered a public screen, not merely static HTML.
     * Never logs a user profile, token, or backend response. */
    private fun checkDebugRenderedUi(attempt: Int = 0) {
        if (!BuildConfig.DEBUG || debugUiReadyLogged || failed || !::web.isInitialized) return
        web.evaluateJavascript(
            "!!(document.querySelector('main.public-landing .public-brand-hero') && " +
                "document.querySelector('.public-actions button'))"
        ) { rendered ->
            if (rendered == "true") {
                debugUiReadyLogged = true
                android.util.Log.i("TrakSOSRuntime", "GUEST_UI_RENDERED")
            } else if (attempt < 120 && !failed && !debugUiReadyLogged) {
                web.postDelayed({ checkDebugRenderedUi(attempt + 1) }, 500L)
            }
        }
    }

    private fun hideStartupOverlay() {
        startupOverlay?.visibility = View.GONE
        startupOverlay = null
    }

    /** No old mock dashboard: show an error and a real, bundled debug-only design review. */
    private fun showOffline(reason: String) {
        hideStartupOverlay()
        failed = true
        web.removeCallbacks(watchdog)
        val safeReason = android.text.TextUtils.htmlEncode(reason)
        val debugActions = if (BuildConfig.DEBUG) """
            <button class="review" onclick="TrakSOSNative.openDesignReview()">Проверить кабинеты Android</button>
            <small>Только тестовый APK: вымышленные данные без SMS, звонков и оплаты.</small>
        """.trimIndent() else ""
        val html = """
        <html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>*{box-sizing:border-box}body{background:linear-gradient(160deg,#071523,#173146 75%,#0a1a2a);
        margin:0;display:grid;place-items:center;min-height:100vh;color:white;font-family:Arial,sans-serif}
        main{padding:26px;max-width:430px;width:100%;text-align:center}
        h1{font-size:34px;font-weight:900}em{font-style:normal;color:#f88435}
        p{line-height:1.55;color:#c9d9e5}button{background:linear-gradient(#f98a31,#e9651c);color:white;
        width:100%;border:1px solid #ffa45e;border-radius:13px;padding:15px;font-size:16px;
        font-weight:750;margin-top:13px}button.review{background:#19344a;border-color:#527c95}
        small{color:#a8c1d3;display:block;margin-top:12px;line-height:1.45}
        </style></head><body><main><h1>Trak<em>SOS</em></h1>
        <p>Не удалось подключиться к серверу. Сам интерфейс приложения встроен в APK.</p>
        <button onclick="TrakSOSNative.retry()">Повторить подключение</button>
        $debugActions
        <small>$safeReason</small></main></body></html>
        """.trimIndent()
        web.post { web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null) }
    }

    /** Switch from a network error to the actual APK-packaged React workspace. */
    fun openDesignReview() {
        if (BuildConfig.DEBUG) web.post { web.loadUrl(urlFor("android-review/client")) }
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

    /** Available only in the distinct debug APK; never bypasses backend login. */
    @JavascriptInterface
    fun isPreviewBuild(): Boolean = BuildConfig.DEBUG

    @JavascriptInterface
    fun openDesignReview() {
        if (BuildConfig.DEBUG) activity.openDesignReview()
    }

    /** Emulator proof of the real React review screen (no customer data logged). */
    @JavascriptInterface
    fun designReviewReady(role: String) {
        if (BuildConfig.DEBUG && role in setOf("client", "driver", "master", "tow"))
            android.util.Log.i("TrakSOSRuntime", "DESIGN_REVIEW_RENDERED=" + role)
    }

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
