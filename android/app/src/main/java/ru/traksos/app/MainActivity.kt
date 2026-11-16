package ru.traksos.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.text.InputFilter
import android.text.InputType
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
import android.widget.EditText
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
    private var activeAccountId: String? = null

    fun appPinEnabled(): Boolean = AppPinStore.enabled(this)
    private fun biometricAvailable() = BiometricManager.from(this)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

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

    /** A native dialog keeps the PIN out of WebView and JavaScript entirely. */
    private fun pinDialog(title: String, recover: Boolean = false, onEntered: (String) -> Boolean) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            filters = arrayOf(InputFilter.LengthFilter(4))
            textSize = 24f
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            contentDescription = "Четыре цифры PIN-кода TrakSOS"
        }
        input.apply {
            letterSpacing = .4f
            setTextColor(Color.WHITE)
            setHintTextColor(0xFFAACCDC.toInt())
            setPadding(16, 24, 16, 24)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF123B57.toInt(), 0xFF092035.toInt())).apply {
                cornerRadius = 18 * resources.displayMetrics.density
                setStroke((resources.displayMetrics.density).toInt().coerceAtLeast(1),
                    0xFF46CDE8.toInt())
            }
        }
        val holder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(TextView(this@MainActivity).apply {
                text = "◈  ЗАЩИЩЁННЫЙ ВХОД"
                textSize = 11f
                letterSpacing = .15f
                setTextColor(0xFF75E0EF.toInt())
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = pad / 2 })
            addView(input)
        }
        val builder = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(holder)
            .setPositiveButton("Продолжить", null)
            .setNegativeButton("Отмена", null)
        if (recover) builder.setNeutralButton("Забыли PIN?") { _, _ -> confirmAccountRecovery() }
        val dialog = builder.create()
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(
                GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    intArrayOf(0xFF0A243F.toInt(), 0xFF051527.toInt())).apply {
                    cornerRadius = 24 * resources.displayMetrics.density
                    setStroke(resources.displayMetrics.density.toInt().coerceAtLeast(1),
                        0xFF4B9CB4.toInt())
                }
            )
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val digits = input.text.toString()
                if (digits.length != 4 || digits.any { !it.isDigit() }) {
                    input.error = "Нужны ровно четыре цифры"
                } else if (onEntered(digits)) {
                    dialog.dismiss()
                } else {
                    input.text?.clear()
                    if (input.error == null) input.error = "Проверьте код"
                }
            }
            input.requestFocus()
            dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        }
        dialog.show()
    }

    /** Setup or rotation is offered only on a confirmed, signed-in device. */
    fun setupAppPin() {
        if (Session.token(this) == null || activeAccountId.isNullOrBlank()) return
        if (AppPinStore.enabled(this)) {
            pinDialog("Текущий PIN TrakSOS") { entered ->
                when (AppPinStore.verify(this, entered)) {
                    AppPinStore.Check.OK -> {
                        showNewPinSetup()
                        true
                    }
                    AppPinStore.Check.COOLDOWN -> {
                        android.widget.Toast.makeText(this, "Слишком много попыток. Попробуйте позднее.", android.widget.Toast.LENGTH_LONG).show()
                        true
                    }
                    AppPinStore.Check.RELOGIN -> {
                        confirmAccountRecovery()
                        true
                    }
                    else -> false
                }
            }
        } else showNewPinSetup()
    }

    private fun showNewPinSetup() {
        pinDialog("Создайте PIN из 4 цифр") { first ->
            pinDialog("Повторите PIN") { repeated ->
                if (repeated != first) return@pinDialog false
                val account = activeAccountId
                if (account == null || Session.token(this) == null ||
                    !AppPinStore.create(this, repeated, account)) {
                    android.widget.Toast.makeText(this, "Не удалось защитить PIN. Повторите настройку.", android.widget.Toast.LENGTH_LONG).show()
                    return@pinDialog false
                }
                // Fingerprint is strictly opt-in under Profile → Security.
                // Never enable it merely because the device has enrolled a finger.
                emit("appPinChanged", mapOf("enabled" to "true"))
                android.widget.Toast.makeText(this, "Быстрый вход настроен", android.widget.Toast.LENGTH_SHORT).show()
                true
            }
            true
        }
    }

    fun removeAppPin() {
        if (!AppPinStore.enabled(this)) return
        pinDialog("PIN для отключения быстрого входа") { digits ->
            when (AppPinStore.verify(this, digits)) {
                AppPinStore.Check.OK -> {
                    AppPinStore.clear(this)
                    appLockPrefs.edit().putBoolean("enabled", false).apply()
                    emit("appPinChanged", mapOf("enabled" to "false"))
                    true
                }
                AppPinStore.Check.RELOGIN -> { confirmAccountRecovery(); true }
                AppPinStore.Check.COOLDOWN -> {
                    android.widget.Toast.makeText(this, "Повторите позднее", android.widget.Toast.LENGTH_SHORT).show()
                    true
                }
                else -> false
            }
        }
    }

    private fun confirmAccountRecovery() {
        AlertDialog.Builder(this)
            .setTitle("Восстановить доступ?")
            .setMessage("Чтобы сбросить PIN на этом устройстве, понадобится пароль TrakSOS. Если пароль забыт, его можно восстановить по SMS. Текущая сессия будет закрыта.")
            .setPositiveButton("Перейти ко входу") { _, _ -> recoverWithAccountPassword() }
            .setNegativeButton("Остаться", null)
            .show()
    }

    private fun recoverWithAccountPassword() {
        // Do not clear the local lock until the server confirms revocation.
        // A forgotten PIN is not a reason to remove a technician from the line.
        // If offline, keep the cover and retry after connectivity returns.
        Session.post(this, "/api/auth/recover-local-lock") { ok, code ->
            runOnUiThread {
                // 401 proves the old token is already invalid and safe to forget.
                if (!ok && code != 401) {
                    android.widget.Toast.makeText(this,
                        "Для восстановления требуется интернет. Проверьте соединение и повторите.",
                        android.widget.Toast.LENGTH_LONG).show()
                    return@runOnUiThread
                }
                AppPinStore.clear(this)
                appLockPrefs.edit().putBoolean("enabled", false).apply()
                Session.save(this, Session.server(this), null)
                activeAccountId = null
                emit("appPinChanged", mapOf("enabled" to "false"))
                web.evaluateJavascript(
                    "localStorage.removeItem('traksos.token');localStorage.removeItem('traksos.offlineIdentity');location.replace('#/login');location.reload();",
                    null
                )
                completeAppUnlock()
            }
        }
    }

    /** Persist only the account identity so one person's PIN cannot open another's session. */
    fun onWebSession(apiUrl: String, token: String?, accountId: String?) {
        val hadToken = Session.token(this)
        Session.save(this, apiUrl, token)
        if (token.isNullOrEmpty()) {
            activeAccountId = null
            return
        }
        if (!accountId.isNullOrBlank()) {
            if (AppPinStore.enabled(this) && AppPinStore.owner(this) != accountId) {
                AppPinStore.clear(this)
                appLockPrefs.edit().putBoolean("enabled", false).apply()
            }
            activeAccountId = accountId
        }
        if (hadToken == null && !AppPinStore.enabled(this) &&
            !appLockPrefs.getBoolean("pinPrompted", false)) {
            appLockPrefs.edit().putBoolean("pinPrompted", true).apply()
            web.postDelayed({
                if (!isFinishing && Session.token(this) != null && !AppPinStore.enabled(this)) {
                    AlertDialog.Builder(this)
                        .setTitle("Вход без постоянного пароля")
                        .setMessage("Создайте PIN из 4 цифр. В следующий раз вы сможете открыть TrakSOS по PIN или отпечатку, не входя заново.")
                        .setPositiveButton("Создать PIN") { _, _ -> setupAppPin() }
                        .setNegativeButton("Позже", null).show()
                }
            }, 4_200L)
        }
    }

    private fun requireAppUnlock() {
        if (lockCover != null || unlockInProgress ||
            (!appLockEnabled() && !appPinEnabled()) || Session.token(this) == null) return
        val cover = CinematicAppLock.build(this,
            pin = appPinEnabled(),
            fingerprint = appLockEnabled() && biometricAvailable(),
            onPinEntered = { digits ->
                val result = AppPinStore.verify(this, digits)
                when (result) {
                    AppPinStore.Check.OK -> completeAppUnlock()
                    AppPinStore.Check.RELOGIN -> confirmAccountRecovery()
                    else -> Unit
                }
                result
            },
            onBiometric = { requestAppUnlock() },
            onRecovery = { confirmAccountRecovery() }
        )
        val coverParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        // On cold start the approved seasonal splash must remain visible for
        // >=3.5 s. Insert the native lock *under* the splash, but *above*
        // WebView, so no personal cabinet can flash before authentication.
        val splashVisible = startupOverlay?.visibility == View.VISIBLE
        if (splashVisible) appRoot.addView(cover, 1, coverParams)
        else appRoot.addView(cover, coverParams)
        lockCover = cover
        // Call notifications remain handled natively while the WebView is covered.
        foreground = false
        if (!splashVisible) requestAppUnlock()
    }

    private fun requestAppUnlock() {
        if (unlockInProgress || lockCover == null) return
        if (appPinEnabled()) {
            // Native keypad is already visible under the optional fingerprint prompt.
            if (!appLockEnabled() || !biometricAvailable()) return
            unlockInProgress = true
            val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        super.onAuthenticationSucceeded(result)
                        completeAppUnlock()
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        super.onAuthenticationError(errorCode, errString)
                        unlockInProgress = false
                        // Leave the cinematic four-dot keypad available; no second modal.
                    }
                })
            prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
                .setTitle("Открыть TrakSOS")
                .setSubtitle("Отпечаток или PIN TrakSOS")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("Ввести PIN")
                .build())
            return
        }
        // Preserve the already-shipped device-credential lock for existing users.
        if (!appLockEnabled()) return
        unlockInProgress = true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
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
    // Keep the agreed seasonal scene on screen long enough to notice.
    private var startupShownAt = 0L
    private var debugUiReadyLogged = false
    private val startupMinimumVisibleMs = 3_500L
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
        // Android Autofill/credential managers may offer to save the account password
        // at the user's choice. TrakSOS never stores a plaintext password itself.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            web.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
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
        if ((appLockEnabled() || appPinEnabled()) && Session.token(this) != null &&
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

    /** Explicit login CTA in the unsigned demonstration APK.
     * Release already opens the official website with a working guest login. */
    fun openLoginFromDemo() {
        if (!BuildConfig.DEBUG) return
        if (Session.setServer(this, BuildConfig.APP_URL))
            web.post { web.loadUrl(urlFor("login")) }
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
        val hadSplash = startupOverlay != null
        startupOverlay?.visibility = View.GONE
        startupOverlay = null
        // The unlock sheet is already under the splash; launch biometrics only
        // after the seasonal scene has finished, not while it is covering UI.
        if (hadSplash && lockCover != null) requestAppUnlock()
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
            </style></head><body><main><h1>Trak<em>SOS</em></h1>
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
        <style>*{box-sizing:border-box}body{margin:0;background:#061426;color:#f4faff;font-family:Arial,sans-serif}
        header{padding:20px;background:#0c223e;display:flex;justify-content:space-between;align-items:center}
        strong.logo{font-size:24px;color:#00cceb}.badge{font-size:11px;color:#a8adb2}
        main{padding:18px 18px 85px}.alert,.card{border-radius:14px;padding:16px;margin-bottom:14px}
        .alert{background:#12344d;border:1px solid #09b9d0;font-size:13px;line-height:1.5}
        .card{background:#0d2948;border:1px solid #276482}h2{margin:22px 0 12px}
        p{font-size:14px;color:#b5bac0;line-height:1.5}
        button.action{padding:13px;border:0;border-radius:12px;background:#00cceb;color:#171717;font-weight:bold;width:100%;font-size:15px}
        button.secondary{padding:13px;border:1px solid #00cceb;border-radius:12px;background:none;color:#00cceb;width:100%}
        .page{display:none}.page.active{display:block}
        nav{position:fixed;bottom:0;display:flex;width:100%;background:#0c223e;border-top:1px solid #286581}
        nav button{flex:1;padding:17px 0;background:none;border:0;color:#b5bac0;font-size:12px}
        nav button.active{color:#00cceb;font-weight:bold}
        input{width:100%;padding:14px;border:1px solid #276482;border-radius:10px;background:#061426;color:white;margin-bottom:12px}
        </style></head><body><header><strong class="logo">TrakSOS</strong><span class="badge">АВТОНОМНОЕ ДЕМО</span></header>
        <main><div class="alert">Это автономное демо: реальные заявки, вход и отправка документов здесь отключены. Чтобы войти в свой аккаунт, откройте подключение к официальному серверу TrakSOS.</div>
         <button class="action" onclick="TrakSOSNative.openLogin()">Войти в TrakSOS</button>
         <p style="margin:10px 0 20px">Нужен интернет и доступность официального сайта. Если он недоступен — демо остаётся на устройстве.</p>
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

    @JavascriptInterface
    fun openLogin() = activity.openLoginFromDemo()

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
        activity.runOnUiThread {
            activity.onWebSession(apiUrl, token?.takeIf { it.isNotEmpty() }, pendingAccountId)
            if (!token.isNullOrEmpty()) activity.askNotifications()
        }
    }

    private var pendingAccountId: String? = null

    @JavascriptInterface
    fun setAccountId(accountId: String?) {
        pendingAccountId = accountId?.takeIf { it.length in 4..80 && it.matches(Regex("^[a-zA-Z0-9-]+$")) }
    }

    @JavascriptInterface
    fun appPinEnabled(): Boolean = activity.appPinEnabled()

    @JavascriptInterface
    fun setupAppPin() { activity.runOnUiThread { activity.setupAppPin() } }

    @JavascriptInterface
    fun removeAppPin() { activity.runOnUiThread { activity.removeAppPin() } }

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
