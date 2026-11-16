package ru.traksos.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real emulator tests: AndroidKeyStore and persisted retry rules must work
 * on both Android 10 and Android 15. Never transmit/store an entered PIN.
 */
@RunWith(AndroidJUnit4::class)
class AppPinStoreTest {
    private val ctx: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun setUp() = AppPinStore.clear(ctx)
    @After fun cleanUp() = AppPinStore.clear(ctx)

    @Test fun setupRequiresFourDigitsAndBindsAccount() {
        assertFalse(AppPinStore.create(ctx, "123", "account-A"))
        assertFalse(AppPinStore.create(ctx, "12345", "account-A"))
        assertFalse(AppPinStore.create(ctx, "abcd", "account-A"))
        assertFalse(AppPinStore.create(ctx, "1234", ""))
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(AppPinStore.enabled(ctx))
        assertEquals("account-A", AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "4321"))
        assertEquals(AppPinStore.Check.OK, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun wrongAttemptsPersistAndForceReauthentication() {
        assertTrue(AppPinStore.create(ctx, "9341", "account-B"))
        for (tryNumber in 1..4)
            assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "0000"))
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "0000"))
        assertTrue(AppPinStore.waitSeconds(ctx) > 0)
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "9341"))

        // Test-only clock simulation: clear lockout expiration, not the failed count.
        // The 15-attempt limit must survive restarts/cooldown resets.
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        for (tryNumber in 6..15) {
            p.edit().putLong("blockedUntil", 0L).commit()
            val result = AppPinStore.verify(ctx, "0000")
            if (tryNumber < 15) assertEquals(AppPinStore.Check.COOLDOWN, result)
            else assertEquals(AppPinStore.Check.RELOGIN, result)
        }
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "9341"))
    }

    @Test fun clearingPinAlsoInvalidatesOldKeystoreVerifier() {
        assertTrue(AppPinStore.create(ctx, "1234", "account-A"))
        AppPinStore.clear(ctx)
        assertFalse(AppPinStore.enabled(ctx))
        assertNull(AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "1234"))
        assertTrue(AppPinStore.create(ctx, "6543", "account-C"))
        assertEquals("account-C", AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "1234"))
        assertEquals(AppPinStore.Check.OK, AppPinStore.verify(ctx, "6543"))
    }
    /** Even without biometrics or internet the native screen has a working keypad. */
    @Test fun cinematicKeypadAcceptsFourDigitsWithoutWebViewOrKeyboard() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        var received: String? = null
        fun locate(v: View, value: String): TextView? {
            if (v is TextView && v.text.toString() == value) return v
            if (v is ViewGroup) for (i in 0 until v.childCount) {
                val hit = locate(v.getChildAt(i), value)
                if (hit != null) return hit
            }
            return null
        }
        instrument.runOnMainSync {
            val cover = CinematicAppLock.build(
                ctx, pin = true, fingerprint = false,
                onPinEntered = { received = it; AppPinStore.Check.WRONG },
                onBiometric = { fail("Unexpected biometrics") },
                onRecovery = { fail("Unexpected recovery") }
            )
            assertNotNull(locate(cover, "С возвращением"))
            assertNotNull(locate(cover, "Введите четыре цифры"))
            assertNotNull(locate(cover, "Забыли PIN?"))
            for (digit in "0123") {
                val button = locate(cover, digit.toString())
                assertNotNull("Missing keypad button $digit", button)
                button!!.performClick()
            }
            assertEquals("0123", received)
            assertNotNull(locate(cover, "Неверный PIN. Попробуйте снова."))
        }
    }

    /** Actual native view (with the APK's seasonal photo), not a mockup. */
    @Test fun renderCinematicKeypadForVisualReview() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val coverHolder = arrayOfNulls<View>(1)
        instrument.runOnMainSync {
            coverHolder[0] = CinematicAppLock.build(ctx,
                pin = true, fingerprint = true,
                onPinEntered = { AppPinStore.Check.WRONG },
                onBiometric = {}, onRecovery = {})
            val view = coverHolder[0]!!
            val density = ctx.resources.displayMetrics.density
            val width = (390f * density).toInt()
            val height = (844f * density).toInt()
            view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, width, height)
        }
        // Allow the actual 450ms entry animation to settle before capturing.
        Thread.sleep(650)
        instrument.runOnMainSync {
            val view = coverHolder[0]!!
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            view.draw(canvas)
            File(ctx.cacheDir, "cinematic-pin-preview.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        val file = File(ctx.cacheDir, "cinematic-pin-preview.png")
        assertTrue("Native PIN preview must be nonempty", file.length() > 30_000)
    }

}
