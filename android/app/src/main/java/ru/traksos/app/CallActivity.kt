package ru.traksos.app

import android.app.KeyguardManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** Экран входящей заявки поверх блокировки: 30 секунд, звонок и вибрация, «Беру» / «Отклонить» */
class CallActivity : AppCompatActivity() {
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var timer: CountDownTimer? = null
    private lateinit var orderId: String
    private var answered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        orderId = intent.getStringExtra(CallNotifier.EXTRA_ORDER) ?: return finish()
        val ringUntil = intent.getLongExtra(CallNotifier.EXTRA_RING_UNTIL, System.currentTimeMillis() + 30_000)

        val timerView = text("", 56f, R.color.fg, bold = true)
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(getColor(R.color.bg))
            setPadding(dp(24), dp(64), dp(24), dp(40))
            addView(text(getString(if (intent.getStringExtra(CallNotifier.EXTRA_TITLE)?.startsWith("SOS") == true) R.string.incoming_sos else R.string.incoming), 14f, R.color.accent, bold = true))
            addView(spacer(24))
            addView(text("⚡", 52f, R.color.bg).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(getColor(R.color.accent)) }
                layoutParams = LinearLayout.LayoutParams(dp(120), dp(120))
                gravity = Gravity.CENTER
            })
            addView(spacer(24))
            addView(text(intent.getStringExtra(CallNotifier.EXTRA_TITLE) ?: "", 22f, R.color.fg, bold = true))
            addView(spacer(8))
            addView(text(intent.getStringExtra(CallNotifier.EXTRA_BODY) ?: "", 16f, R.color.muted))
            addView(LinearLayout(context).apply { layoutParams = LinearLayout.LayoutParams(0, 0, 1f) })
            addView(timerView)
            addView(spacer(20))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(button(getString(R.string.decline), R.color.bg, R.color.fg, 1f) { answer(false) })
                addView(LinearLayout(context).apply { layoutParams = LinearLayout.LayoutParams(dp(12), 1) })
                addView(button(getString(R.string.accept), R.color.good, R.color.bg, 1.4f) { answer(true) })
            })
        })

        startRinging()
        timer = object : CountDownTimer((ringUntil - System.currentTimeMillis()).coerceAtLeast(0), 250) {
            override fun onTick(ms: Long) { timerView.text = ((ms + 999) / 1000).toString() }
            override fun onFinish() { stopRinging(); finish() }
        }.start()
    }

    private fun answer(accept: Boolean) {
        if (answered) return
        answered = true
        stopRinging()
        CallNotifier.cancel(this, orderId)
        CallActionReceiver.respond(applicationContext, orderId, accept, intent.getBooleanExtra(CallNotifier.EXTRA_AUCTION, false))
        finish()
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun startRinging() {
        try {
            ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
                play()
            }
        } catch (_: Exception) { }
        vibrator = getSystemService(Vibrator::class.java)
        val pattern = longArrayOf(0, 800, 400)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(pattern, 0)
        }
        // уведомление со своим звуком больше не нужно — звонит этот экран
        CallNotifier.cancel(this, orderId)
    }

    private fun stopRinging() {
        ringtone?.stop()
        vibrator?.cancel()
        timer?.cancel()
    }

    override fun onDestroy() {
        stopRinging()
        super.onDestroy()
    }

    // маленькие помощники вёрстки --------------------------------------------

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
    private fun spacer(h: Int) = LinearLayout(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }
    private fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(getColor(color))
        gravity = Gravity.CENTER
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }
    private fun button(label: String, bg: Int, fg: Int, weight: Float, onClick: () -> Unit) = Button(this).apply {
        text = label
        textSize = 18f
        isAllCaps = false
        setTextColor(getColor(fg))
        typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(getColor(bg))
            setStroke(dp(1), getColor(R.color.muted))
        }
        layoutParams = LinearLayout.LayoutParams(0, dp(64), weight)
        setOnClickListener { onClick() }
    }
}
