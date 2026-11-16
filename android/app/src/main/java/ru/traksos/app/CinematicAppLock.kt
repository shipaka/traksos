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
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Calendar

/**
 * Cinematic unlock scene using the already-bundled seasonal road photography.
 * No image fetches, JS dependencies or large animation libraries.
 */
internal object CinematicAppLock {
    private fun dp(ctx: Context, n: Int) = (n * ctx.resources.displayMetrics.density).toInt()
    private fun season(): String = when (Calendar.getInstance().get(Calendar.MONTH) + 1) {
        3, 4, 5 -> "spring"
        6, 7, 8 -> "summer"
        9, 10, 11 -> "autumn"
        else -> "winter"
    }
    private fun label(ctx: Context, s: String, size: Float, color: Int, bold: Boolean = false) =
        TextView(ctx).apply {
            text = s
            textSize = size
            setTextColor(color)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
            setLineSpacing(dp(ctx, 4).toFloat(), 1f)
        }
    private fun action(ctx: Context, caption: String, primary: Boolean, click: () -> Unit) =
        Button(ctx).apply {
            text = caption
            textSize = 15f
            isAllCaps = false
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            setTextColor(if (primary) 0xFF031622.toInt() else Color.WHITE)
            val shape = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                if (primary) intArrayOf(0xFF7CF3FC.toInt(), 0xFF15C4E9.toInt())
                else intArrayOf(0xE20A2B45.toInt(), 0xF0091D31.toInt())
            ).apply {
                cornerRadius = dp(ctx, 17).toFloat()
                setStroke(dp(ctx, 1), if (primary) 0xFFB5FBFF.toInt() else 0xFF4B859F.toInt())
            }
            background = RippleDrawable(ColorStateList.valueOf(0x5585DDEB), shape, null)
            minimumHeight = dp(ctx, 54)
            setOnClickListener { click() }
        }
    fun build(ctx: Context, pin: Boolean, fingerprint: Boolean,
              onPin: () -> Unit, onBiometric: () -> Unit, onRecovery: () -> Unit): FrameLayout {
        val cover = FrameLayout(ctx).apply {
            setBackgroundColor(0xFF061321.toInt())
            isClickable = true
            isFocusable = true
            contentDescription = "Экран защищённого входа TrakSOS"
        }
        // Reuse precisely the approved offline photo family that was already shipped
        // for the four seasonal startup states. Do not duplicate packaged assets.
        val photo = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            try {
                val sample = BitmapFactory.Options().apply { inSampleSize = 2 }
                ctx.assets.open("seasonal_splash/" + season() + ".webp").use {
                    setImageBitmap(BitmapFactory.decodeStream(it, null, sample))
                }
            } catch (_: Exception) { setImageResource(R.drawable.splash_truck) }
        }
        cover.addView(photo, FrameLayout.LayoutParams(-1, -1))
        cover.addView(View(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xDD031224.toInt(), 0x95041324.toInt(), 0xE4051226.toInt(), 0xFE05131F.toInt()))
        }, FrameLayout.LayoutParams(-1,-1))

        val group = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(ctx, 24), dp(ctx, 23), dp(ctx, 24), dp(ctx, 30))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xCC071C30.toInt(), 0xD908223A.toInt())).apply {
                cornerRadius = dp(ctx, 26).toFloat()
                setStroke(dp(ctx, 1), 0x9952CCEF.toInt())
            }
            elevation = dp(ctx, 14).toFloat()
        }
        val mark = label(ctx, "✧  TrakSOS  ·  ЗАЩИЩЁННЫЙ ДОСТУП", 12f, 0xFF91E9F9.toInt(), true)
        mark.letterSpacing = .12f
        group.addView(mark)
        val glyph = label(ctx, "◈", 60f, 0xFF7EEAF3.toInt(), true)
        glyph.setShadowLayer(dp(ctx, 16).toFloat(), 0f, 0f, 0xCC39D6F1.toInt())
        group.addView(glyph, LinearLayout.LayoutParams(-1, dp(ctx, 92)))
        group.addView(label(ctx, "С возвращением", 29f, Color.WHITE, true))
        group.addView(label(ctx, "Быстрый вход · ваши заявки на месте", 14f, 0xFFC9E2EE.toInt()),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(ctx, 11); bottomMargin = dp(ctx, 26) })
        if (pin) {
            group.addView(action(ctx, "Ввести PIN · 4 цифры", true, onPin),
                LinearLayout.LayoutParams(-1, dp(ctx, 55)).apply { bottomMargin = dp(ctx, 9) })
            if (fingerprint) {
                group.addView(action(ctx, "Разблокировать отпечатком", false, onBiometric),
                    LinearLayout.LayoutParams(-1, dp(ctx, 55)).apply { bottomMargin = dp(ctx, 9) })
            }
            group.addView(action(ctx, "Забыли PIN?", false, onRecovery),
                LinearLayout.LayoutParams(-1, dp(ctx, 48)))
        } else {
            group.addView(action(ctx, "Разблокировать", true, onBiometric),
                LinearLayout.LayoutParams(-1, dp(ctx, 55)))
        }
        group.addView(label(ctx,
            "Статус исполнителя не меняется при сворачивании или блокировке телефона.",
            11f, 0xFFB5CFDF.toInt()),
            LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(ctx, 17) })
        cover.addView(group, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply {
            leftMargin = dp(ctx, 17)
            rightMargin = dp(ctx, 17)
        })
        if (Build.VERSION.SDK_INT >= 26 && ValueAnimator.areAnimatorsEnabled()) {
            group.alpha = .1f
            group.translationY = dp(ctx, 25).toFloat()
            group.animate().alpha(1f).translationY(0f).setDuration(550).start()
        }
        return cover
    }
}
