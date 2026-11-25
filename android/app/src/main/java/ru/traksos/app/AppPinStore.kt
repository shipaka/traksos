package ru.traksos.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

/**
 * Local four-digit unlock ONLY. The server still authenticates with the long-lived
 * bearer session; the PIN never travels to JavaScript, PostgreSQL or the network.
 *
 * A hardware/OS-backed, non-exportable HMAC key prevents an offline dictionary
 * attack against the 10,000 possible PIN values using only the preferences file.
 * This lock is not a substitute for account credentials on a compromised device.
 */
object AppPinStore {
    private const val PREFS = "traksos_app_pin"
    private const val KEY_ALIAS = "traksos_local_unlock_hmac_v1"
    private const val VERIFIER_VERSION = 2
    // A failed persistent write must not permit further attempts in this process.
    private var storageFailed = false
    private val pinFormat = Regex("^[0-9]{4}$")

    enum class Check { OK, WRONG, COOLDOWN, RELOGIN }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun enabled(ctx: Context): Boolean = prefs(ctx).contains("mac")
    fun owner(ctx: Context): String? = prefs(ctx).getString("ownerId", null)

    private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256).build())
        return gen.generateKey()
    }

    private fun digest(pin: String, salt: ByteArray, accountId: String, create: Boolean): ByteArray? {
        val secret = key(create) ?: return null
        return Mac.getInstance("HmacSHA256").run {
            init(secret)
            // Fixed-size salt and PIN delimit the account ID unambiguously.
            doFinal(byteArrayOf(VERIFIER_VERSION.toByte()) + salt +
                pin.toByteArray(Charsets.US_ASCII) + accountId.toByteArray(Charsets.UTF_8))
        }
    }

    @Synchronized
    fun create(ctx: Context, pin: String, accountId: String): Boolean {
        if (!pinFormat.matches(pin) || accountId.isBlank()) return false
        return try {
            val salt = ByteArray(32).also { SecureRandom().nextBytes(it) }
            val mac = digest(pin, salt, accountId, true) ?: return false
            val saved = prefs(ctx).edit()
                .putInt("version", VERIFIER_VERSION)
                .putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString("mac", Base64.encodeToString(mac, Base64.NO_WRAP))
                .putString("ownerId", accountId)
                .putInt("failures", 0)
                .remove("blockedUntil")
                .commit()
            storageFailed = !saved
            saved
        } catch (_: Exception) { storageFailed = true; false }
    }

    /** Wrong attempts are persisted across process restarts. */
    @Synchronized
    fun verify(ctx: Context, pin: String): Check {
        val p = prefs(ctx)
        if (storageFailed || !enabled(ctx) || p.getInt("failures", 0) >= 15) return Check.RELOGIN
        // Preview v1 verifiers did not authenticate ownerId. Require account recovery,
        // not a silent upgrade that could legitimise modified account metadata.
        if (p.getInt("version", 0) != VERIFIER_VERSION) return Check.RELOGIN
        val accountId = owner(ctx)?.takeIf { it.isNotBlank() } ?: return Check.RELOGIN
        if (System.currentTimeMillis() < p.getLong("blockedUntil", 0L)) return Check.COOLDOWN
        val match = pinFormat.matches(pin) && try {
            val salt = Base64.decode(p.getString("salt", "") ?: "", Base64.NO_WRAP)
            val target = Base64.decode(p.getString("mac", "") ?: "", Base64.NO_WRAP)
            if (salt.size != 32 || target.size != 32) return Check.RELOGIN
            val computed = digest(pin, salt, accountId, false) ?: return Check.RELOGIN
            MessageDigest.isEqual(target, computed)
        } catch (_: Exception) { return Check.RELOGIN }
        if (match) {
            if (!p.edit().putInt("failures", 0).remove("blockedUntil").commit()) {
                storageFailed = true
                return Check.RELOGIN
            }
            return Check.OK
        }
        val failures = p.getInt("failures", 0) + 1
        val wait = when {
            failures >= 15 -> 0L // Require full password/SMS recovery.
            failures >= 10 -> 5 * 60_000L
            failures >= 5 -> 30_000L
            else -> 0L
        }
        if (!p.edit().putInt("failures", failures)
                .putLong("blockedUntil", System.currentTimeMillis() + wait).commit()) {
            storageFailed = true
            return Check.RELOGIN
        }
        return if (failures >= 15) Check.RELOGIN else if (wait > 0) Check.COOLDOWN else Check.WRONG
    }

    fun waitSeconds(ctx: Context): Long =
        ((prefs(ctx).getLong("blockedUntil", 0L) - System.currentTimeMillis())
            .coerceAtLeast(0L) + 999L) / 1000L

    @Synchronized
    fun clear(ctx: Context) {
        storageFailed = !prefs(ctx).edit().clear().commit()
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS)
        } catch (_: Exception) { /* fail closed: a new PIN is required for a fresh session */ }
    }
}
