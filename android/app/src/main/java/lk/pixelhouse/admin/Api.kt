package lk.pixelhouse.admin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionVault(context: Context) {
    private val preferences = context.getSharedPreferences("owner_session", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("pixelhouse-session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("pixelhouse-session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun token(): String? = try {
        preferences.getString("session", null)?.let {
            val bytes = Base64.decode(it, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        }
    } catch (_: Exception) { clear(); null }
    @Synchronized fun save(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        preferences.edit().putString("session", Base64.encodeToString(cipher.iv + cipher.doFinal(token.toByteArray()), Base64.NO_WRAP)).commit()
    }
    @Synchronized fun clear() { preferences.edit().remove("session").commit() }
    fun deviceId(): String = synchronized(this) {
        preferences.getString("device", null) ?: UUID.randomUUID().toString().also { preferences.edit().putString("device", it).commit() }
    }
}
class ApiException(val status: Int, message: String): IOException(message)
class AdminApi(val vault: SessionVault, networkClient: OkHttpClient? = null) {
    companion object { const val BASE = "https://pixelhouse.lk" }
    val signedIn = MutableStateFlow(false)
    val capabilities = MutableStateFlow(JSONObject())
    private val client = networkClient ?: OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(40, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS).retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build()
    private suspend fun execute(path: String, method: String, bytes: ByteArray?, mediaType: String): ByteArray = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/") && !path.contains(".."))
        val request = Request.Builder().url(BASE + path).header("Accept", "application/json").header("X-PixelHouse-Android", "1")
        vault.token()?.let { request.header("Cookie", "pixels_session=$it") }
        request.method(method, if (method == "GET") null else (bytes ?: ByteArray(0)).toRequestBody(mediaType.toMediaType()))
        client.newCall(request.build()).execute().use { response ->
            // Only the session cookie is persisted, encrypted. No passwords or response bodies are logged.
            response.headers.values("Set-Cookie").mapNotNull { Cookie.parse(response.request.url, it) }
                .firstOrNull { it.name == "pixels_session" }?.let { if (it.value.isEmpty()) vault.clear() else vault.save(it.value) }
            val body = response.body?.bytes() ?: ByteArray(0)
            if (!response.isSuccessful) {
                if (response.code == 401) { vault.clear(); signedIn.value = false }
                val message = runCatching { JSONObject(String(body)).optString("error") }.getOrDefault("")
                throw ApiException(response.code, message.ifBlank { "Request failed (${response.code}). Please refresh before retrying a change." })
            }
            body
        }
    }
    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val data = execute(path, method, body?.toString()?.toByteArray(), "application/json; charset=utf-8")
        return if (data.isEmpty()) JSONObject() else JSONObject(String(data, Charsets.UTF_8))
    }
    suspend fun csv(path: String, content: String) = JSONObject(String(execute(path, "POST", content.toByteArray(), "text/csv")))
    suspend fun download(path: String) = execute(path, "GET", null, "application/json")
    suspend fun verify() {
        val user = request("/api/auth/me").getJSONObject("user")
        if (user.optString("role") != "owner") {
            runCatching { request("/api/auth/logout", "POST") }; vault.clear(); signedIn.value = false
            throw ApiException(403, "This app is available only to your PixelHouse owner account.")
        }
        val capabilities = try { request("/api/mobile/capabilities") } catch (e: Exception) {
            throw ApiException(503, "Deploy the Android admin server update before using this app.")
        }
        require(capabilities.optInt("native_admin_version") >= 1 && capabilities.optBoolean("csv_dry_run")) { "Update the PixelHouse server before using this app." }
        this.capabilities.value = capabilities
        signedIn.value = true
    }
    suspend fun login(username: String, password: String) {
        request("/api/auth/login", "POST", JSONObject().put("username", username).put("password", password))
        verify()
    }
    suspend fun logout() {
        // Don't pretend logout succeeded when an offline phone cannot revoke server delivery.
        runCatching { request("/api/mobile/devices/" + vault.deviceId(), "DELETE") }
        request("/api/auth/logout", "POST"); vault.clear(); signedIn.value = false
    }
}

fun readLimited(input: java.io.InputStream, limit: Int): ByteArray {
    val buffer = java.io.ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (true) {
        val count = input.read(chunk)
        if (count < 0) break
        require(buffer.size() + count <= limit) { "The selected file is too large." }
        buffer.write(chunk, 0, count)
    }
    return buffer.toByteArray()
}
