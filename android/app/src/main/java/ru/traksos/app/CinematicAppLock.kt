package ru.traksos.app

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Calendar

/**
 * TrakSOS native cinematic lock. Every photograph is already bundled in the APK.
 * PIN digits stay inside native Android UI, never touch WebView, JavaScript or logs.
 * All controls remain usable without network access or device animation support.
 */
internal object CinematicAppLock {
    private fun dp(ctx: Context, value: Int) = (ctx.resources.displayMetrics.density * value).toInt()
    private fun season(): String = when (Calendar.getInstance().get(Calendar.MONTH) + 1) {
        3, 4, 5 -> "spring"
        6, 7, 8 -> "summer"
        9, 10, 11 -> "autumn"
        else -> "winter"
    }
    private fun text(ctx: Context, value: String, size: Float, color: Int, bold: Boolean = false) =
        TextView(ctx).apply {
            this.text = value
            textSize = size
            setTextColor(color)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }
    private fun surface(ctx: Context, primary: Boolean) =
        GradientDrawable(GradientDrawable.Orientation.TL_BR,
            if (primary) intArrayOf(0xFF7CF3FC.toInt(), 0xFF15C4E9.toInt())
            else intArrayOf(0xE3143A57.toInt(), 0xEE0B2943.toInt())).apply {
            cornerRadius = dp(ctx, 15).toFloat()
            setStroke(dp(ctx, 1).coerceAtLeast(1),
                if (primary) 0xFFB5FBFF.toInt() else 0xFF4B859F.toInt())
        }
    private fun key(ctx: Context, caption: String, click: () -> Unit): TextView =
        text(ctx, caption, if (caption.length == 1) 24f else 13f, Color.WHITE, true).apply {
            isClickable = true
            isFocusable = true
            contentDescription = if (caption == "⌫") "Удалить последнюю цифру" else caption
            minimumHeight = dp(ctx, 52)
            background = RippleDrawable(
                ColorStateList.valueOf(0x5585DDEB), surface(ctx, false), null)
            setOnClickListener { click() }
        }

    fun build(
        ctx: Context,
        pin: Boolean,
        fingerprint: Boolean,
        onPinEntered: (String) -> AppPinStore.Check,
        onBiometric: () -> Unit,
        onRecovery: () -> Unit
    ): FrameLayout {
        val cover = FrameLayout(ctx).apply {
            setBackgroundColor(0xFF061321.toInt())
            isClickable = true
            isFocusable = true
            contentDescription = "Экран защищённого входа TrakSOS"
        }
        val photo = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            try {
                val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                ctx.assets.open("seasonal_splash/" + season() + ".webp").use {
                    setImageBitmap(BitmapFactory.decodeStream(it, null, opts))
                }
            } catch (_: Exception) { setImageResource(R.drawable.splash_truck) }
        }
        cover.addView(photo, FrameLayout.LayoutParams(-1, -1))
        cover.addView(View(ctx).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xDD031224.toInt(), 0x95041324.toInt(),
                    0xE4051226.toInt(), 0xFE05131F.toInt()))
        }, FrameLayout.LayoutParams(-1, -1))

        val group = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val h = dp(ctx, 21)
            setPadding(h, dp(ctx, 18), h, dp(ctx, 20))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xEF071C30.toInt(), 0xF208223A.toInt())).apply {
                cornerRadius = dp(ctx, 25).toFloat()
                setStroke(dp(ctx, 1).coerceAtLeast(1), 0x9952CCEF.toInt())
            }
            elevation = dp(ctx, 12).toFloat()
        }
        val title = text(ctx, "✧  TrakSOS  ·  ЗАЩИЩЁННЫЙ ДОСТУП",
            11f, 0xFF91E9F9.toInt(), true).apply { letterSpacing = .10f }
        group.addView(title)
        group.addView(text(ctx, "◈", 44f, 0xFF7EEAF3.toInt(), true).apply {
            setShadowLayer(dp(ctx, 11).toFloat(), 0f, 0f, 0xCC39D6F1.toInt())
        }, LinearLayout.LayoutParams(-1, dp(ctx, 65)))
        group.addView(text(ctx, "С возвращением", 25f, Color.WHITE, true))
        group.addView(text(ctx, "Ваши заявки и рабочий статус на месте",
            12f, 0xFFC9E2EE.toInt()),
            LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(ctx, 9)
                bottomMargin = dp(ctx, if (pin) 15 else 23)
            })

        if (pin) {
            val progress = text(ctx, "○  ○  ○  ○", 25f, 0xFF69DFF0.toInt(), true)
            progress.contentDescription = "PIN: введено 0 из 4 цифр"
            group.addView(progress)
            val status = text(ctx, "Введите четыре цифры", 12f, 0xFFB6D8E5.toInt())
            group.addView(status, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(ctx, 6)
                bottomMargin = dp(ctx, 11)
            })
            val digits = StringBuilder()
            fun updateProgress() {
                val n = digits.length
                progress.text = (0 until 4).joinToString("  ") { if (it < n) "●" else "○" }
                progress.contentDescription = "PIN: введено $n из 4 цифр"
            }
            fun addDigit(value: Char) {
                if (digits.length >= 4) return
                digits.append(value)
                updateProgress()
                if (digits.length != 4) return
                val result = onPinEntered(digits.toString())
                digits.setLength(0)
                updateProgress()
                status.text = when (result) {
                    AppPinStore.Check.OK -> "Вход выполнен"
                    AppPinStore.Check.WRONG -> "Неверный PIN. Попробуйте снова."
                    AppPinStore.Check.COOLDOWN ->
                        "Слишком много попыток. Подождите перед повтором."
                    AppPinStore.Check.RELOGIN ->
                        "Для восстановления нужен пароль аккаунта."
                }
                if (result != AppPinStore.Check.OK) {
                    status.announceForAccessibility(status.text)
                    if (Build.VERSION.SDK_INT >= 26 && ValueAnimator.areAnimatorsEnabled()) {
                        progress.animate().translationX(dp(ctx, 5).toFloat())
                            .setDuration(65).withEndAction {
                                progress.animate().translationX(0f).setDuration(90).start()
                            }.start()
                    }
                }
            }
            for (rowIndex in 0..3) {
                val row = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                }
                val labels = when (rowIndex) {
                    0 -> listOf("1", "2", "3")
                    1 -> listOf("4", "5", "6")
                    2 -> listOf("7", "8", "9")
                    else -> listOf("", "0", "⌫")
                }
                for (label in labels) {
                    val margin = dp(ctx, 4)
                    val params = LinearLayout.LayoutParams(0, dp(ctx, 51), 1f).apply {
                        setMargins(margin, dp(ctx, 3), margin, dp(ctx, 3))
                    }
                    if (label.isEmpty()) row.addView(View(ctx), params)
                    else row.addView(key(ctx, label) {
                        if (label == "⌫") {
                            if (digits.isNotEmpty()) digits.deleteCharAt(digits.lastIndex)
                            updateProgress()
                        } else addDigit(label[0])
                    }, params)
                }
                group.addView(row, LinearLayout.LayoutParams(-1, -2))
            }
            if (fingerprint) {
                val biometric = text(ctx, "◈  Открыть отпечатком", 14f, 0xFF96EBF8.toInt(), true)
                biometric.isClickable = true
                biometric.isFocusable = true
                biometric.contentDescription = "Разблокировать отпечатком пальца"
                biometric.setPadding(dp(ctx, 8), dp(ctx, 13), dp(ctx, 8), dp(ctx, 13))
                biometric.setOnClickListener { onBiometric() }
                group.addView(biometric)
            }
            val recovery = text(ctx, "Забыли PIN?", 13f, 0xFFD4EDF7.toInt())
            recovery.isClickable = true
            recovery.isFocusable = true
            recovery.setPadding(dp(ctx, 8), dp(ctx, 9), dp(ctx, 8), dp(ctx, 9))
            recovery.setOnClickListener { onRecovery() }
            group.addView(recovery)
        } else {
            val button = text(ctx, "Разблокировать устройство", 15f,
                0xFF041622.toInt(), true)
            button.isClickable = true
            button.isFocusable = true
            button.background = RippleDrawable(ColorStateList.valueOf(0x664ED9E7),
                surface(ctx, true), null)
            button.setOnClickListener { onBiometric() }
            group.addView(button, LinearLayout.LayoutParams(-1, dp(ctx, 55)))
        }
        group.addView(text(ctx,
            "Сворачивание и обычный звонок не выключают вас с линии.",
            11f, 0xFFB5CFDF.toInt()),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(ctx, 10) })

        // Compact phones can scroll the unlock sheet instead of clipping the
        // bottom keys. This still works on a 320dp device with large text.
        val scrolling = ScrollView(ctx).apply {
            isFillViewport = true
            clipToPadding = false
            setPadding(dp(ctx, 14), dp(ctx, 15), dp(ctx, 14), dp(ctx, 15))
        }
        val center = LinearLayout(ctx).apply {
            gravity = Gravity.CENTER
            orientation = LinearLayout.VERTICAL
            addView(group, LinearLayout.LayoutParams(-1, -2))
        }
        scrolling.addView(center, FrameLayout.LayoutParams(-1, -2))
        cover.addView(scrolling, FrameLayout.LayoutParams(-1, -1))
        if (Build.VERSION.SDK_INT >= 26 && ValueAnimator.areAnimatorsEnabled()) {
            group.alpha = .05f
            group.translationY = dp(ctx, 18).toFloat()
            group.animate().alpha(1f).translationY(0f).setDuration(450).start()
        }
        return cover
    }
}
