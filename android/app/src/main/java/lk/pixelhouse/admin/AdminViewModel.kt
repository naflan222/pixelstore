package lk.pixelhouse.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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
    val currency = MutableStateFlow("LKR")
    private var currencyLoaded = false
    val homeSaving = MutableStateFlow(false)
    val settingsDirty = MutableStateFlow(false)
    var orderListIndex = 0
    var orderListOffset = 0
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
    fun filterOrders(status: String) { module.value = modules.first { it.endpoint == "orders" }; detail.value = null; data.value = JSONObject(); query = ""; currentPage = 1; filters = if(status.isBlank()) emptyMap() else mapOf("status" to status); load() }
    fun applyFilters(search: String = query, values: Map<String,String> = filters) { orderListIndex = 0; orderListOffset = 0; query = search; filters = values; currentPage = 1; load() }
    fun saveHomeSection(key: String, ids: List<Long>, done: () -> Unit) = work {
        homeSaving.value = true
        try {
            api.request("/api/admin/homepage-sections/$key", "PUT", JSONObject().put("product_ids", org.json.JSONArray(ids)))
            done()
            message.value = "Saved. Checking the website…"
            try {
                val public = api.request("/api/homepage-sections").getJSONObject("sections").getJSONArray(key).objects().map { it.optLong("id") }
                message.value = if(public == ids) "Saved and verified. Open website pages update within 30 seconds." else "Saved, but the website response differs. Refresh and check the selected products."
            } catch (_: Exception) { message.value = "Saved to the server. Website verification was unavailable; refresh to check. Do not save again just to retry verification." }
            try { readList() } catch (_: Exception) { message.value += " The app list could not refresh; use Refresh to check it." }
        } finally { homeSaving.value = false }
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
        if (selected.endpoint in listOf("analytics", "orders")) params["timezone"] = STORE_ZONE
        val qs = params.entries.joinToString("&") { (k,v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        val result = if (selected.endpoint == "stats") coroutineScope {
            val stats = async { api.request("/api/admin/stats") }
            val sales = async { api.request("/api/admin/analytics?range=last_7_days&timezone=Asia%2FColombo") }
            val settings = async { api.request("/api/admin/settings").getJSONObject("settings") }
            val result = stats.await().put("analytics", sales.await())
            currency.value = settings.await().display("currency").ifBlank { "LKR" }; currencyLoaded = true
            result
        } else api.request("/api/admin/${selected.endpoint}?$qs")
        if (selected.endpoint == "settings") { currency.value = result.optJSONObject("settings")?.display("currency").orEmpty().ifBlank { "LKR" }; currencyLoaded = true }
        if (!currencyLoaded) { currency.value = api.request("/api/admin/settings").getJSONObject("settings").display("currency").ifBlank { "LKR" }; currencyLoaded = true }
        if (module.value == selected) data.value = result
    }
    fun load() { viewModelScope.launch { operation { readList() } } }
    private suspend fun readOrder(id: Long) {
        if (!currencyLoaded) { currency.value = api.request("/api/admin/settings").getJSONObject("settings").display("currency").ifBlank { "LKR" }; currencyLoaded = true }
        val fromOtherModule = module.value.endpoint != "orders"
        val result = api.request("/api/admin/orders/$id")
        detail.value = result; module.value = modules.first { it.endpoint == "orders" }; pendingOrder = null
        if(fromOtherModule) { currentPage = 1; query = ""; filters = emptyMap(); orderListIndex = 0; orderListOffset = 0; readList() }
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
        if (path == "/api/admin/settings" && method == "PATCH") {
            if(module.value.endpoint == "settings") data.value = result
            currency.value = result.optJSONObject("settings")?.display("currency").orEmpty().ifBlank { currency.value }
            settingsDirty.value = false
            return@work
        }
        if (pendingOrder != null) readOrder(pendingOrder!!)
        else detail.value?.optJSONObject("order")?.optLong("id")?.takeIf { it > 0 }?.let { detail.value = api.request("/api/admin/orders/$it") }
        readList()
    }
}
