package lk.pixelhouse.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URLEncoder

class AdminViewModel(application: Application): AndroidViewModel(application) {
    val app = application as PixelHouseApp
    val api = app.api
    val signedIn = api.signedIn
    val module = MutableStateFlow(modules.first())
    val data = MutableStateFlow(JSONObject())
    val detail = MutableStateFlow<JSONObject?>(null)
    val loading = MutableStateFlow(false)
    val message = MutableStateFlow("")
    var currentPage = 1
    var query = ""
    var filters = mapOf<String, String>()
    var pendingOrder: Long? = null
    private val gate = Mutex()
    init { viewModelScope.launch {
        if (api.vault.token() != null) operation {
            api.verify()
            if (pendingOrder != null) readOrder(pendingOrder!!) else readList()
            app.registerPhone { message.value = it }
        }
    } }
    private suspend fun operation(task: suspend () -> Unit) = gate.withLock {
        loading.value = true
        try { task() } catch (e: CancellationException) { throw e }
        catch (e: Exception) { message.value = e.message ?: "Connection failed. Refresh before retrying a change." }
        finally { loading.value = false }
    }
    fun work(task: suspend () -> Unit) {
        if (loading.value) return
        viewModelScope.launch { message.value = ""; operation(task) }
    }
    fun login(username: String, password: String, done: () -> Unit) = work {
        api.login(username, password); done()
        if (pendingOrder != null) readOrder(pendingOrder!!) else readList()
        app.registerPhone { message.value = it }
    }
    fun logout() = work {
        api.logout(); kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { java.io.File(app.cacheDir, "documents").deleteRecursively() }; data.value = JSONObject(); detail.value = null; message.value = "Signed out."
    }
    fun select(m: Module) {
        module.value = m; detail.value = null; data.value = JSONObject(); currentPage = 1; query = ""; filters = emptyMap(); load()
    }
    private suspend fun readList() {
        val selected = module.value
        if (selected.endpoint.startsWith("@")) { data.value = JSONObject(); return }
        val params = mutableMapOf("page" to currentPage.toString(), "limit" to "25")
        if (query.isNotBlank()) params["search"] = query
        params.putAll(filters.filterValues(String::isNotBlank))
        val qs = params.entries.joinToString("&") { (k,v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        val result = api.request("/api/admin/${selected.endpoint}?$qs")
        if (module.value == selected) data.value = result
    }
    fun load() { viewModelScope.launch { operation { readList() } } }
    private suspend fun readOrder(id: Long) {
        val result = api.request("/api/admin/orders/$id")
        detail.value = result; module.value = modules.first { it.endpoint == "orders" }; pendingOrder = null
    }
    fun openOrder(id: Long) {
        if (id <= 0) return
        pendingOrder = id
        if (!signedIn.value) return
        viewModelScope.launch { operation { readOrder(id) } }
    }
    fun openCustomer(id: Long) = work { detail.value = api.request("/api/admin/customers/$id") }
    fun mutate(path: String, method: String, body: JSONObject = JSONObject(), done: (JSONObject) -> Unit = {}) = work {
        val result = api.request(path, method, body)
        message.value = result.optString("email_error").takeIf { it != "null" }.orEmpty().ifBlank { "Saved successfully." }
        done(result)
        if (pendingOrder != null) readOrder(pendingOrder!!)
        else detail.value?.optJSONObject("order")?.optLong("id")?.takeIf { it > 0 }?.let { detail.value = api.request("/api/admin/orders/$it") }
        readList()
    }
}
